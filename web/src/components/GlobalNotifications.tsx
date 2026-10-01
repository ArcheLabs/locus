import { useEffect } from "react";
import { LoaderCircle, X } from "lucide-react";
import { ActionButton } from "./ActionButton.js";
import { CopyableValue } from "./CopyableValue.js";
import { useI18n } from "../i18n/I18nProvider.js";

export type GlobalTransactionNotice = {
  id: string;
  title: string;
  message?: string;
  ephemeral?: boolean;
  transactionId?: string;
  tone?: "info" | "success" | "error";
  busy?: boolean;
  actionLabel?: string;
  onAction?: () => void;
  dismissible?: boolean;
  autoDismissMs?: number;
};

export function GlobalNotifications({ notices, onDismiss }: {
  notices: GlobalTransactionNotice[];
  onDismiss: (id: string) => void;
}) {
  const { text } = useI18n();
  if (notices.length === 0) return null;

  return <aside className="global-notifications" aria-label={text("Notifications")} aria-live="polite">
    {notices.map((notice) => <GlobalNotificationRow key={notice.id} notice={notice} onDismiss={onDismiss} />)}
  </aside>;
}

function GlobalNotificationRow({ notice, onDismiss }: { notice: GlobalTransactionNotice; onDismiss: (id: string) => void }) {
  const { text } = useI18n();
  useEffect(() => {
    if (!notice.autoDismissMs) return;
    const timer = window.setTimeout(() => onDismiss(notice.id), notice.autoDismissMs);
    return () => window.clearTimeout(timer);
  }, [notice.autoDismissMs, notice.id, onDismiss]);
  if (notice.ephemeral) return <div className="global-toast" role="status">{text(notice.message ?? notice.title)}</div>;
  return <section className={`global-notification global-notification--${notice.tone ?? "info"}`} role={notice.tone === "error" ? "alert" : "status"}>
      <div className="global-notification__content">
        <strong>{text(notice.title)}</strong>
        {notice.message && <p>{text(notice.message)}</p>}
        {notice.transactionId && <CopyableValue label="Transaction" value={notice.transactionId} layout="inline" className="global-notification__transaction" />}
      </div>
      <div className="global-notification__actions">
        {notice.actionLabel && notice.onAction && <ActionButton size="small" variant="secondary" loading={notice.busy} disabled={notice.busy} onClick={notice.onAction}>
          {text(notice.actionLabel)}
        </ActionButton>}
        {notice.dismissible && <button className="global-notification__dismiss" type="button" aria-label={text("Dismiss notification")} onClick={() => onDismiss(notice.id)}><X size={17} aria-hidden="true" /></button>}
        {notice.busy && !notice.actionLabel && <LoaderCircle className="global-notification__spinner" size={18} aria-label={text("Checking transaction")} />}
      </div>
    </section>;
}
