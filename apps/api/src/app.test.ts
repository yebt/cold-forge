import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createRoutes } from "./app.ts";
import { Store } from "./store.ts";

let server: ReturnType<typeof Bun.serve>;
const api = (path: string, init?: RequestInit) => fetch(new URL(path, server.url), init);
const post = (path: string, body: unknown) =>
  api(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

beforeAll(() => {
  server = Bun.serve({ port: 0, routes: createRoutes(new Store(), () => new Date("2026-10-05T12:00:00Z")) });
});
afterAll(() => server.stop(true));

describe("api", () => {
  test("creates this year's winter arc on first request", async () => {
    const arc = await (await api("/api/arc")).json();
    expect(arc).toMatchObject({ title: "Winter Arc 2026", startDate: "2026-10-01", endDate: "2026-12-31", habits: [] });
  });

  test("habit + check-in flow feeds stats and share text", async () => {
    const res = await post("/api/habits", { name: "Ducha fría", emoji: "🧊" });
    expect(res.status).toBe(201);
    const habit = await res.json();

    for (const date of ["2026-10-03", "2026-10-04", "2026-10-05"]) {
      expect((await (await post("/api/check-ins/toggle", { habitId: habit.id, date })).json()).done).toBe(true);
    }

    const stats = await (await api("/api/stats?today=2026-10-05")).json();
    expect(stats.day).toBe(5);
    expect(stats.perfectStreak).toBe(3);

    const toggledOff = await (await post("/api/check-ins/toggle", { habitId: habit.id, date: "2026-10-05" })).json();
    expect(toggledOff.done).toBe(false);

    const { text } = await (await api("/api/share?today=2026-10-05")).json();
    expect(text).toContain("Ducha fría");
  });

  test("rejects bad input", async () => {
    expect((await post("/api/habits", { name: "  " })).status).toBe(400);
    expect((await post("/api/check-ins/toggle", { habitId: "nope", date: "2026-10-05" })).status).toBe(404);
    expect((await api("/api/stats?today=ayer")).status).toBe(400);
  });
});
