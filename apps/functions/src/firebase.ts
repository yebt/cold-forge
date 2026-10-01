import type { Auth, UserRecord } from "firebase-admin/auth";
import { FieldValue, Timestamp, type DocumentData, type Firestore, type Query, type QueryDocumentSnapshot } from "firebase-admin/firestore";
import { AdminError } from "./errors.ts";
import type { AuditEntry, AuditRecord, AuthPort, AuthUser, BlockReason, DataPort, ProfileView, UserCounts } from "./ports.ts";
import { QUOTA_JOB, type QuotaPort, type QuotaRow } from "./quota.ts";
import { consumeWindow, type WindowState } from "./rateLimit.ts";
import { isUid } from "./validate.ts";

/** firebase-admin adapters for the ports. Only whitelisted fields leave these functions. */

export const AUDIT_COLLECTION = "adminAuditLog";
export const RATE_LIMIT_COLLECTION = "adminRateLimits";
/** `blocked/{uid}`: {reason, at, sweepAfter?}. Read by the Firestore rules (exists()). */
export const BLOCKED_COLLECTION = "blocked";
/** `quota/{uid}`: {arcs, habits, checkIns, checkInsCountedAt, updatedAt}. */
export const QUOTA_COLLECTION = "quota";

const BLOCK_RANK: Record<BlockReason, number> = { disabled: 1, quota: 2, deleted: 3 };
const isBlockReason = (v: unknown): v is BlockReason => v === "disabled" || v === "quota" || v === "deleted";

/**
 * Writes blocked/{uid} unless a stronger reason is already there. A `deleted` block carries
 * `sweepAfter` for the delayed second erase (sweepDeletedUsers).
 */
async function writeBlock(db: Firestore, uid: string, reason: BlockReason): Promise<void> {
  const ref = db.collection(BLOCKED_COLLECTION).doc(uid);
  await db.runTransaction(async (tx) => {
    const current = (await tx.get(ref)).get("reason");
    if (isBlockReason(current) && BLOCK_RANK[current] >= BLOCK_RANK[reason]) {
      if (current !== "deleted" || reason !== "deleted") return;
    }
    tx.set(ref, {
      reason,
      at: FieldValue.serverTimestamp(),
      ...(reason === "deleted" ? { sweepAfter: Timestamp.fromMillis(Date.now() + QUOTA_JOB.sweepDelayMs) } : {}),
    });
  });
}

function iso(value: string | null | undefined): string | null {
  if (!value) return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
}

export function toAuthUser(record: UserRecord): AuthUser {
  return {
    uid: record.uid,
    email: record.email ?? null,
    emailVerified: record.emailVerified === true,
    displayName: record.displayName ?? null,
    photoURL: record.photoURL ?? null,
    disabled: record.disabled === true,
    createdAt: iso(record.metadata?.creationTime),
    lastSignIn: iso(record.metadata?.lastSignInTime),
    lastRefresh: iso(record.metadata?.lastRefreshTime),
    providers: (record.providerData ?? []).map((p) => p.providerId).filter((p): p is string => typeof p === "string"),
    tokensValidAfter: iso(record.tokensValidAfterTime),
  };
}

function isNotFound(error: unknown): boolean {
  return typeof error === "object" && error !== null && (error as { code?: unknown }).code === "auth/user-not-found";
}

function safeUid(uid: string): string {
  // Defence in depth: every path built from a uid goes through here.
  if (!isUid(uid)) throw new AdminError("invalid-argument", "Invalid uid.");
  return uid;
}

