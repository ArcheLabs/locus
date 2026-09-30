import { LoaderCircle, X } from "lucide-react";
import { ActionButton } from "./ActionButton.js";
import { CopyableValue } from "./CopyableValue.js";

export type GlobalTransactionNotice = {
  id: string;
  title: string;
  message?: string;
  transactionId?: string;
  tone?: "info" | "error";
  busy?: boolean;
  actionLabel?: string;
  onAction?: () => void;
  dismissible?: boolean;
};

export function GlobalNotifications({ toast, notices, onDismiss }: {
  toast: string;
  notices: GlobalTransactionNotice[];
  onDismiss: (id: string) => void;
}) {
  if (!toast && notices.length === 0) return null;

  return <aside className="global-notifications" aria-label="Notifications" aria-live="polite">
    {notices.map((notice) => <section key={notice.id} className={`global-notification global-notification--${notice.tone ?? "info"}`} role={notice.tone === "error" ? "alert" : "status"}>
      <div className="global-notification__content">
        <strong>{notice.title}</strong>
        {notice.message && <p>{notice.message}</p>}
        {notice.transactionId && <CopyableValue label="Transaction" value={notice.transactionId} layout="inline" className="global-notification__transaction" />}
      </div>
      <div className="global-notification__actions">
        {notice.actionLabel && notice.onAction && <ActionButton size="small" variant="secondary" loading={notice.busy} disabled={notice.busy} onClick={notice.onAction}>
          {notice.actionLabel}
        </ActionButton>}
        {notice.dismissible && <button className="global-notification__dismiss" type="button" aria-label="Dismiss notification" onClick={() => onDismiss(notice.id)}><X size={17} aria-hidden="true" /></button>}
        {notice.busy && !notice.actionLabel && <LoaderCircle className="global-notification__spinner" size={18} aria-label="Checking transaction" />}
      </div>
    </section>)}
    {toast && <div className="global-toast" role="status">{toast}</div>}
  </aside>;
}
