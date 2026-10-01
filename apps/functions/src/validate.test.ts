import { describe, expect, test } from "bun:test";
import { AdminError } from "./errors.ts";
import {
  isUid,
  looksLikeEmail,
  parseDeleteUser,
  parseEmpty,
  parseListAudit,
  parseListUsers,
  parseSetDisabled,
  parseUidOnly,
} from "./validate.ts";

function rejects(fn: () => unknown) {
  try {
    fn();
  } catch (error) {
    expect(error).toBeInstanceOf(AdminError);
    expect((error as AdminError).code).toBe("invalid-argument");
    return;
  }
  throw new Error("expected invalid-argument");
}

const UID = "AbCdEfGhIjKlMnOpQrStUvWxYz12";

describe("uid", () => {
  test("accepts Google-style and tool uids", () => {
    expect(isUid(UID)).toBe(true);
    expect(isUid("seed_user-1:x")).toBe(true);
  });
  test("rejects path tricks, empties, oversize and non-strings", () => {
    for (const bad of ["", "a/b", "../users", "a.b", "x".repeat(129), " a", "a\n", 42, null, undefined, {}, ["a"]]) {
      expect(isUid(bad)).toBe(false);
    }
  });
  test("parseUidOnly", () => {
    expect(parseUidOnly({ uid: UID })).toEqual({ uid: UID });
    rejects(() => parseUidOnly({ uid: "users/x" }));
    rejects(() => parseUidOnly({}));
  });
});

describe("object shape", () => {
  test("rejects non-objects, arrays and unknown keys", () => {
    rejects(() => parseUidOnly("x"));
    rejects(() => parseUidOnly([UID]));
    rejects(() => parseUidOnly({ uid: UID, extra: 1 }));
    rejects(() => parseUidOnly({ uid: UID, __proto__: { admin: true } }));
    rejects(() => parseUidOnly(new Date()));
  });
  test("parseEmpty accepts nothing but empty input", () => {
    expect(() => parseEmpty(undefined)).not.toThrow();
    expect(() => parseEmpty(null)).not.toThrow();
    expect(() => parseEmpty({})).not.toThrow();
    rejects(() => parseEmpty({ a: 1 }));
  });
});

describe("parseListUsers", () => {
  test("defaults", () => {
    expect(parseListUsers(undefined)).toEqual({ pageToken: null, pageSize: 25, query: null });
    expect(parseListUsers({ query: "   ", pageToken: "" })).toEqual({ pageToken: null, pageSize: 25, query: null });
  });
  test("normalises query", () => {
    expect(parseListUsers({ query: "  Foo@Bar.com " }).query).toBe("foo@bar.com");
  });
  test("bounds pageSize", () => {
    expect(parseListUsers({ pageSize: 100 }).pageSize).toBe(100);
    for (const bad of [0, 101, 1.5, -1, "10", Number.NaN, Infinity]) rejects(() => parseListUsers({ pageSize: bad }));
  });
  test("validates page tokens and queries", () => {
    expect(parseListUsers({ pageToken: "AbC-_+/=." }).pageToken).toBe("AbC-_+/=.");
    for (const bad of ["a b", "x".repeat(1025), 5, "<script>"]) rejects(() => parseListUsers({ pageToken: bad }));
    rejects(() => parseListUsers({ query: "x".repeat(201) }));
    rejects(() => parseListUsers({ query: "a\u0000b" }));
    rejects(() => parseListUsers({ query: 12 }));
  });
});

describe("mutations", () => {
  test("setDisabled requires boolean and a reason", () => {
    expect(parseSetDisabled({ uid: UID, disabled: true, reason: "  spam  " })).toEqual({ uid: UID, disabled: true, reason: "spam" });
    rejects(() => parseSetDisabled({ uid: UID, disabled: "true", reason: "spam" }));
    rejects(() => parseSetDisabled({ uid: UID, disabled: true }));
    rejects(() => parseSetDisabled({ uid: UID, disabled: true, reason: "ab" }));
    rejects(() => parseSetDisabled({ uid: UID, disabled: true, reason: "x".repeat(501) }));
    rejects(() => parseSetDisabled({ uid: UID, disabled: true, reason: "line\nbreak" }));
  });
  test("deleteUser lower-cases confirm, reason optional", () => {
    expect(parseDeleteUser({ uid: UID, confirm: " A@B.co " })).toEqual({ uid: UID, confirm: "a@b.co", reason: null });
    rejects(() => parseDeleteUser({ uid: UID }));
    rejects(() => parseDeleteUser({ uid: UID, confirm: "" }));
    rejects(() => parseDeleteUser({ uid: UID, confirm: "a@b.co", reason: 1 }));
  });
});

describe("parseListAudit", () => {
  test("accepts Firestore auto ids only", () => {
    expect(parseListAudit({ pageToken: "abcdefghijKLMNOPQRST" }).pageToken).toBe("abcdefghijKLMNOPQRST");
    expect(parseListAudit({}).pageSize).toBe(50);
    rejects(() => parseListAudit({ pageToken: "short" }));
    rejects(() => parseListAudit({ pageToken: "abcdefghij/LMNOPQRST" }));
  });
});

test("looksLikeEmail", () => {
  expect(looksLikeEmail("a@b.co")).toBe(true);
  expect(looksLikeEmail("ab.co")).toBe(false);
  expect(looksLikeEmail("a @b.co")).toBe(false);
});
