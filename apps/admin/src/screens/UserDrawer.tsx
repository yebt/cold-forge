import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { errorMessage, useAdmin } from "../admin.tsx";
import type { UserDetailResponse, UserRowDto } from "../backend/types.ts";
import { copy } from "../copy.ts";
import { formatDateTime, formatNumber, formatRelative, providerLabel } from "../format.ts";
import { Avatar, CopyButton, ErrorPanel, Skeleton, StatusBadges } from "../ui/bits.tsx";
import { UserActionDialog, type UserAction } from "./UserActions.tsx";

interface Props {
  uid: string;
  selfUid: string;
  onClose: () => void;
  onChanged: (uid: string, user: UserRowDto | null) => void;
}

export function UserDrawer({ uid, selfUid, onClose, onChanged }: Props) {
  const { run } = useAdmin();
  const [detail, setDetail] = useState<UserDetailResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [action, setAction] = useState<UserAction | null>(null);
  const ref = useRef<HTMLDialogElement>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      setDetail(await run("adminGetUser", { uid }));
    } catch (e) {
      setError(errorMessage(e));
    }
  }, [run, uid]);

  useEffect(() => {
    setDetail(null);
    void load();
  }, [load]);

  useEffect(() => {
    const dialog = ref.current;
    if (dialog && !dialog.open) dialog.showModal();
    return () => dialog?.close();
  }, []);

  const d = copy.detail;
  const user = detail?.user;
  const isSelf = uid === selfUid;

  return (
    <dialog
      ref={ref}
      className="drawer"
      aria-label={user?.email ?? uid}
      onCancel={(e) => {
        e.preventDefault();
        if (!action) onClose();
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget && !action) onClose();
      }}
    >
      <div className="drawer-panel">
        <header className="drawer-head">
          {user ? (
            <div className="drawer-identity">
              <Avatar name={user.displayName} email={user.email} photo={user.photoURL} size={44} />
              <div className="drawer-title">
                <h2>{user.displayName ?? user.email ?? uid}</h2>
                <div className="muted small ellipsis">{user.email ?? copy.users.noEmail}</div>
                <StatusBadges disabled={user.disabled} isAdmin={user.isAdmin} emailVerified={user.emailVerified} />
              </div>
            </div>
          ) : (
            <div className="drawer-identity">
              <Skeleton width={44} height={44} />
              <div className="drawer-title">
                <Skeleton width={160} height={18} />
                <Skeleton width={200} />
              </div>
            </div>
          )}
          <button type="button" className="btn btn-ghost btn-icon" onClick={onClose} aria-label={d.close}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden>
              <path d="M6 6l12 12M18 6 6 18" />
            </svg>
          </button>
        </header>

        <div className="drawer-body">
          {error && <ErrorPanel message={error} onRetry={load} />}

          {user && (
            <div className="data-tiles">
              <Tile label={copy.dashboard.arcs} value={user.counts?.arcs} />
              <Tile label={copy.dashboard.habits} value={user.counts?.habits} />
              <Tile label={copy.dashboard.checkIns} value={user.counts?.checkIns} ember />
            </div>
          )}

          <Section title={d.account}>
            <Row label={d.uid}>
              <span className="mono ellipsis">{uid}</span>
              <CopyButton value={uid} />
            </Row>
            <Row label={d.email}>
              {user ? (
                <span className="ellipsis">
                  {user.email ?? "—"} <span className={user.emailVerified ? "tone-ok" : "tone-danger"}>· {user.emailVerified ? d.verified : d.notVerified}</span>
                </span>
              ) : (
                <Skeleton width={180} />
              )}
            </Row>
            <Row label={d.providers}>{user ? user.providers.map(providerLabel).join(", ") || "—" : <Skeleton width={60} />}</Row>
            <Row label={d.created}>{user ? formatDateTime(user.createdAt) : <Skeleton width={140} />}</Row>
            <Row label={d.lastSignIn}>{user ? `${formatDateTime(user.lastSignIn)} · ${formatRelative(user.lastSignIn)}` : <Skeleton width={140} />}</Row>
            <Row label={d.lastRefresh}>{detail ? formatRelative(detail.lastRefresh) : <Skeleton width={80} />}</Row>
          </Section>

          <Section title={d.profile}>
            {detail && !detail.profile ? (
              <p className="muted small">{d.noProfile}</p>
            ) : (
              <>
                <Row label={d.displayName}>{detail ? (detail.profile?.displayName ?? "—") : <Skeleton width={100} />}</Row>
                <Row label={d.locale}>{detail ? <span className="mono">{detail.profile?.locale ?? "—"}</span> : <Skeleton width={30} />}</Row>
                <Row label={d.currentArc}>{detail ? <span className="mono ellipsis">{detail.profile?.currentArcId ?? "—"}</span> : <Skeleton width={120} />}</Row>
                <Row label={d.updated}>{detail ? formatRelative(detail.profile?.updatedAt) : <Skeleton width={80} />}</Row>
              </>
            )}
          </Section>

          {user && (
            <Section title={d.actions}>
              {isSelf ? (
                <p className="muted small">{d.selfNote}</p>
              ) : (
                <>
                  {user.isAdmin && <p className="muted small">{d.adminNote}</p>}
                  <div className="actions">
                    {user.disabled ? (
                      <button type="button" className="btn btn-ghost" onClick={() => setAction("enable")}>
                        {d.enable}
                      </button>
                    ) : (
                      <button type="button" className="btn btn-ghost" onClick={() => setAction("disable")} disabled={user.isAdmin}>
                        {d.disable}
                      </button>
                    )}
                    <button type="button" className="btn btn-danger-ghost" onClick={() => setAction("delete")} disabled={user.isAdmin}>
                      {d.delete}
                    </button>
                  </div>
                </>
              )}
            </Section>
          )}
        </div>
      </div>

      {action && user && (
        <UserActionDialog
          action={action}
          user={user}
          onClose={() => setAction(null)}
          onDone={(updated) => {
            onChanged(uid, updated);
            if (updated) void load();
          }}
        />
      )}
    </dialog>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="drawer-section">
      <h3 className="section-label">{title}</h3>
      <div className="kv">{children}</div>
    </section>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="kv-row">
      <span className="kv-label">{label}</span>
      <span className="kv-value">{children}</span>
    </div>
  );
}

function Tile({ label, value, ember }: { label: string; value: number | undefined; ember?: boolean }) {
  return (
    <div className="tile">
      <div className={`tile-value ${ember ? "tone-ember" : ""}`}>{value === undefined ? "—" : formatNumber(value)}</div>
      <div className="tile-label">{label}</div>
    </div>
  );
}
