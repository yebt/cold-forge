import { Database } from "bun:sqlite";
import { winterArcWindow, type Arc, type CheckIn, type Habit, type ISODate } from "@cold-forge/core";

interface ArcRow {
  id: string;
  title: string;
  start_date: string;
  end_date: string;
}

interface HabitRow {
  id: string;
  name: string;
  emoji: string;
  created_at: string;
}

/**
 * SQLite persistence. For now there is a single active arc (single-user MVP);
 * the schema already keys everything by arc so multi-user can be layered on later.
 */
export class Store {
  readonly db: Database;

  constructor(path = ":memory:") {
    this.db = new Database(path, { create: true, strict: true });
    this.db.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;");
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS arcs (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        start_date TEXT NOT NULL,
        end_date TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
      );
      CREATE TABLE IF NOT EXISTS habits (
        id TEXT PRIMARY KEY,
        arc_id TEXT NOT NULL REFERENCES arcs(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        emoji TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
      );
      CREATE TABLE IF NOT EXISTS check_ins (
        habit_id TEXT NOT NULL REFERENCES habits(id) ON DELETE CASCADE,
        date TEXT NOT NULL,
        PRIMARY KEY (habit_id, date)
      );
    `);
  }

  /** Returns the current arc, creating this year's Winter Arc on first use. */
  getOrCreateArc(year: number): Arc {
    let row = this.db.query<ArcRow, []>("SELECT * FROM arcs ORDER BY created_at DESC LIMIT 1").get();
    if (!row) {
      const { startDate, endDate } = winterArcWindow(year);
      row = { id: crypto.randomUUID(), title: `Winter Arc ${year}`, start_date: startDate, end_date: endDate };
      this.db
        .query("INSERT INTO arcs (id, title, start_date, end_date) VALUES ($id, $title, $start_date, $end_date)")
        .run({ ...row });
    }
    return {
      id: row.id,
      title: row.title,
      startDate: row.start_date,
      endDate: row.end_date,
      habits: this.listHabits(row.id),
    };
  }

  updateArc(id: string, patch: { title?: string; startDate?: ISODate; endDate?: ISODate }): void {
    this.db
      .query(
        `UPDATE arcs SET
           title = COALESCE($title, title),
           start_date = COALESCE($startDate, start_date),
           end_date = COALESCE($endDate, end_date)
         WHERE id = $id`,
      )
      .run({ id, title: patch.title ?? null, startDate: patch.startDate ?? null, endDate: patch.endDate ?? null });
  }

  listHabits(arcId: string): Habit[] {
    return this.db
      .query<HabitRow, [string]>("SELECT * FROM habits WHERE arc_id = ? ORDER BY created_at, rowid")
      .all(arcId)
      .map((r) => ({ id: r.id, name: r.name, emoji: r.emoji, createdAt: r.created_at }));
  }

  addHabit(arcId: string, name: string, emoji: string): Habit {
    const id = crypto.randomUUID();
    this.db
      .query("INSERT INTO habits (id, arc_id, name, emoji) VALUES (?, ?, ?, ?)")
      .run(id, arcId, name, emoji);
    return this.listHabits(arcId).find((h) => h.id === id)!;
  }

  deleteHabit(arcId: string, habitId: string): boolean {
    return this.db.query("DELETE FROM habits WHERE id = ? AND arc_id = ?").run(habitId, arcId).changes > 0;
  }

  listCheckIns(arcId: string): CheckIn[] {
    return this.db
      .query<{ habit_id: string; date: string }, [string]>(
        `SELECT c.habit_id, c.date FROM check_ins c
         JOIN habits h ON h.id = c.habit_id
         WHERE h.arc_id = ? ORDER BY c.date`,
      )
      .all(arcId)
      .map((r) => ({ habitId: r.habit_id, date: r.date }));
  }

  /** Flips a check-in and returns whether it is now done. */
  toggleCheckIn(habitId: string, date: ISODate): boolean {
    const removed = this.db.query("DELETE FROM check_ins WHERE habit_id = ? AND date = ?").run(habitId, date);
    if (removed.changes > 0) return false;
    this.db.query("INSERT INTO check_ins (habit_id, date) VALUES (?, ?)").run(habitId, date);
    return true;
  }
}
