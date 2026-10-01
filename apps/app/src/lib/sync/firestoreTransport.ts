import {
  emptyChanges,
  type SyncArc,
  type SyncChanges,
  type SyncCheckIn,
  type SyncHabit,
  type SyncProfile,
} from "@cold-forge/sync";
import { err, ok, type SyncError, type SyncResult } from "./errors.ts";
import { checkRecord, type RecordKind } from "./outgoing.ts";
import type { SyncPage, SyncTransport } from "./transport.ts";

/**
 * Firestore implementation of SyncTransport, written against a tiny `FirestorePort` so the same
 * code runs on the real SDK (`src/firebase/port.ts`), an in-memory fake (tests, mock builds) and
 * the emulator.
 *
 * Layout (docs/firebase.md): `users/{uid}` = profile, `users/{uid}/arcs/{id}`,
 * `users/{uid}/habits/{id}`, `users/{uid}/checkIns/{habitId}_{date}`. Every write stamps
 * `syncedAt = serverTimestamp()`; pulls read each collection ordered by (syncedAt, doc id) after
 * the cursor's position for that collection.
 */

export interface DocTime {
  seconds: number;
  nanos: number;
}

export interface PortDoc {
  id: string;
  data: Record<string, unknown>;
  /** Server time of the last write; null while a local write is pending. */
  syncedAt: DocTime | null;
  /** A local write not yet acknowledged by the server (our own echo): ignored. */
  pending: boolean;
}

export type WriteOp =
  /** `syncedAt: serverTimestamp()` is added by the port. `merge` keeps fields not sent (profile `createdAt`). */
  | { kind: "set"; path: string; data: Record<string, unknown>; merge?: boolean }
  | { kind: "delete"; path: string };

export interface Position {
  at: DocTime;
  id: string;
}

export interface FirestorePort {
  /** One atomic batch (≤ 500 ops). Throws `{ code }` (Firestore error codes) on failure. */
  commit(ops: WriteOp[]): Promise<void>;
  /** Docs ordered by (syncedAt, doc id), strictly after `after`, from the server (not the cache). */
  queryAfter(collectionPath: string, after: Position | null, limit: number): Promise<PortDoc[]>;
  get(docPath: string): Promise<PortDoc | null>;
  /** Realtime version of `queryAfter`: called with docs added/changed since attaching. */
  listenAfter(collectionPath: string, after: Position | null, onDocs: (docs: PortDoc[]) => void, onError: (e: unknown) => void): () => void;
  listenDoc(docPath: string, onDoc: (doc: PortDoc | null) => void, onError: (e: unknown) => void): () => void;
}

export const PAGE_SIZE = 300;
/** Firestore allows 500 writes per batch; keep headroom. */
export const MAX_PUSH_RECORDS = 450;
/** Rules may make 20 `existsAfter()` lookups per batched write; keep headroom. */
export const MAX_PUSH_PARENTS = 15;

type Coll = "arcs" | "habits" | "checkIns";
const COLLS: Coll[] = ["arcs", "habits", "checkIns"];

// ---- Cursor ----

interface Cursor {
  arcs: Position | null;
  habits: Position | null;
  checkIns: Position | null;
  profile: DocTime | null;
}

const emptyCursor = (): Cursor => ({ arcs: null, habits: null, checkIns: null, profile: null });

function cmpTime(a: DocTime, b: DocTime): number {
  return a.seconds - b.seconds || a.nanos - b.nanos;
}

function cmpPos(a: Position, b: Position): number {
  return cmpTime(a.at, b.at) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}

const laterPos = (a: Position | null, b: Position | null) => (!a ? b : !b ? a : cmpPos(a, b) >= 0 ? a : b);
const laterTime = (a: DocTime | null, b: DocTime | null) => (!a ? b : !b ? a : cmpTime(a, b) >= 0 ? a : b);

const isTime = (v: unknown): v is DocTime =>
  typeof v === "object" && v !== null && Number.isInteger((v as DocTime).seconds) && Number.isInteger((v as DocTime).nanos);
const isPos = (v: unknown): v is Position =>
  typeof v === "object" && v !== null && isTime((v as Position).at) && typeof (v as Position).id === "string" && (v as Position).id.length <= 200;

export function encodeCursor(c: Cursor): string {
  const pos = (p: Position | null) => (p ? [p.at.seconds, p.at.nanos, p.id] : null);
  return JSON.stringify({ v: 1, a: pos(c.arcs), h: pos(c.habits), c: pos(c.checkIns), p: c.profile ? [c.profile.seconds, c.profile.nanos] : null });
}

