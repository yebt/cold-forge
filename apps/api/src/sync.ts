/**
 * Sync engine. One request = one IMMEDIATE transaction:
 *   1. apply incoming records with last-write-wins (`incomingWins`; ties keep the stored record),
 *   2. every write takes the user's next `seq`,
 *   3. enforce per-user storage quotas (rolls everything back if exceeded),
 *   4. return everything with `seq > cursor`, paginated (`hasMore`).
 *
 * Every statement filters by `user_id = $user` — the authenticated user — so ids sent by one user
 * can never read or touch another user's rows, even when they collide.
 */
import type { Database } from "bun:sqlite";
import {
  QUOTAS,
  incomingWins,
  SYNC_PROTOCOL_VERSION,
  type SyncArc,
  type SyncChanges,
  type SyncCheckIn,
  type SyncHabit,
  type SyncProfile,
  type SyncRequest,
  type SyncResponse,
} from "@cold-forge/sync";
import type { Clock } from "./config.ts";

export interface Quotas {
  arcs: number;
  habits: number;
  checkIns: number;
}

/** Rows a single user may store (tombstones included). Generous for a 92-day habit tracker. */
export const DEFAULT_QUOTAS: Quotas = { ...QUOTAS };

/** Max records per response page. Clients keep pulling while `hasMore` is true. */
export const DEFAULT_PAGE_SIZE = 5_000;

/** Kept as an alias so call sites read naturally; `hasMore` is part of the shared contract. */
export type SyncPage = SyncResponse;

export class SyncError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
  ) {
    super(code);
  }
}

const CURSOR = /^v1\.(0|[1-9]\d{0,14})$/;
export const encodeCursor = (seq: number) => `v1.${seq}`;

/** Parses an opaque cursor. null → from the beginning. Throws on anything malformed. */
export function decodeCursor(cursor: string | null): number {
  if (cursor === null) return 0;
  const m = CURSOR.exec(cursor);
  if (!m) throw new SyncError(400, "invalid_cursor");
  return Number(m[1]);
}

interface ArcRow {
  id: string;
  kind: "winter" | "custom";
  start_date: string;
  end_date: string;
  why: string;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}
interface HabitRow {
  id: string;
  arc_id: string;
  template_id: string | null;
  name: string;
  emoji: string;
  sort_order: number;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}
interface CheckInRow {
  habit_id: string;
  date: string;
  done: number;
  updated_at: string;
}
interface ProfileRow {
  display_name: string;
  locale: string;
  current_arc_id: string | null;
  updated_at: string;
}
type Stamp = { updated_at: string } | null;

const toArc = (r: ArcRow): SyncArc => ({
  id: r.id,
  kind: r.kind,
  startDate: r.start_date as SyncArc["startDate"],
  endDate: r.end_date as SyncArc["endDate"],
  why: r.why,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
  ...(r.deleted_at ? { deletedAt: r.deleted_at } : {}),
});
const toHabit = (r: HabitRow): SyncHabit => ({
  id: r.id,
  arcId: r.arc_id,
  ...(r.template_id ? { templateId: r.template_id as NonNullable<SyncHabit["templateId"]> } : {}),
  name: r.name,
  emoji: r.emoji,
  order: r.sort_order,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
  ...(r.deleted_at ? { deletedAt: r.deleted_at } : {}),
});
const toCheckIn = (r: CheckInRow): SyncCheckIn => ({
  habitId: r.habit_id,
  date: r.date as SyncCheckIn["date"],
  done: r.done === 1,
  updatedAt: r.updated_at,
});
const toProfile = (r: ProfileRow): SyncProfile => ({
  displayName: r.display_name,
  locale: r.locale as SyncProfile["locale"],
  currentArcId: r.current_arc_id,
  updatedAt: r.updated_at,
});
const stamp = (row: Stamp) => (row ? { updatedAt: row.updated_at } : undefined);

export class SyncService {
  constructor(
    private readonly db: Database,
    private readonly now: Clock,
    private readonly quotas: Quotas = DEFAULT_QUOTAS,
    private readonly pageSize: number = DEFAULT_PAGE_SIZE,
  ) {}

