// The single source of the caps (dependency-free module, bundled by build.ts).
import { QUOTAS } from "../../../packages/sync/src/quotas.ts";
import type { BlockReason } from "./ports.ts";

/**
 * Per-user caps on stored documents (billing-abuse protection, review finding H1).
 *
 * - Arcs and habits: a Firestore trigger on every create bumps `quota/{uid}.{arcs|habits}` with
 *   FieldValue.increment; going over `QUOTAS` writes `blocked/{uid}` {reason: "quota"}.
 * - Check-ins: too many writes to trigger on each one, so a daily job recounts them with count()
 *   aggregations (1 read per 1000 index entries) for accounts active in the last 2 days, plus the
 *   accounts whose last recount is oldest (so an account that only writes check-ins is still
 *   recounted at least weekly), and blocks anything over `QUOTAS.checkIns`.
 * - Deleted accounts: `blocked/{uid}` {reason: "deleted"} stays forever (a uid is never reused)
 *   and carries `sweepAfter`; an hourly job deletes `users/{uid}` once more after that time, in
 *   case a write was in flight while the account was being deleted.
 *
 * `quota/*` and `blocked/*` are client-inaccessible (no rule matches them). QUOTAS lives in
 * `@cold-forge/sync` so the app and the functions share one source.
 */

export type CountedKind = "arcs" | "habits";

export interface QuotaRow {
  uid: string;
  /** Last recounted number of check-ins, or null if never counted. */
  checkIns: number | null;
}

export interface QuotaPort {
  /** Increments `quota/{uid}.{kind}` by one and returns the new value. */
  increment(uid: string, kind: CountedKind, now: Date): Promise<number>;
  setBlocked(uid: string, reason: BlockReason): Promise<void>;
  /** Accounts whose quota doc changed since `since` (arc/habit created). */
  listActive(since: Date, limit: number): Promise<QuotaRow[]>;
  /** Accounts whose check-ins were recounted longest ago (before `before`). */
  listStale(before: Date, limit: number): Promise<QuotaRow[]>;
  countCheckIns(uid: string): Promise<number>;
  saveCheckIns(uid: string, count: number, now: Date): Promise<void>;
  /** Deleted accounts whose `sweepAfter` <= `now`. */
  listDueSweeps(now: Date, limit: number): Promise<string[]>;
  /** Recursively deletes `users/{uid}`. */
  deleteUserData(uid: string): Promise<void>;
  /** Clears `sweepAfter` (the block itself stays). */
  markSwept(uid: string): Promise<void>;
}

export interface Logger {
  info(message: string, data?: Record<string, unknown>): void;
  warn(message: string, data?: Record<string, unknown>): void;
}

export const QUOTA_JOB = {
  /** "Active" = an arc or habit created within this window. */
  activeWindowMs: 2 * 86_400_000,
  /** Everyone else is recounted at least this often. */
  staleAfterMs: 7 * 86_400_000,
  maxActivePerRun: 5_000,
  maxStalePerRun: 2_000,
  countConcurrency: 8,
  /** New check-in documents per day above which an account is logged as an outlier. */
  outlierPerDay: 5_000,
  /** A deleted account's data is erased once more this long after deletion. */
  sweepDelayMs: 60 * 60_000,
  maxSweepsPerRun: 200,
} as const;

/** Trigger body: one arc or habit was created under users/{uid}. */
export async function onRecordCreated(port: QuotaPort, uid: string, kind: CountedKind, now: Date, log: Logger): Promise<void> {
  const count = await port.increment(uid, kind, now);
  if (count > QUOTAS[kind]) {
    await port.setBlocked(uid, "quota");
    log.warn("quota exceeded: account blocked", { uid, kind, count, limit: QUOTAS[kind] });
  }
}

async function mapLimit<T>(items: readonly T[], limit: number, fn: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
      while (next < items.length) await fn(items[next++] as T);
    }),
  );
}

export interface RecountSummary {
  counted: number;
  blocked: string[];
  outliers: string[];
  totalCheckIns: number;
}

/** Daily job: recount check-ins of active and least-recently-counted accounts. */
export async function recountCheckIns(port: QuotaPort, now: Date, log: Logger): Promise<RecountSummary> {
  const [active, stale] = await Promise.all([
    port.listActive(new Date(now.getTime() - QUOTA_JOB.activeWindowMs), QUOTA_JOB.maxActivePerRun),
    port.listStale(new Date(now.getTime() - QUOTA_JOB.staleAfterMs), QUOTA_JOB.maxStalePerRun),
  ]);
  const rows = new Map<string, QuotaRow>();
  for (const r of [...active, ...stale]) rows.set(r.uid, r);
  const summary: RecountSummary = { counted: 0, blocked: [], outliers: [], totalCheckIns: 0 };
  await mapLimit([...rows.values()], QUOTA_JOB.countConcurrency, async (row) => {
    const count = await port.countCheckIns(row.uid);
    await port.saveCheckIns(row.uid, count, now);
    summary.counted++;
    summary.totalCheckIns += count;
    // New documents since the previous recount (cheap proxy for writes/day: updates aren't counted).
    const growth = row.checkIns === null ? count : count - row.checkIns;
    if (growth > QUOTA_JOB.outlierPerDay) {
      summary.outliers.push(row.uid);
      log.warn("quota outlier: many new check-ins since the last recount", { uid: row.uid, growth, count });
    }
    if (count > QUOTAS.checkIns) {
      await port.setBlocked(row.uid, "quota");
      summary.blocked.push(row.uid);
      log.warn("quota exceeded: account blocked", { uid: row.uid, kind: "checkIns", count, limit: QUOTAS.checkIns });
    }
  });
  log.info("check-in recount done", {
    counted: summary.counted,
    blocked: summary.blocked.length,
    outliers: summary.outliers.length,
    totalCheckIns: summary.totalCheckIns,
  });
  return summary;
}

/** Auth onDelete body: block the uid first (rules refuse it at once), then erase its data. */
export async function handleUserDeleted(port: Pick<QuotaPort, "setBlocked" | "deleteUserData">, uid: string): Promise<void> {
  await port.setBlocked(uid, "deleted");
  await port.deleteUserData(uid);
}

/** Hourly job: second erase of deleted accounts, an hour after deletion. */
export async function sweepDeletedUsers(port: QuotaPort, now: Date, log: Logger): Promise<number> {
  const due = await port.listDueSweeps(now, QUOTA_JOB.maxSweepsPerRun);
  for (const uid of due) {
    await port.deleteUserData(uid);
    await port.markSwept(uid);
  }
  if (due.length) log.info("deleted accounts swept", { count: due.length });
  return due.length;
}