/** Unknown or damaged cursors read as "from the beginning" (a full, idempotent re-pull). */
export function decodeCursor(raw: string | null): Cursor {
  if (!raw) return emptyCursor();
  try {
    const v = JSON.parse(raw) as Record<string, unknown>;
    if (v.v !== 1) return emptyCursor();
    const pos = (x: unknown): Position | null => {
      if (!Array.isArray(x) || x.length !== 3) return null;
      const p = { at: { seconds: x[0], nanos: x[1] }, id: x[2] };
      return isPos(p) ? p : null;
    };
    const p = Array.isArray(v.p) && v.p.length === 2 ? { seconds: v.p[0], nanos: v.p[1] } : null;
    return { arcs: pos(v.a), habits: pos(v.h), checkIns: pos(v.c), profile: isTime(p) ? p : null };
  } catch {
    return emptyCursor();
  }
}

export function maxCursor(a: string | null, b: string): string {
  const x = decodeCursor(a);
  const y = decodeCursor(b);
  return encodeCursor({
    arcs: laterPos(x.arcs, y.arcs),
    habits: laterPos(x.habits, y.habits),
    checkIns: laterPos(x.checkIns, y.checkIns),
    profile: laterTime(x.profile, y.profile),
  });
}

// ---- Errors ----

const errorCode = (e: unknown) => (typeof e === "object" && e !== null && "code" in e ? String((e as { code: unknown }).code) : "");

/**
 * Errors of reads (pull, realtime). The rules always let a signed-in owner read their own data,
 * so a read refused with permission-denied means the account is blocked (blocked/{uid}: disabled
 * by an admin, deleted, or over quota). Writes refused with permission-denied are usually a
 * rule rejecting data (`rejected`); the engine's re-pull then tells the two apart.
 */
export function mapReadError(e: unknown): SyncError {
  return errorCode(e) === "permission-denied" ? { kind: "blocked" } : mapFirestoreError(e);
}

export function mapFirestoreError(e: unknown): SyncError {
  switch (errorCode(e)) {
    case "permission-denied":
      return { kind: "rejected" };
    case "unauthenticated":
      return { kind: "unauthorized" };
    case "resource-exhausted":
      return { kind: "rate_limited", retryAfterMs: 60_000 };
    case "unavailable":
    case "deadline-exceeded":
    case "aborted":
    case "cancelled":
      return { kind: "network" };
    default:
      return { kind: "server" };
  }
}

// ---- Docs <-> records ----

export const checkInDocId = (c: Pick<SyncCheckIn, "habitId" | "date">) => `${c.habitId}_${c.date}`;

const pick = (data: Record<string, unknown>, keys: readonly string[]) => {
  const out: Record<string, unknown> = {};
  for (const k of keys) if (data[k] !== undefined && data[k] !== null) out[k] = data[k];
  return out;
};

const ARC_KEYS = ["id", "kind", "startDate", "endDate", "why", "createdAt", "updatedAt", "deletedAt"] as const;
const HABIT_KEYS = ["id", "arcId", "templateId", "name", "emoji", "order", "createdAt", "updatedAt", "deletedAt"] as const;
const CHECKIN_KEYS = ["habitId", "date", "done", "updatedAt"] as const;
const PROFILE_KEYS = ["displayName", "locale", "currentArcId", "updatedAt"] as const;

const timeMs = (t: DocTime | null) => (t ? t.seconds * 1000 + Math.floor(t.nanos / 1e6) : 0);

/**
 * A server doc as a validated record, or null (skipped, but the cursor still moves past it).
 * Records may be up to the server's clock (+ skew), even if ours is behind.
 */
function toRecord<T>(kind: RecordKind, doc: PortDoc, now: number): T | null {
  const keys = kind === "arcs" ? ARC_KEYS : kind === "habits" ? HABIT_KEYS : kind === "checkIns" ? CHECKIN_KEYS : PROFILE_KEYS;
  const raw = pick(doc.data, keys);
  if (kind === "profile" && !("currentArcId" in raw)) raw.currentArcId = null;
  // No write-time bounds here: a check-in written a year ago is still a valid record to read.
  const rec = checkRecord<T>(kind, raw as T, Math.max(now, timeMs(doc.syncedAt)), { bounds: false });
  if (!rec) return null;
  // The doc id must be the record id (rules enforce it; a mismatch is not ours to trust).
  if (kind === "arcs" || kind === "habits") return (rec as unknown as { id: string }).id === doc.id ? rec : null;
  if (kind === "checkIns") return checkInDocId(rec as unknown as SyncCheckIn) === doc.id ? rec : null;
  return rec;
}

export interface FirestoreTransportOptions {
  now?: () => number;
  pageSize?: number;
  /** Counts only (no contents) of server docs that failed validation. */
  onInvalidDocs?: (count: number) => void;
}

/**
 * Clients never delete documents (the rules refuse it): deletions are tombstones, and account
 * deletion is `user.delete()` in Firebase Auth, after which the onUserDeleted function blocks the
 * uid and removes `users/{uid}` recursively.
 */
export type FirestoreTransport = SyncTransport;

