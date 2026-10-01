import { expect, test } from "bun:test";
import { consumeWindow } from "./rateLimit.ts";

const rule = { limit: 3, windowMs: 1000 };

test("allows up to the limit inside a window, then blocks", () => {
  let state = null;
  const results: boolean[] = [];
  for (let i = 0; i < 5; i++) {
    const r = consumeWindow(state, rule, 10_000 + i);
    results.push(r.allowed);
    state = r.next;
  }
  expect(results).toEqual([true, true, true, false, false]);
});

test("a new window resets the count", () => {
  const blocked = { windowStart: 10_000, count: 3 };
  expect(consumeWindow(blocked, rule, 10_999).allowed).toBe(false);
  expect(consumeWindow(blocked, rule, 11_000)).toEqual({ allowed: true, next: { windowStart: 11_000, count: 1 } });
});

test("clock going backwards or corrupt state starts a fresh window", () => {
  expect(consumeWindow({ windowStart: 50_000, count: 3 }, rule, 10_000).allowed).toBe(true);
  expect(consumeWindow({ windowStart: Number.NaN, count: 99 }, rule, 10_000).allowed).toBe(true);
});
