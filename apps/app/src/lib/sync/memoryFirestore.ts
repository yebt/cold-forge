import type { DocTime, FirestorePort, PortDoc, Position, WriteOp } from "./firestoreTransport.ts";

/**
 * In-memory Firestore behind the `FirestorePort` interface: used by unit tests and by the mock
 * build (`VITE_FIREBASE_MOCK=1`, never in production). With `enforceRules` it mimics the parts of
 * firebase/firestore.rules the client depends on, rejecting the whole batch with
 * `permission-denied`: last-write-wins on `updatedAt` (strictly newer), createdAt immutable and
 * <= updatedAt, no deletes, live parent references (a habit's arc, a check-in's habit, the
 * profile's current arc) and blocked accounts (reads and writes refused).
 */
interface Stored {
  data: Record<string, unknown>;
  syncedAt: DocTime;
}

export interface MemoryFirestore {
  port: FirestorePort;
  /** Write as "another device" (realtime listeners fire). */
  commit(ops: WriteOp[]): Promise<void>;
  /** The next port calls, in order: fail with this Firestore error code, or `null` = succeed. */
  failNext(...codes: (string | null)[]): void;
  docs(): Map<string, Record<string, unknown>>;
  /** Server side (Admin SDK): blocks a uid (blocked/{uid}) or lifts the block. */
  setBlocked(uid: string, blocked: boolean): void;
  /** Server side (Admin SDK, onUserDeleted): removes users/{uid} and everything under it. */
  deleteUserData(uid: string): void;
  dump(): string;
  load(json: string): void;
  readonly stats: { reads: number; writes: number; commits: number };
}

const parentOf = (path: string) => path.slice(0, path.lastIndexOf("/"));
const idOf = (path: string) => path.slice(path.lastIndexOf("/") + 1);

function cmp(a: Position, b: Position): number {
  return a.at.seconds - b.at.seconds || a.at.nanos - b.at.nanos || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}

