/**
 * Small, explicit crypto helpers. All randomness comes from the OS CSPRNG (crypto.getRandomValues).
 */
import { createHmac, timingSafeEqual } from "node:crypto";

/** 32 bytes = 256 bits, encoded as 43 base64url characters. */
export const TOKEN_BYTES = 32;
const TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;

/** A random 256-bit token, base64url without padding. */
export function randomToken(bytes = TOKEN_BYTES): string {
  return Buffer.from(crypto.getRandomValues(new Uint8Array(bytes))).toString("base64url");
}

/** True if `v` has the exact shape of a token produced by `randomToken()`. */
export function isTokenShape(v: string): boolean {
  return TOKEN_RE.test(v);
}

// Largest multiple of 1_000_000 that fits in a uint32. Values at or above it are rejected
// so every 6-digit code is equally likely (no modulo bias).
const CODE_SPACE = 1_000_000;
const CODE_LIMIT = Math.floor(0x1_0000_0000 / CODE_SPACE) * CODE_SPACE;

/** A uniformly random 6-digit code, zero-padded ("000000"–"999999"). */
export function randomCode(rand: () => number = randomUint32): string {
  for (;;) {
    const n = rand();
    if (n < CODE_LIMIT) return String(n % CODE_SPACE).padStart(6, "0");
  }
}

function randomUint32(): number {
  return crypto.getRandomValues(new Uint32Array(1))[0]!;
}

/**
 * Purposes keep hashes from one context from ever being valid in another
 * (a session token hash can never match a login-link hash, etc.).
 */
export type HashPurpose = "login-code" | "login-token" | "session";

/** HMAC-SHA256(secret, purpose \0 value). Only these digests are ever stored. */
export function keyedHash(secret: Buffer, purpose: HashPurpose, value: string): Buffer {
  return createHmac("sha256", secret).update(purpose).update("\0").update(value).digest();
}

/** Constant-time comparison of two digests. Different lengths → false (lengths are not secret). */
export function safeEqual(a: Uint8Array, b: Uint8Array): boolean {
  return a.length === b.length && timingSafeEqual(a, b);
}

/** y***@gmail.com — for logs. Never log a full address in production. */
export function maskEmail(email: string): string {
  const at = email.lastIndexOf("@");
  if (at < 1) return "***";
  return `${email[0]}***${email.slice(at)}`;
}
