import { useState } from "react";
import { copy } from "../copy.ts";
import { initials, safePhoto } from "../format.ts";

export function Logo({ size = 34 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden className="logo">
      <rect width="64" height="64" rx="14" fill="#0b1220" stroke="#2a3b55" />
      <path d="M32 12v40M14.7 22l34.6 20M14.7 42l34.6-20" stroke="#7dd3fc" strokeWidth="4.5" strokeLinecap="round" />
      <circle cx="32" cy="32" r="7" fill="#f97316" />
    </svg>
  );
}

export function Avatar({ name, email, photo, size = 32 }: { name: string | null; email: string | null; photo: string | null; size?: number }) {
  const [broken, setBroken] = useState(false);
  const src = safePhoto(photo);
  const style = { width: size, height: size, fontSize: Math.round(size * 0.38) };
  if (src && !broken) {
    return <img className="avatar" src={src} alt="" style={style} referrerPolicy="no-referrer" onError={() => setBroken(true)} />;
  }
  // Stable hue per account so rows are easy to tell apart.
  const seed = [...(email ?? name ?? "?")].reduce((n, c) => (n * 31 + c.charCodeAt(0)) >>> 0, 7);
  const hue = 190 + (seed % 50);
  return (
    <span className="avatar avatar-initials" style={{ ...style, background: `hsl(${hue} 45% 22%)`, color: `hsl(${hue} 90% 80%)` }} aria-hidden>
      {initials(name, email)}
    </span>
  );
}

export function StatusBadges({ disabled, admin, emailVerified }: { disabled: boolean; admin: boolean; emailVerified: boolean }) {
  return (
    <span className="badges">
      {disabled ? <span className="badge badge-danger">{copy.users.disabled}</span> : <span className="badge badge-ok">{copy.users.active}</span>}
      {admin && <span className="badge badge-ember">{copy.users.admin}</span>}
      {!emailVerified && <span className="badge">{copy.users.unverified}</span>}
    </span>
  );
}

export function Skeleton({ width = "100%", height = 14 }: { width?: number | string; height?: number }) {
  return <span className="skeleton" style={{ width, height }} aria-hidden />;
}

export function ErrorPanel({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="error-panel" role="alert">
      <span>{message}</span>
      <button type="button" className="btn btn-ghost btn-sm" onClick={onRetry}>
        {copy.errors.retry}
      </button>
    </div>
  );
}

export function CopyButton({ value }: { value: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      className="btn btn-ghost btn-xs"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
          setDone(true);
          setTimeout(() => setDone(false), 1500);
        } catch {
          /* clipboard unavailable */
        }
      }}
    >
      {done ? copy.detail.copied : copy.detail.copy}
    </button>
  );
}
