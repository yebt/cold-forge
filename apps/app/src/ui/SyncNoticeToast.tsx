import type { Locale } from "@cold-forge/i18n";
import { useEffect } from "react";
import { UI_MESSAGES } from "../i18n/index.ts";
import { syncEngine } from "../sync/runtime.ts";
import { useSync } from "../sync/useSync.ts";

/** Short-lived message for sign-in links and session changes. */
export function SyncNoticeToast({ locale }: { locale: Locale }) {
  const { notice } = useSync();
  useEffect(() => {
    if (!notice) return;
    const id = setTimeout(() => syncEngine.dismissNotice(), 4000);
    return () => clearTimeout(id);
  }, [notice]);
  if (!notice) return null;
  const a = UI_MESSAGES[locale].account;
  const text = {
    signedIn: a.noticeSignedIn,
    linkInvalid: a.noticeLinkInvalid,
    linkFailed: a.noticeLinkFailed,
    sessionExpired: a.noticeSessionExpired,
    accountDeleted: a.noticeAccountDeleted,
  }[notice];
  return (
    <div className="toast" role="status" onClick={() => syncEngine.dismissNotice()}>
      {text}
    </div>
  );
}
