import {
  Timestamp,
  collection,
  doc,
  documentId,
  getDocFromServer,
  getDocsFromServer,
  limit,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  startAfter,
  writeBatch,
  type DocumentSnapshot,
  type Firestore,
  type QueryConstraint,
} from "firebase/firestore";
import type { FirestorePort, PortDoc, Position } from "../lib/sync/firestoreTransport.ts";

function toDoc(d: DocumentSnapshot): PortDoc {
  // `serverTimestamps: "none"`: a not-yet-acknowledged local write reads as null.
  const ts = d.get("syncedAt", { serverTimestamps: "none" }) as Timestamp | null | undefined;
  return {
    id: d.id,
    data: d.data({ serverTimestamps: "none" }) ?? {},
    syncedAt: ts instanceof Timestamp ? { seconds: ts.seconds, nanos: ts.nanoseconds } : null,
    pending: d.metadata.hasPendingWrites,
  };
}

/** Ordered by (syncedAt, doc id): the single-field index on syncedAt covers it, no composite index. */
function afterConstraints(after: Position | null): QueryConstraint[] {
  return [
    orderBy("syncedAt"),
    orderBy(documentId()),
    ...(after ? [startAfter(new Timestamp(after.at.seconds, after.at.nanos), after.id)] : []),
  ];
}

/** The real Firestore behind the transport's port. Reads go to the server, never the cache. */
export function firestorePort(db: Firestore): FirestorePort {
  return {
    async commit(ops) {
      const batch = writeBatch(db);
      for (const op of ops) {
        const ref = doc(db, op.path);
        if (op.kind === "delete") batch.delete(ref);
        else batch.set(ref, { ...op.data, syncedAt: serverTimestamp() }, { merge: op.merge === true });
      }
      await batch.commit();
    },
    async queryAfter(path, after, n) {
      const snap = await getDocsFromServer(query(collection(db, path), ...afterConstraints(after), limit(n)));
      return snap.docs.map(toDoc);
    },
    async get(path) {
      const d = await getDocFromServer(doc(db, path));
      return d.exists() ? toDoc(d) : null;
    },
    async listIds(path) {
      const snap = await getDocsFromServer(query(collection(db, path)));
      return snap.docs.map((d) => d.id);
    },
    listenAfter(path, after, onDocs, onError) {
      return onSnapshot(
        query(collection(db, path), ...afterConstraints(after)),
        (snap) => {
          const docs = snap
            .docChanges()
            .filter((c) => c.type !== "removed")
            .map((c) => toDoc(c.doc));
          if (docs.length) onDocs(docs);
        },
        onError,
      );
    },
    listenDoc(path, onDoc, onError) {
      return onSnapshot(doc(db, path), (d) => onDoc(d.exists() ? toDoc(d) : null), onError);
    },
  };
}
