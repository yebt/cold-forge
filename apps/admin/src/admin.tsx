import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from "react";
import { CallError, type AdminCallableName, type AdminCallables, type Backend } from "./backend/types.ts";
import { copy } from "./copy.ts";
import { ConfirmDialog } from "./ui/Dialog.tsx";

/**
 * App-wide access to the callables. `run` adds the policies every screen needs:
 * - `recent-login-required` → ask the admin to re-authenticate with Google, then retry once;
 * - `unauthenticated` / `permission-denied` → sign out (claim removed, session revoked…).
 */
interface AdminContextValue {
  backend: Backend;
  run<K extends AdminCallableName>(name: K, data: AdminCallables[K][0]): Promise<AdminCallables[K][1]>;
  toast(message: string, tone?: "ok" | "error"): void;
}

const AdminContext = createContext<AdminContextValue | null>(null);

export function useAdmin(): AdminContextValue {
  const value = useContext(AdminContext);
  if (!value) throw new Error("useAdmin outside AdminProvider");
  return value;
}

export function errorMessage(error: unknown): string {
  if (error instanceof CallError) {
    if (error.reason === "rate-limited") return copy.errors.rateLimited;
    // Server messages for deliberate refusals are written for admins; everything else is generic.
    if (error.code === "failed-precondition" || error.code === "invalid-argument") return error.message;
    return copy.errors.byCode[error.code] ?? copy.errors.generic;
  }
  return copy.errors.generic;
}

interface Toast {
  id: number;
  message: string;
  tone: "ok" | "error";
}

export function AdminProvider({ backend, children }: { backend: Backend; children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [reauth, setReauth] = useState<{ resolve: (ok: boolean) => void } | null>(null);
  const [reauthBusy, setReauthBusy] = useState(false);
  const nextId = useRef(1);

  const toast = useCallback((message: string, tone: "ok" | "error" = "ok") => {
    const id = nextId.current++;
    setToasts((t) => [...t, { id, message, tone }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 4500);
  }, []);

  const askReauth = useCallback(() => new Promise<boolean>((resolve) => setReauth({ resolve })), []);

  const run = useCallback(
    async function run<K extends AdminCallableName>(name: K, data: AdminCallables[K][0]): Promise<AdminCallables[K][1]> {
      try {
        return await backend.call(name, data);
      } catch (error) {
        if (error instanceof CallError) {
          if (error.reason === "recent-login-required" && (await askReauth())) {
            return backend.call(name, data);
          }
          if (error.code === "unauthenticated") void backend.signOut("expired");
          else if (error.code === "permission-denied") void backend.signOut("denied");
        }
        throw error;
      }
    },
    [backend, askReauth],
  );

  const value = useMemo(() => ({ backend, run, toast }), [backend, run, toast]);

  return (
    <AdminContext.Provider value={value}>
      {children}
      <div className="toasts" role="status" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`toast toast-${t.tone}`}>
            {t.message}
          </div>
        ))}
      </div>
      {reauth && (
        <ConfirmDialog
          title={copy.dialogs.reauthTitle}
          confirmLabel={copy.dialogs.reauthConfirm}
          busy={reauthBusy}
          onCancel={() => {
            reauth.resolve(false);
            setReauth(null);
          }}
          onConfirm={async () => {
            setReauthBusy(true);
            try {
              await backend.reauthenticate();
              reauth.resolve(true);
            } catch {
              reauth.resolve(false);
            } finally {
              setReauthBusy(false);
              setReauth(null);
            }
          }}
        >
          <p>{copy.dialogs.reauthBody}</p>
        </ConfirmDialog>
      )}
    </AdminContext.Provider>
  );
}
