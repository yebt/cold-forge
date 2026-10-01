import { describe, expect, test } from "bun:test";
import { MemoryRateLimiter } from "./rate-limit.ts";

describe("MemoryRateLimiter", () => {
  test("sliding window", () => {
    let now = 0;
    const rl = new MemoryRateLimiter(() => now);
    const rule = [{ limit: 3, windowMs: 1000 }];
    expect([rl.takeSync("k", rule), rl.takeSync("k", rule), rl.takeSync("k", rule)]).toEqual([true, true, true]);
    expect(rl.takeSync("k", rule)).toBe(false);
    expect(rl.takeSync("other", rule)).toBe(true);
    now = 999;
    expect(rl.takeSync("k", rule)).toBe(false);
    now = 1000; // the first hits slide out of the window
    expect(rl.takeSync("k", rule)).toBe(true);
  });

  test("multiple rules are all-or-nothing", () => {
    let now = 0;
    const rl = new MemoryRateLimiter(() => now);
    const rules = [
      { limit: 2, windowMs: 100 },
      { limit: 3, windowMs: 10_000 },
    ];
    expect(rl.takeSync("k", rules)).toBe(true);
    expect(rl.takeSync("k", rules)).toBe(true);
    expect(rl.takeSync("k", rules)).toBe(false); // short window full: long window must not be charged
    now = 200;
    expect(rl.takeSync("k", rules)).toBe(true); // 3rd hit in long window
    now = 400;
    expect(rl.takeSync("k", rules)).toBe(false); // long window full
  });

  test("sweep drops stale buckets and the bucket count is capped", async () => {
    let now = 0;
    const rl = new MemoryRateLimiter(() => now, 10);
    for (let i = 0; i < 50; i++) expect(await rl.take(`k${i}`, [{ limit: 1, windowMs: 100 }])).toBe(true);
    expect(rl.size).toBeLessThanOrEqual(10);
    now = 1000;
    rl.sweep();
    expect(rl.size).toBe(0);
  });
});