export function createAuthPort(auth: Auth): AuthPort {
  return {
    async getUser(uid) {
      try {
        return toAuthUser(await auth.getUser(safeUid(uid)));
      } catch (error) {
        if (isNotFound(error)) return null;
        throw error;
      }
    },
    async getUserByEmail(email) {
      try {
        return toAuthUser(await auth.getUserByEmail(email));
      } catch (error) {
        if (isNotFound(error)) return null;
        // Malformed emails are "no match" for search purposes.
        if ((error as { code?: unknown })?.code === "auth/invalid-email") return null;
        throw error;
      }
    },
    async listUsers(maxResults, pageToken) {
      try {
        const result = await auth.listUsers(maxResults, pageToken ?? undefined);
        return { users: result.users.map(toAuthUser), nextPageToken: result.pageToken ?? null };
      } catch (error) {
        if ((error as { code?: unknown })?.code === "auth/invalid-page-token") {
          throw new AdminError("invalid-argument", "Invalid pageToken.");
        }
        throw error;
      }
    },
    async setDisabled(uid, disabled) {
      await auth.updateUser(safeUid(uid), { disabled });
    },
    async revokeRefreshTokens(uid) {
      await auth.revokeRefreshTokens(safeUid(uid));
    },
    async deleteUser(uid) {
      try {
        await auth.deleteUser(safeUid(uid));
      } catch (error) {
        if (!isNotFound(error)) throw error;
      }
    },
  };
}

function str(value: unknown, max = 200): string | null {
  return typeof value === "string" ? value.slice(0, max) : null;
}

function timeValue(value: unknown): string | null {
  if (value instanceof Timestamp) return value.toDate().toISOString();
  if (typeof value === "string") return iso(value);
  return null;
}

export function toProfileView(doc: DocumentData): ProfileView {
  return {
    displayName: str(doc.displayName),
    locale: str(doc.locale, 10),
    currentArcId: str(doc.currentArcId, 128),
    createdAt: timeValue(doc.createdAt),
    updatedAt: timeValue(doc.updatedAt),
  };
}

/** Entries written by older versions (e.g. the removed `admin.grant` / `admin.revoke`) read as `unknown`. */
const AUDIT_ACTIONS = new Set(["user.view", "user.disable", "user.enable", "user.delete"]);

export function toAuditEntry(id: string, doc: DocumentData): AuditEntry {
  return {
    id,
    actorUid: str(doc.actorUid, 128) ?? "",
    actorEmail: str(doc.actorEmail, 320) ?? "",
    action: (AUDIT_ACTIONS.has(doc.action) ? doc.action : "unknown") as AuditEntry["action"],
    targetUid: str(doc.targetUid, 128) ?? "",
    targetEmail: str(doc.targetEmail, 320),
    reason: str(doc.reason, 500),
    outcome: doc.outcome === "error" || doc.outcome === "refused" ? doc.outcome : "ok",
    code: str(doc.code, 64),
    at: timeValue(doc.at),
  };
}