export function createFirestoreTransport(port: FirestorePort, uid: string, opts: FirestoreTransportOptions = {}): FirestoreTransport {
  const now = opts.now ?? Date.now;
  const pageSize = opts.pageSize ?? PAGE_SIZE;
  const userPath = `users/${uid}`;
  const coll = (c: Coll) => `${userPath}/${c}`;
  /** Learned from the last pull: whether `users/{uid}` exists (a new profile must carry `createdAt`). */
  let profileExists: boolean | null = null;

  /** Turns server docs into a page of changes, advancing `cursor` past every usable doc. */
  function absorb(cursor: Cursor, kind: Coll, docs: PortDoc[], changes: SyncChanges): number {
    let invalid = 0;
    const t = now();
    for (const doc of docs) {
      if (doc.pending || !doc.syncedAt) continue;
      const pos = { at: doc.syncedAt, id: doc.id };
      cursor[kind] = laterPos(cursor[kind], pos);
      const rec = toRecord<SyncArc | SyncHabit | SyncCheckIn>(kind, doc, t);
      if (!rec) {
        invalid++;
        continue;
      }
      (changes[kind] as unknown[]).push(rec);
    }
    return invalid;
  }

  function absorbProfile(cursor: Cursor, doc: PortDoc | null, changes: SyncChanges): number {
    if (!doc || doc.pending || !doc.syncedAt) return 0;
    if (cursor.profile && cmpTime(doc.syncedAt, cursor.profile) <= 0) return 0;
    cursor.profile = doc.syncedAt;
    const p = toRecord<SyncProfile>("profile", doc, now());
    if (!p) return 1;
    changes.profile = p;
    return 0;
  }

  const report = (n: number) => {
    if (n > 0) opts.onInvalidDocs?.(n);
  };

  return {
    maxPushRecords: MAX_PUSH_RECORDS,
    maxPushParents: MAX_PUSH_PARENTS,
    maxCursor,

    async pull(raw) {
      const cursor = decodeCursor(raw);
      const changes = emptyChanges();
      try {
        const [lists, profile] = await Promise.all([
          Promise.all(COLLS.map((c) => port.queryAfter(coll(c), cursor[c], pageSize))),
          port.get(userPath),
        ]);
        profileExists = profile !== null;
        let invalid = 0;
        COLLS.forEach((c, i) => (invalid += absorb(cursor, c, lists[i]!, changes)));
        invalid += absorbProfile(cursor, profile, changes);
        report(invalid);
        return ok({ cursor: encodeCursor(cursor), changes, hasMore: lists.some((l) => l.length >= pageSize) });
      } catch (e) {
        return err(mapReadError(e));
      }
    },

    async push(changes) {
      const ops: WriteOp[] = [];
      for (const a of changes.arcs) ops.push({ kind: "set", path: `${coll("arcs")}/${a.id}`, data: { ...a } });
      for (const h of changes.habits) ops.push({ kind: "set", path: `${coll("habits")}/${h.id}`, data: { ...h } });
      for (const c of changes.checkIns) ops.push({ kind: "set", path: `${coll("checkIns")}/${checkInDocId(c)}`, data: { ...c } });
      if (changes.profile) {
        const p = changes.profile;
        const data: Record<string, unknown> = {
          displayName: p.displayName,
          locale: p.locale,
          currentArcId: p.currentArcId,
          updatedAt: p.updatedAt,
        };
        if (profileExists !== true) {
          // A new profile: the rules need createdAt <= updatedAt (and keep createdAt forever).
          const nowIso = new Date(now()).toISOString();
          data.createdAt = p.updatedAt < nowIso ? p.updatedAt : nowIso;
        }
        ops.push({ kind: "set", path: userPath, data, merge: true });
      }
      if (ops.length === 0) return ok(undefined);
      try {
        await port.commit(ops);
        if (changes.profile) profileExists = true;
        return ok(undefined);
      } catch (e) {
        // A rejected profile create may just mean it already existed: re-learn on the next pull.
        if (changes.profile) profileExists = null;
        return err(mapFirestoreError(e));
      }
    },

    subscribe(raw, onPage, onError) {
      const cursor = decodeCursor(raw);
      const emit = (fill: (changes: SyncChanges) => number) => {
        const changes = emptyChanges();
        report(fill(changes));
        if (changes.arcs.length || changes.habits.length || changes.checkIns.length || changes.profile) {
          onPage({ cursor: encodeCursor(cursor), changes, hasMore: false });
        }
      };
      const fail = (e: unknown) => onError(err(mapReadError(e)));
      const unsubs = COLLS.map((c) =>
        port.listenAfter(coll(c), cursor[c], (docs) => emit((changes) => absorb(cursor, c, docs, changes)), fail),
      );
      unsubs.push(port.listenDoc(userPath, (doc) => emit((changes) => absorbProfile(cursor, doc, changes)), fail));
      return () => unsubs.forEach((u) => u());
    },
  };
}
