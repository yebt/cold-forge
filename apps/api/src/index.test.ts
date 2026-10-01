/** Process-level regressions: refusing to start (M4) and database file permissions (L4). */
import { describe, expect, test } from "bun:test";
import { chmodSync, mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDatabase } from "./db.ts";

const ENTRY = join(import.meta.dir, "index.ts");
const mode = (p: string) => statSync(p).mode & 0o777;

/** A clean environment (no inherited NODE_ENV/.env surprises). */
const baseEnv = (extra: Record<string, string>) => ({ PATH: process.env.PATH ?? "", HOME: process.env.HOME ?? "", ...extra });

describe("startup", () => {
  test("refuses to start without a valid NODE_ENV", async () => {
    const dir = mkdtempSync(join(tmpdir(), "cf-api-"));
    try {
      for (const NODE_ENV of [undefined, "prod", "staging"]) {
        const proc = Bun.spawn(["bun", ENTRY], {
          cwd: dir,
          env: baseEnv(NODE_ENV === undefined ? {} : { NODE_ENV }),
          stdout: "pipe",
          stderr: "pipe",
        });
        const code = await proc.exited;
        const err = await new Response(proc.stderr).text();
        expect(code).toBe(1);
        expect(err).toContain("NODE_ENV must be one of production, development, test");
        expect(err).toContain("Refusing to start");
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("database, -wal and -shm are 0600 (umask + chmod of pre-existing files)", async () => {
    const dir = mkdtempSync(join(tmpdir(), "cf-api-"));
    const db = join(dir, "cf.sqlite");
    try {
      // A pre-existing, world-readable database file must be tightened.
      openDatabase(db).close();
      chmodSync(db, 0o644);
      const proc = Bun.spawn(["bun", ENTRY], {
        cwd: dir,
        env: baseEnv({ NODE_ENV: "development", DEV_CONSOLE_MAILER: "1", PORT: "0", DATABASE_PATH: db }),
        stdout: "pipe",
        stderr: "pipe",
      });
      try {
        const reader = proc.stdout.getReader();
        let out = "";
        while (!out.includes("listening on")) {
          const { value, done } = await reader.read();
          if (done) break;
          out += new TextDecoder().decode(value);
        }
        reader.releaseLock();
        expect(out).toContain("listening on http://127.0.0.1:");
        for (const f of [db, `${db}-wal`, `${db}-shm`]) expect([f, mode(f)]).toEqual([f, 0o600]);
      } finally {
        proc.kill(); // by PID (Bun.spawn handle), never by pattern
        await proc.exited;
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 20_000);
});
