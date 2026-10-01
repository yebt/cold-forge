import { describe, expect, test } from "bun:test";
import { createAppData } from "./model.ts";
import { createMemoryStore, createRepository, exportJSON, STORAGE_KEY } from "./repository.ts";

const data = createAppData(
  { kind: "custom", window: { startDate: "2026-10-01", endDate: "2026-12-31" }, habits: [{ name: "Run", emoji: "🏃" }], why: "", displayName: "", locale: "en" },
  "2026-10-01T00:00:00.000Z",
);

describe("repository", () => {
  test("empty store loads null", async () => {
    expect(await createRepository(createMemoryStore()).load()).toBeNull();
  });

  test("save → load → clear", async () => {
    const repo = createRepository(createMemoryStore());
    await repo.save(data);
    expect(await repo.load()).toEqual(data);
    await repo.clear();
    expect(await repo.load()).toBeNull();
  });

  test("corrupt JSON is treated as a fresh install", async () => {
    const repo = createRepository(createMemoryStore({ [STORAGE_KEY]: "{not json" }));
    expect(await repo.load()).toBeNull();
  });

  test("export wraps data", () => {
    const parsed = JSON.parse(exportJSON(data));
    expect(parsed.app).toBe("cold-forge");
    expect(parsed.data).toEqual(data);
  });
});
