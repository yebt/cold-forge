import { invalid } from "./errors.ts";

/**
 * Strict input parsing for every callable. Each parser takes the raw `request.data` (attacker
 * controlled even for admins: a stolen session could send anything) and either returns a typed,
 * normalised value or throws `invalid-argument`. Unknown keys are rejected so typos and probing
 * fail loudly instead of being silently ignored.
 */

export const MAX_PAGE_SIZE = 100;
export const DEFAULT_PAGE_SIZE = 25;
export const DEFAULT_AUDIT_PAGE_SIZE = 50;

/**
 * Firebase uids are 1-128 chars. Google sign-in produces 28 alphanumerics; we also allow `_`, `-`
 * and `:` for uids created by tools. `/` and `.` are excluded on purpose: uids end up in Firestore
 * paths (`users/{uid}`) and must never be able to address another document.
 */
const UID_RE = /^[A-Za-z0-9_:-]{1,128}$/;
/** Opaque token from Auth `listUsers` (base64-ish). */
const AUTH_PAGE_TOKEN_RE = /^[A-Za-z0-9_\-+/=.]{1,1024}$/;
/** Our own audit-log cursor: a Firestore auto-id. */
const AUDIT_PAGE_TOKEN_RE = /^[A-Za-z0-9]{20}$/;
const CONTROL_RE = new RegExp("[\\u0000-\\u001f\\u007f-\\u009f\\u2028\\u2029]");

export const REASON_MIN = 3;
export const REASON_MAX = 500;
export const QUERY_MAX = 200;
export const EMAIL_MAX = 320;

type Raw = Record<string, unknown>;

function object(data: unknown, allowed: readonly string[]): Raw {
  if (data === undefined || data === null) return {};
  if (typeof data !== "object" || Array.isArray(data)) throw invalid("Expected an object.");
  const proto = Object.getPrototypeOf(data);
  if (proto !== Object.prototype && proto !== null) throw invalid("Expected a plain object.");
  for (const key of Object.keys(data)) {
    if (!allowed.includes(key)) throw invalid(`Unknown field: ${key.slice(0, 40)}`);
  }
  return data as Raw;
}

export function isUid(value: unknown): value is string {
  return typeof value === "string" && UID_RE.test(value);
}

function uid(value: unknown): string {
  if (!isUid(value)) throw invalid("Invalid uid.");
  return value;
}

function bool(value: unknown, name: string): boolean {
  if (typeof value !== "boolean") throw invalid(`${name} must be a boolean.`);
  return value;
}

function pageSize(value: unknown, fallback: number): number {
  if (value === undefined || value === null) return fallback;
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1 || value > MAX_PAGE_SIZE) {
    throw invalid(`pageSize must be an integer between 1 and ${MAX_PAGE_SIZE}.`);
  }
  return value;
}

function optionalToken(value: unknown, re: RegExp): string | null {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string" || !re.test(value)) throw invalid("Invalid pageToken.");
  return value;
}

/** Trimmed single-line text with no control characters. */
function text(value: unknown, name: string, min: number, max: number): string {
  if (typeof value !== "string") throw invalid(`${name} must be a string.`);
  const trimmed = value.trim();
  if (trimmed.length < min || trimmed.length > max) {
    throw invalid(`${name} must be ${min}-${max} characters.`);
  }
  if (CONTROL_RE.test(trimmed)) throw invalid(`${name} contains control characters.`);
  return trimmed;
}

export interface ListUsersInput {
  pageToken: string | null;
  pageSize: number;
  query: string | null;
}

export function parseListUsers(data: unknown): ListUsersInput {
  const raw = object(data, ["pageToken", "pageSize", "query"]);
  const query =
    raw.query === undefined || raw.query === null || (typeof raw.query === "string" && raw.query.trim() === "")
      ? null
      : text(raw.query, "query", 1, QUERY_MAX).toLowerCase();
  return {
    pageToken: optionalToken(raw.pageToken, AUTH_PAGE_TOKEN_RE),
    pageSize: pageSize(raw.pageSize, DEFAULT_PAGE_SIZE),
    query,
  };
}

export function parseUidOnly(data: unknown): { uid: string } {
  const raw = object(data, ["uid"]);
  return { uid: uid(raw.uid) };
}

export interface SetDisabledInput {
  uid: string;
  disabled: boolean;
  reason: string;
}

export function parseSetDisabled(data: unknown): SetDisabledInput {
  const raw = object(data, ["uid", "disabled", "reason"]);
  return {
    uid: uid(raw.uid),
    disabled: bool(raw.disabled, "disabled"),
    reason: text(raw.reason, "reason", REASON_MIN, REASON_MAX),
  };
}

export interface DeleteUserInput {
  uid: string;
  /** The target's email (or uid when the account has no email), typed by the admin. */
  confirm: string;
  reason: string | null;
}

export function parseDeleteUser(data: unknown): DeleteUserInput {
  const raw = object(data, ["uid", "confirm", "reason"]);
  return {
    uid: uid(raw.uid),
    confirm: text(raw.confirm, "confirm", 1, EMAIL_MAX).toLowerCase(),
    reason: raw.reason === undefined || raw.reason === null ? null : text(raw.reason, "reason", REASON_MIN, REASON_MAX),
  };
}

export function parseEmpty(data: unknown): void {
  object(data, []);
}

export interface ListAuditInput {
  pageToken: string | null;
  pageSize: number;
}

export function parseListAudit(data: unknown): ListAuditInput {
  const raw = object(data, ["pageToken", "pageSize"]);
  return {
    pageToken: optionalToken(raw.pageToken, AUDIT_PAGE_TOKEN_RE),
    pageSize: pageSize(raw.pageSize, DEFAULT_AUDIT_PAGE_SIZE),
  };
}

/** Loose check used to decide whether a search query is worth an exact-email lookup. */
export function looksLikeEmail(value: string): boolean {
  return value.length <= EMAIL_MAX && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}
