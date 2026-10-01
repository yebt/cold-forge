/**
 * The emailed sign-in link is `${APP_URL}/#/auth?token=…`. Only an exact match with a
 * base64url token is accepted; anything else in the hash is ignored.
 */
const AUTH_HASH = /^#\/auth\?token=([A-Za-z0-9_-]{32,128})$/;

export function parseAuthHash(hash: string): string | null {
  const m = AUTH_HASH.exec(hash);
  return m ? m[1]! : null;
}

/** Same, from a full URL (native deep links). */
export function parseAuthUrl(url: string): string | null {
  try {
    return parseAuthHash(new URL(url).hash);
  } catch {
    return null;
  }
}
