import { expect, test } from "bun:test";
import { parseAuthHash, parseAuthUrl } from "./authLink.ts";

const TOKEN = "AbC_-" + "x".repeat(38);

test("accepts only the exact auth link shape", () => {
  expect(parseAuthHash(`#/auth?token=${TOKEN}`)).toBe(TOKEN);
  expect(parseAuthHash(`#/auth?token=short`)).toBeNull();
  expect(parseAuthHash(`#/auth?token=${TOKEN}&next=https://evil.com`)).toBeNull();
  expect(parseAuthHash(`#/auth?token=${TOKEN}<script>`)).toBeNull();
  expect(parseAuthHash(`#/other?token=${TOKEN}`)).toBeNull();
  expect(parseAuthHash("")).toBeNull();
  expect(parseAuthUrl(`https://app.coldforge.app/#/auth?token=${TOKEN}`)).toBe(TOKEN);
  expect(parseAuthUrl("not a url")).toBeNull();
});