export function createMemoryFirestore(opts: { enforceRules?: boolean } = {}): MemoryFirestore {
  const store = new Map<string, Stored>();
  const blocked = new Set<string>();
  const uidOf = (path: string) => path.split("/")[1] ?? "";
  const denied = () => Object.assign(new Error("permission-denied"), { code: "permission-denied" });
  const checkRead = (path: string) => {
    if (opts.enforceRules && blocked.has(uidOf(path))) throw denied();
  };
  let clock = 1_700_000_000;
  const failures: (string | null)[] = [];
  const stats = { reads: 0, writes: 0, commits: 0 };
  type CollListener = { coll: string; after: Position | null; cb: (docs: PortDoc[]) => void };
  type DocListener = { path: string; cb: (doc: PortDoc | null) => void };
  const collListeners = new Set<CollListener>();
  const docListeners = new Set<DocListener>();

  const maybeFail = () => {
    const code = failures.shift();
    if (code) throw Object.assign(new Error(code), { code });
  };

  const toDoc = (path: string, s: Stored): PortDoc => ({ id: idOf(path), data: structuredClone(s.data), syncedAt: s.syncedAt, pending: false });

  function check(ops: WriteOp[]) {
    const after = new Map(store);
    for (const op of ops) {
      if (op.kind === "delete") after.delete(op.path);
      else after.set(op.path, { data: op.merge ? { ...after.get(op.path)?.data, ...op.data } : op.data, syncedAt: { seconds: 0, nanos: 0 } });
    }
    const deny = () => {
      throw denied();
    };
    for (const op of ops) {
      if (blocked.has(uidOf(op.path))) deny();
      if (op.kind !== "set") deny(); // clients never delete
      const prev = store.get(op.path);
      const next = after.get(op.path)!.data;
      if (prev && !(String(next.updatedAt) > String(prev.data.updatedAt))) deny();
      if (prev && "createdAt" in prev.data && next.createdAt !== prev.data.createdAt) deny();
      if ("createdAt" in next && String(next.createdAt) > String(next.updatedAt)) deny();
      if (!prev && parentOf(op.path).split("/").length === 2 && !("createdAt" in next)) deny(); // profile create
      const segs = op.path.split("/");
      const live = (path: string) => after.has(path) && !after.get(path)!.data.deletedAt;
      const arcPath = `users/${segs[1]}/arcs/${String(next.arcId)}`;
      if (segs[2] === "habits" && !(after.has(arcPath) && (next.deletedAt || live(arcPath)))) deny();
      if (segs[2] === "checkIns" && !live(`users/${segs[1]}/habits/${String(next.habitId)}`)) deny();
      if (segs.length === 2 && next.currentArcId != null && !after.has(`users/${segs[1]}/arcs/${String(next.currentArcId)}`)) deny();
    }
  }

  async function commit(ops: WriteOp[]) {
    maybeFail();
    if (opts.enforceRules) check(ops);
    const syncedAt = { seconds: ++clock, nanos: 0 };
    const touched: string[] = [];
    for (const op of ops) {
      if (op.kind === "delete") store.delete(op.path);
      else {
        const data = op.merge ? { ...store.get(op.path)?.data, ...op.data } : { ...op.data };
        store.set(op.path, { data, syncedAt });
      }
      touched.push(op.path);
    }
    stats.commits++;
    stats.writes += ops.length;
    // Listeners fire after the commit resolves, like the SDK's server-confirmed snapshots.
    queueMicrotask(() => {
      for (const l of collListeners) {
        const docs = touched
          .filter((p) => parentOf(p) === l.coll && store.has(p))
          .map((p) => toDoc(p, store.get(p)!))
          .filter((d) => !l.after || cmp({ at: d.syncedAt!, id: d.id }, l.after) > 0);
        if (docs.length) {
          stats.reads += docs.length;
          l.cb(docs);
        }
      }
      for (const l of docListeners) {
        if (touched.includes(l.path)) {
          stats.reads++;
          const s = store.get(l.path);
          l.cb(s ? toDoc(l.path, s) : null);
        }
      }
    });
  }

  function queryAfter(coll: string, after: Position | null, limit: number): PortDoc[] {
    const docs = [...store.entries()]
      .filter(([p]) => parentOf(p) === coll)
      .map(([p, s]) => toDoc(p, s))
      .filter((d) => !after || cmp({ at: d.syncedAt!, id: d.id }, after) > 0)
      .sort((a, b) => cmp({ at: a.syncedAt!, id: a.id }, { at: b.syncedAt!, id: b.id }))
      .slice(0, limit);
    stats.reads += Math.max(1, docs.length);
    return docs;
  }

  const port: FirestorePort = {
    commit,
    async queryAfter(coll, after, limit) {
      maybeFail();
      checkRead(coll);
      return queryAfter(coll, after, limit);
    },
    async get(path) {
      maybeFail();
      checkRead(path);
      stats.reads++;
      const s = store.get(path);
      return s ? toDoc(path, s) : null;
    },
    listenAfter(coll, after, cb, onError) {
      try {
        checkRead(coll);
      } catch (e) {
        queueMicrotask(() => onError(e));
        return () => undefined;
      }
      const l: CollListener = { coll, after, cb };
      collListeners.add(l);
      const initial = queryAfter(coll, after, 10_000);
      if (initial.length) queueMicrotask(() => cb(initial));
      return () => collListeners.delete(l);
    },
    listenDoc(path, cb, onError) {
      try {
        checkRead(path);
      } catch (e) {
        queueMicrotask(() => onError(e));
        return () => undefined;
      }
      const l: DocListener = { path, cb };
      docListeners.add(l);
      return () => docListeners.delete(l);
    },
  };

  return {
    port,
    commit,
    failNext: (...codes) => failures.push(...codes),
    docs: () => new Map([...store].map(([p, s]) => [p, s.data])),
    setBlocked(uid, on) {
      if (on) blocked.add(uid);
      else blocked.delete(uid);
    },
    deleteUserData(uid) {
      for (const p of [...store.keys()]) if (p === `users/${uid}` || p.startsWith(`users/${uid}/`)) store.delete(p);
    },
    dump: () => JSON.stringify({ clock, docs: [...store], blocked: [...blocked] }),
    load(json) {
      try {
        const v = JSON.parse(json) as { clock: number; docs: [string, Stored][]; blocked?: string[] };
        clock = v.clock;
        store.clear();
        for (const [p, s] of v.docs) store.set(p, s);
        blocked.clear();
        for (const uid of v.blocked ?? []) blocked.add(uid);
      } catch {
        /* start empty */
      }
    },
    stats,
  };
}
