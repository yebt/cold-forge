import { expect, test } from "bun:test";
import { PENDING_REQUEST_TTL_MS, linkNeedsConfirmation } from "./linkConfirm.ts";

const NOW = 1_800_000_000_000;

test("a link is confirmed unless this app just requested a code for that same email", () => {
  expect(linkNeedsConfirmation("victim@x.co", null, NOW)).toBe(true);
  expect(linkNeedsConfirmation("attacker@x.co", { email: "victim@x.co", at: NOW - 1000 }, NOW)).toBe(true);
  expect(linkNeedsConfirmation("me@x.co", { email: "Me@X.co", at: NOW - 1000 }, NOW)).toBe(false);
  expect(linkNeedsConfirmation("me@x.co", { email: "me@x.co", at: NOW - PENDING_REQUEST_TTL_MS - 1 }, NOW)).toBe(true);
  expect(linkNeedsConfirmation("me@x.co", { email: "me@x.co", at: NOW + 60_000 }, NOW)).toBe(true);
});
