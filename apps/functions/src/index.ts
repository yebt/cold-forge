import { initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";
import * as logger from "firebase-functions/logger";
import { defineBoolean, defineString } from "firebase-functions/params";
import * as functionsV1 from "firebase-functions/v1";
import { HttpsError, onCall, type CallableOptions, type CallableRequest } from "firebase-functions/v2/https";
import { AdminError } from "./errors.ts";
import { createAuthPort, createDataPort } from "./firebase.ts";
import { parseEmailList, type AuthContext } from "./guard.ts";
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
const ALLOWED_EMAILS = defineString("ADMIN_ALLOWED_EMAILS", {
  default: "",
  description: "Optional comma-separated allowlist of admin emails, enforced on top of the admin claim.",
});

initializeApp();

let service: AdminService | undefined;
function getService(): AdminService {
  service ??= createAdminService({
    auth: createAuthPort(getAuth()),
    data: createDataPort(getFirestore()),
    config: { allowedEmails: parseEmailList(ALLOWED_EMAILS.value()) },
  });
  return service;
}

const callableOptions: CallableOptions = {
  region: REGION,
  cors: ADMIN_ORIGIN,
  enforceAppCheck: ENFORCE_APP_CHECK,
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
 * "delete account", or the Firebase console). 2nd gen has no Auth onDelete trigger, so this one
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
    await createDataPort(getFirestore()).deleteUserData(user.uid);
    logger.info("user data deleted", { uid: user.uid });
  });
