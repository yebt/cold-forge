/**
 * Login-CSRF guard for emailed sign-in links. Anyone can request a link for *their own* email and
 * send it to someone else; opening it must never silently link this device (and upload its data)
 * to that account. A link is only trusted without asking when this very app instance just asked
 * for a code for the same email.
 */
export const PENDING_REQUEST_TTL_MS = 15 * 60_000;

export interface PendingCodeRequest {
  email: string;
  at: number;
}

export function linkNeedsConfirmation(linkEmail: string, pending: PendingCodeRequest | null, now: number): boolean {
  if (!pending) return true;
  if (now - pending.at > PENDING_REQUEST_TTL_MS || now < pending.at) return true;
  return pending.email.trim().toLowerCase() !== linkEmail.trim().toLowerCase();
}
