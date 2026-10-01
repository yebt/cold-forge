import { initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";
import * as logger from "firebase-functions/logger";
import { defineBoolean, defineSecret, defineString } from "firebase-functions/params";
import * as functionsV1 from "firebase-functions/v1";
import { onDocumentCreated } from "firebase-functions/v2/firestore";
import { HttpsError, onCall, type CallableOptions, type CallableRequest } from "firebase-functions/v2/https";
import { onSchedule } from "firebase-functions/v2/scheduler";
import { AdminError } from "./errors.ts";
import { createAuthPort, createDataPort, createQuotaPort } from "./firebase.ts";
import { parseEmailList, type AuthContext } from "./guard.ts";
import { handleUserDeleted, onRecordCreated, recountCheckIns, sweepDeletedUsers, type CountedKind } from "./quota.ts";
import { createAdminService, type AdminService } from "./service.ts";
import { isUid } from "./validate.ts";

/**
 * Deploy-time parameters. Firebase reads them from `apps/functions/.env.<projectId>` (or prompts
 * on the first deploy). See README.md in this folder.
 */
const REGION = defineString("ADMIN_REGION", {
  default: "us-central1",
  description: "Region for all functions (must match VITE_FUNCTIONS_REGION in apps/admin).",
});
const ADMIN_ORIGIN = defineString("ADMIN_ORIGIN", {
  description: "Origin of the admin panel allowed by CORS, e.g. https://admin.example.com",
  input: { text: { validationRegex: "^https?://[A-Za-z0-9.-]+(:[0-9]+)?$", validationErrorMessage: "Origin like https://admin.example.com" } },
});
const ENFORCE_APP_CHECK = defineBoolean("ADMIN_ENFORCE_APP_CHECK", {
  default: false,
  description: "Reject callable requests without a valid App Check token (requires App Check in apps/admin).",
});
/**
 * The owner's email must not be committed to this public repo, so the allowlist is a Secret
 * Manager secret (deployed, never in git): `firebase functions:secrets:set ADMIN_ALLOWED_EMAILS`.
 * Empty (or missing) in production = every admin call is refused, unless ADMIN_ALLOW_ANY_ADMIN.
 */
const ALLOWED_EMAILS = defineSecret("ADMIN_ALLOWED_EMAILS");
const ALLOW_ANY_ADMIN = defineBoolean("ADMIN_ALLOW_ANY_ADMIN", {
  default: false,
  description: "true = any verified Google account with the admin claim may use admin powers (no email allowlist). Not recommended.",
});
/** The Functions emulator (local tests) has no Secret Manager: there an empty allowlist means "any admin". */
const IN_EMULATOR = process.env.FUNCTIONS_EMULATOR === "true";

initializeApp();

function readAllowlist(): string[] {
  try {
    return parseEmailList(ALLOWED_EMAILS.value());
  } catch {
    return []; // secret not bound / not set: fail closed below
  }
}

let service: AdminService | undefined;
function getService(): AdminService {
  if (!service) {
    const allowedEmails = readAllowlist();
    const allowAnyAdmin = ALLOW_ANY_ADMIN.value() || IN_EMULATOR;
    if (allowedEmails.length === 0 && !allowAnyAdmin) {
      logger.error("ADMIN_ALLOWED_EMAILS is empty: every admin call is refused (set the secret, see apps/functions/README.md)");
    }
    service = createAdminService({
      auth: createAuthPort(getAuth()),
      data: createDataPort(getFirestore()),
      config: { allowedEmails, allowAnyAdmin },
    });
  }
  return service;
}

const callableOptions: CallableOptions = {
  region: REGION,
  cors: ADMIN_ORIGIN,
  enforceAppCheck: ENFORCE_APP_CHECK,
  secrets: [ALLOWED_EMAILS],
  // Small caps: admin traffic is tiny, and this bounds cost if someone hammers the endpoints.
  maxInstances: 3,
  concurrency: 20,
  memory: "256MiB",
  timeoutSeconds: 120,
};

type Handler = (svc: AdminService, auth: AuthContext | undefined, data: unknown) => Promise<unknown>;

/**
 * Wraps a service method: maps deliberate `AdminError`s to `HttpsError`, hides everything else
 * behind `internal`, and logs only the actor uid + action (never tokens, never request bodies).
 */
function adminCallable(action: string, handler: Handler) {
  return onCall(callableOptions, async (request: CallableRequest<unknown>) => {
    const actorUid = request.auth?.uid ?? null;
    try {
      const auth: AuthContext | undefined = request.auth ? { uid: request.auth.uid, token: request.auth.token } : undefined;
      const result = await handler(getService(), auth, request.data);
      logger.info("admin action", { action, actorUid, outcome: "ok" });
      return result;
    } catch (error) {
      if (error instanceof AdminError) {
        const level = error.code === "permission-denied" || error.code === "unauthenticated" ? "warn" : "info";
        logger[level]("admin action refused", { action, actorUid, code: error.code, reason: error.reason ?? null });
        throw new HttpsError(error.code, error.message, error.reason ? { reason: error.reason } : undefined);
      }
      logger.error("admin action failed", {
        action,
        actorUid,
        errorCode: typeof (error as { code?: unknown })?.code === "string" ? (error as { code: string }).code : null,
      });
      throw new HttpsError("internal", "Internal error.");
    }
  });
}

export const adminListUsers = adminCallable("listUsers", (s, a, d) => s.listUsers(a, d));
export const adminGetUser = adminCallable("getUser", (s, a, d) => s.getUser(a, d));
export const adminSetDisabled = adminCallable("setDisabled", (s, a, d) => s.setDisabled(a, d));
export const adminDeleteUser = adminCallable("deleteUser", (s, a, d) => s.deleteUser(a, d));
export const adminSetAdmin = adminCallable("setAdmin", (s, a, d) => s.setAdmin(a, d));
export const adminStats = adminCallable("stats", (s, a, d) => s.stats(a, d));
export const adminListAuditLog = adminCallable("listAuditLog", (s, a, d) => s.listAuditLog(a, d));

/**
 * Data never outlives an account, however the account is deleted (admin panel, the user's own
 * "delete account" in the app, or the Firebase console). It first writes blocked/{uid}, so the
 * rules refuse the uid at once even though its ID token stays valid for up to an hour, then
 * deletes users/{uid} recursively. The block stays (a uid is never reused) and schedules a second
 * erase an hour later (sweepDeletedUsers). 2nd gen has no Auth onDelete trigger, so this one
 * stays on the v1 API.
 */
export const onUserDeleted = functionsV1
  .region(REGION)
  .runWith({ memory: "256MB", timeoutSeconds: 300, maxInstances: 10 })
  .auth.user()
  .onDelete(async (user) => {
    if (!isUid(user.uid)) {
      logger.error("onUserDeleted: unexpected uid format, skipping");
      return;
    }
    await handleUserDeleted(createQuotaPort(getFirestore()), user.uid);
    logger.info("user blocked and data deleted", { uid: user.uid });
  });

// ---------- Quotas (per-user document caps; QUOTAS in @cold-forge/sync) ----------

const triggerOptions = { region: REGION, memory: "256MiB" as const, maxInstances: 10, timeoutSeconds: 60 };

function countCreate(kind: CountedKind) {
  return onDocumentCreated({ ...triggerOptions, document: `users/{uid}/${kind}/{id}` }, async (event) => {
    const uid = event.params.uid;
    if (!isUid(uid)) return;
    await onRecordCreated(createQuotaPort(getFirestore()), uid, kind, new Date(), logger);
  });
}

/** quota/{uid}.arcs += 1 per new arc; over QUOTAS.arcs → blocked/{uid} {reason: "quota"}. */
export const quotaOnArcCreated = countCreate("arcs");
/** quota/{uid}.habits += 1 per new habit; over QUOTAS.habits → blocked. */
export const quotaOnHabitCreated = countCreate("habits");

/** Daily: recount check-ins (count() aggregation) of recently active accounts; block over QUOTAS.checkIns. */
export const quotaRecountCheckIns = onSchedule(
  { schedule: "17 3 * * *", timeZone: "Etc/UTC", region: REGION, memory: "256MiB", timeoutSeconds: 540, maxInstances: 1, retryCount: 1 },
  async () => {
    await recountCheckIns(createQuotaPort(getFirestore()), new Date(), logger);
  },
);

/** Hourly: second erase of accounts deleted more than an hour ago (blocked/{uid}.sweepAfter). */
export const sweepDeletedAccounts = onSchedule(
  { schedule: "every 60 minutes", region: REGION, memory: "256MiB", timeoutSeconds: 300, maxInstances: 1 },
  async () => {
    await sweepDeletedUsers(createQuotaPort(getFirestore()), new Date(), logger);
  },
);