  sync(userId: string, req: SyncRequest): SyncPage {
    return this.db.transaction((): SyncPage => {
      const user = this.db.query("SELECT seq FROM users WHERE id = ?").get(userId) as { seq: number } | null;
      if (!user) throw new SyncError(401, "unauthorized");
      const cursor = decodeCursor(req.cursor);
      // A cursor from the future (another account, a restored DB…) is invalid: the client resets to null.
      if (cursor > user.seq) throw new SyncError(400, "invalid_cursor");

      let seq = user.seq;
      const next = () => ++seq;
      this.applyArcs(userId, req.changes.arcs, next);
      this.applyHabits(userId, req.changes.habits, next);
      this.applyCheckIns(userId, req.changes.checkIns, next);
      if (req.changes.profile) this.applyProfile(userId, req.changes.profile, next);
      if (seq !== user.seq) this.db.query("UPDATE users SET seq = ? WHERE id = ?").run(seq, userId);

      this.enforceQuotas(userId);
      return this.page(userId, cursor, seq);
    }).immediate();
  }

  /** Everything the user has, tombstones included (data portability). */
  export(userId: string): SyncChanges {
    return this.read(userId, 0, Number.MAX_SAFE_INTEGER);
  }

  private applyArcs(userId: string, arcs: readonly SyncArc[], next: () => number): void {
    const get = this.db.query("SELECT updated_at FROM arcs WHERE user_id = ? AND id = ?");
    const put = this.db.query(
      `INSERT INTO arcs (user_id, id, kind, start_date, end_date, why, created_at, updated_at, deleted_at, seq)
       VALUES ($user, $id, $kind, $start, $end, $why, $created, $updated, $deleted, $seq)
       ON CONFLICT (user_id, id) DO UPDATE SET
         kind = excluded.kind, start_date = excluded.start_date, end_date = excluded.end_date, why = excluded.why,
         created_at = excluded.created_at, updated_at = excluded.updated_at, deleted_at = excluded.deleted_at,
         seq = excluded.seq`,
    );
    for (const a of arcs) {
      if (!incomingWins(stamp(get.get(userId, a.id) as Stamp), a)) continue;
      put.run({
        user: userId,
        id: a.id,
        kind: a.kind,
        start: a.startDate,
        end: a.endDate,
        why: a.why,
        created: a.createdAt,
        updated: a.updatedAt,
        deleted: a.deletedAt ?? null,
        seq: next(),
      });
    }
  }

  private applyHabits(userId: string, habits: readonly SyncHabit[], next: () => number): void {
    const get = this.db.query("SELECT updated_at FROM habits WHERE user_id = ? AND id = ?");
    const put = this.db.query(
      `INSERT INTO habits (user_id, id, arc_id, template_id, name, emoji, sort_order, created_at, updated_at, deleted_at, seq)
       VALUES ($user, $id, $arc, $template, $name, $emoji, $order, $created, $updated, $deleted, $seq)
       ON CONFLICT (user_id, id) DO UPDATE SET
         arc_id = excluded.arc_id, template_id = excluded.template_id, name = excluded.name, emoji = excluded.emoji,
         sort_order = excluded.sort_order, created_at = excluded.created_at, updated_at = excluded.updated_at,
         deleted_at = excluded.deleted_at, seq = excluded.seq`,
    );
    for (const h of habits) {
      if (!incomingWins(stamp(get.get(userId, h.id) as Stamp), h)) continue;
      put.run({
        user: userId,
        id: h.id,
        arc: h.arcId,
        template: h.templateId ?? null,
        name: h.name,
        emoji: h.emoji,
        order: h.order,
        created: h.createdAt,
        updated: h.updatedAt,
        deleted: h.deletedAt ?? null,
        seq: next(),
      });
    }
  }