export function createDataPort(db: Firestore): DataPort {
  const userDoc = (uid: string) => db.collection("users").doc(safeUid(uid));
  const count = async (q: Query) => (await q.count().get()).data().count;

  return {
    async setBlocked(uid, reason) {
      await writeBlock(db, safeUid(uid), reason);
    },
    async unblockDisabled(uid) {
      const ref = db.collection(BLOCKED_COLLECTION).doc(safeUid(uid));
      return db.runTransaction(async (tx) => {
        const reason = (await tx.get(ref)).get("reason");
        if (reason === "disabled") {
          tx.delete(ref);
          return null;
        }
        return isBlockReason(reason) ? reason : null;
      });
    },
    async countUserData(uid): Promise<UserCounts> {
      const ref = userDoc(uid);
      const [arcs, habits, checkIns] = await Promise.all([
        count(ref.collection("arcs")),
        count(ref.collection("habits")),
        count(ref.collection("checkIns")),
      ]);
      return { arcs, habits, checkIns };
    },
    async getProfile(uid) {
      const snap = await userDoc(uid).get();
      const doc = snap.data();
      return snap.exists && doc ? toProfileView(doc) : null;
    },
    async deleteUserData(uid) {
      await db.recursiveDelete(userDoc(uid));
    },
    async countProfilesUpdatedSince(sinceIso) {
      return count(db.collection("users").where("updatedAt", ">=", sinceIso));
    },
    async countAllData() {
      const [arcs, habits, checkIns] = await Promise.all([
        count(db.collectionGroup("arcs")),
        count(db.collectionGroup("habits")),
        count(db.collectionGroup("checkIns")),
      ]);
      return { arcs, habits, checkIns };
    },
    async writeAudit(record: AuditRecord) {
      await db.collection(AUDIT_COLLECTION).add({ ...record, at: FieldValue.serverTimestamp() });
    },
    async listAudit(pageSize, afterId) {
      let query = db.collection(AUDIT_COLLECTION).orderBy("at", "desc").limit(pageSize + 1);
      if (afterId) {
        const cursor = await db.collection(AUDIT_COLLECTION).doc(afterId).get();
        if (!cursor.exists) throw new AdminError("invalid-argument", "Invalid pageToken.");
        query = query.startAfter(cursor);
      }
      const snap = await query.get();
      const docs = snap.docs.slice(0, pageSize);
      return {
        entries: docs.map((d) => toAuditEntry(d.id, d.data())),
        nextPageToken: snap.docs.length > pageSize ? (docs[docs.length - 1]?.id ?? null) : null,
      };
    },
    async consumeRateLimit(key, rule, now) {
      const ref = db.collection(RATE_LIMIT_COLLECTION).doc(key);
      return db.runTransaction(async (tx) => {
        const snap = await tx.get(ref);
        const raw = snap.data();
        const state: WindowState | null =
          raw && typeof raw.windowStart === "number" && typeof raw.count === "number"
            ? { windowStart: raw.windowStart, count: raw.count }
            : null;
        const { allowed, next } = consumeWindow(state, rule, now.getTime());
        if (allowed) {
          // `expiresAt` lets a Firestore TTL policy clean these up (optional).
          tx.set(ref, { ...next, expiresAt: Timestamp.fromMillis(next.windowStart + rule.windowMs * 2) });
        }
        return allowed;
      });
    },
  };
}

/** firebase-admin adapter for the quota jobs and triggers. */
export function createQuotaPort(db: Firestore): QuotaPort {
  const quota = db.collection(QUOTA_COLLECTION);
  const rows = (docs: QueryDocumentSnapshot[]): QuotaRow[] =>
    docs
      .filter((d) => isUid(d.id))
      .map((d) => ({ uid: d.id, checkIns: typeof d.get("checkIns") === "number" ? (d.get("checkIns") as number) : null }));
  return {
    async increment(uid, kind, now) {
      const ref = quota.doc(safeUid(uid));
      await ref.set({ [kind]: FieldValue.increment(1), updatedAt: Timestamp.fromDate(now) }, { merge: true });
      const value = (await ref.get()).get(kind);
      return typeof value === "number" ? value : 0;
    },
    async setBlocked(uid, reason) {
      await writeBlock(db, safeUid(uid), reason);
    },
    async listActive(since, limit) {
      return rows((await quota.where("updatedAt", ">=", Timestamp.fromDate(since)).limit(limit).get()).docs);
    },
    async listStale(before, limit) {
      const snap = await quota.where("checkInsCountedAt", "<", Timestamp.fromDate(before)).orderBy("checkInsCountedAt").limit(limit).get();
      return rows(snap.docs);
    },
    async countCheckIns(uid) {
      return (await db.collection("users").doc(safeUid(uid)).collection("checkIns").count().get()).data().count;
    },
    async saveCheckIns(uid, count, now) {
      await quota.doc(safeUid(uid)).set({ checkIns: count, checkInsCountedAt: Timestamp.fromDate(now) }, { merge: true });
    },
    async listDueSweeps(now, limit) {
      const snap = await db.collection(BLOCKED_COLLECTION).where("sweepAfter", "<=", Timestamp.fromDate(now)).limit(limit).get();
      return snap.docs.map((d) => d.id).filter(isUid);
    },
    async deleteUserData(uid) {
      await db.recursiveDelete(db.collection("users").doc(safeUid(uid)));
    },
    async markSwept(uid) {
      await db.collection(BLOCKED_COLLECTION).doc(safeUid(uid)).update({ sweepAfter: FieldValue.delete() });
    },
  };
}
