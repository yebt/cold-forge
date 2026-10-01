import { expect, test } from "bun:test";
import { confirmMatches, formatRelative, initials, providerLabel, reasonValid, safePhoto } from "./format.ts";

test("formatRelative", () => {
  const now = Date.parse("2026-10-01T12:00:00Z");
  expect(formatRelative(null, now)).toBe("—");
  expect(formatRelative("2026-10-01T11:59:40Z", now)).toBe("just now");
  expect(formatRelative("2026-10-01T11:15:00Z", now)).toBe("45m ago");
  expect(formatRelative("2026-10-01T07:00:00Z", now)).toBe("5h ago");
  expect(formatRelative("2026-09-28T12:00:00Z", now)).toBe("3d ago");
  expect(formatRelative("2026-01-01T12:00:00Z", now)).toBe("Jan 1, 2026");
});

test("initials", () => {
  expect(initials("Sofía Ramírez", null)).toBe("SR");
  expect(initials(null, "liam.carter@x.com")).toBe("LC");
  expect(initials("", "")).toBe("?");
});

test("safePhoto only allows Google avatars over https", () => {
  expect(safePhoto("https://lh3.googleusercontent.com/a/x")).toBe("https://lh3.googleusercontent.com/a/x");
  expect(safePhoto("http://lh3.googleusercontent.com/a/x")).toBeNull();
  expect(safePhoto("https://evil.example/x.png")).toBeNull();
  expect(safePhoto("javascript:alert(1)")).toBeNull();
  expect(safePhoto(null)).toBeNull();
});

test("confirmMatches", () => {
  expect(confirmMatches(" Bob@Example.com ", "bob@example.com")).toBe(true);
  expect(confirmMatches("bob@example.co", "bob@example.com")).toBe(false);
  expect(confirmMatches("", "")).toBe(false);
});

test("reasonValid", () => {
  expect(reasonValid("ab")).toBe(false);
  expect(reasonValid(" spam ")).toBe(true);
  expect(reasonValid("x".repeat(501))).toBe(false);
  expect(reasonValid("a\nb c")).toBe(false);
});

test("providerLabel", () => {
  expect(providerLabel("google.com")).toBe("Google");
  expect(providerLabel("saml.x")).toBe("saml.x");
});