  private applyCheckIns(userId: string, checkIns: readonly SyncCheckIn[], next: () => number): void {
    // Habits were applied first, so habits from this same batch count as owned.
    const owns = this.db.query("SELECT 1 FROM habits WHERE user_id = ? AND id = ?");
    const get = this.db.query("SELECT updated_at FROM check_ins WHERE user_id = ? AND habit_id = ? AND date = ?");
    const put = this.db.query(
      `INSERT INTO check_ins (user_id, habit_id, date, done, updated_at, seq)
       VALUES ($user, $habit, $date, $done, $updated, $seq)
       ON CONFLICT (user_id, habit_id, date) DO UPDATE SET
         done = excluded.done, updated_at = excluded.updated_at, seq = excluded.seq`,
    );
    const owned = new Map<string, boolean>();
    for (const c of checkIns) {
      let mine = owned.get(c.habitId);
      if (mine === undefined) {
        mine = owns.get(userId, c.habitId) !== null;
        owned.set(c.habitId, mine);
      }
      if (!mine) continue; // Unknown or foreign habit: ignored, never an error that reveals anything.
      if (!incomingWins(stamp(get.get(userId, c.habitId, c.date) as Stamp), c)) continue;
      put.run({ user: userId, habit: c.habitId, date: c.date, done: c.done ? 1 : 0, updated: c.updatedAt, seq: next() });
    }
  }

  private applyProfile(userId: string, p: SyncProfile, next: () => number): void {
    const current = this.db.query("SELECT updated_at FROM profiles WHERE user_id = ?").get(userId) as Stamp;
    if (!incomingWins(stamp(current), p)) return;
    this.db
      .query(
        `INSERT INTO profiles (user_id, display_name, locale, current_arc_id, updated_at, seq)
         VALUES ($user, $name, $locale, $arc, $updated, $seq)
         ON CONFLICT (user_id) DO UPDATE SET
           display_name = excluded.display_name, locale = excluded.locale,
           current_arc_id = excluded.current_arc_id, updated_at = excluded.updated_at, seq = excluded.seq`,
      )
      .run({ user: userId, name: p.displayName, locale: p.locale, arc: p.currentArcId, updated: p.updatedAt, seq: next() });
  }

  private enforceQuotas(userId: string): void {
    const count = (sql: string) => (this.db.query(sql).get(userId) as { n: number }).n;
    if (
      count("SELECT COUNT(*) AS n FROM arcs WHERE user_id = ?") > this.quotas.arcs ||
      count("SELECT COUNT(*) AS n FROM habits WHERE user_id = ?") > this.quotas.habits ||
      count("SELECT COUNT(*) AS n FROM check_ins WHERE user_id = ?") > this.quotas.checkIns
    ) {
      // Thrown inside the transaction → every write of this request is rolled back.
      throw new SyncError(422, "quota_exceeded");
    }
  }

  private page(userId: string, cursor: number, headSeq: number): SyncPage {
    // Seqs are unique per user (each write takes a new one and a row keeps only its latest), so the
    // (pageSize+1)-th smallest seq above the cursor tells us exactly where this page must stop.
    const beyond = this.db
      .query(
        `SELECT seq FROM (
           SELECT seq FROM arcs WHERE user_id = $user AND seq > $cursor
           UNION ALL SELECT seq FROM habits WHERE user_id = $user AND seq > $cursor
           UNION ALL SELECT seq FROM check_ins WHERE user_id = $user AND seq > $cursor
           UNION ALL SELECT seq FROM profiles WHERE user_id = $user AND seq > $cursor
         ) ORDER BY seq LIMIT 1 OFFSET $offset`,
      )
      .get({ user: userId, cursor, offset: this.pageSize }) as { seq: number } | null;
    const upper = beyond ? beyond.seq - 1 : headSeq;
    return {
      protocol: SYNC_PROTOCOL_VERSION,
      cursor: encodeCursor(upper),
      changes: this.read(userId, cursor, upper),
      serverTime: new Date(this.now()).toISOString(),
      hasMore: beyond !== null,
    };
  }

  private read(userId: string, after: number, upTo: number): SyncChanges {
    const p = { user: userId, after, upTo };
    const range = "user_id = $user AND seq > $after AND seq <= $upTo ORDER BY seq";
    const profile = this.db.query(`SELECT * FROM profiles WHERE ${range}`).get(p) as ProfileRow | null;
    return {
      arcs: (this.db.query(`SELECT * FROM arcs WHERE ${range}`).all(p) as ArcRow[]).map(toArc),
      habits: (this.db.query(`SELECT * FROM habits WHERE ${range}`).all(p) as HabitRow[]).map(toHabit),
      checkIns: (this.db.query(`SELECT * FROM check_ins WHERE ${range}`).all(p) as CheckInRow[]).map(toCheckIn),
      profile: profile ? toProfile(profile) : null,
    };
  }
}
