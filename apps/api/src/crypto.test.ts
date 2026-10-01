import { describe, expect, test } from "bun:test";
import { isTokenShape, keyedHash, maskEmail, randomCode, randomToken, safeEqual } from "./crypto.ts";

describe("crypto", () => {
  test("tokens are 256-bit base64url and unique", () => {
    const tokens = new Set(Array.from({ length: 1000 }, () => randomToken()));
    expect(tokens.size).toBe(1000);
    for (const t of tokens) {
      expect(isTokenShape(t)).toBe(true);
      expect(Buffer.from(t, "base64url").length).toBe(32);
    }
  });

  test("codes are 6 digits, zero padded", () => {
    for (let i = 0; i < 1000; i++) expect(randomCode()).toMatch(/^\d{6}$/);
    expect(randomCode(() => 42)).toBe("000042");
  });

  test("codes reject values in the biased tail instead of using modulo", () => {
    // 4_294_000_000 is the first value of the biased tail (2^32 rounded down to a multiple of 1e6).
    const values = [4_294_967_295, 4_294_000_000, 123_456_789];
    expect(randomCode(() => values.shift()!)).toBe("456789");
    expect(values).toHaveLength(0);
    expect(randomCode(() => 4_293_999_999)).toBe("999999");
  });

  test("codes are roughly uniform", () => {
    const counts = Array(10).fill(0);
    for (let i = 0; i < 20_000; i++) counts[Number(randomCode()[0])]++;
    for (const c of counts) expect(Math.abs(c - 2000)).toBeLessThan(250);
  });

  test("keyed hashes depend on secret and purpose", () => {
    const s1 = Buffer.alloc(32, 1);
    const s2 = Buffer.alloc(32, 2);
    expect(keyedHash(s1, "session", "x")).toEqual(keyedHash(s1, "session", "x"));
    expect(safeEqual(keyedHash(s1, "session", "x"), keyedHash(s2, "session", "x"))).toBe(false);
    expect(safeEqual(keyedHash(s1, "session", "x"), keyedHash(s1, "login-token", "x"))).toBe(false);
    expect(safeEqual(Buffer.alloc(3), Buffer.alloc(4))).toBe(false);
  });

  test("masks emails for logs", () => {
    expect(maskEmail("yahir@gmail.com")).toBe("y***@gmail.com");
    expect(maskEmail("nope")).toBe("***");
  });
});
