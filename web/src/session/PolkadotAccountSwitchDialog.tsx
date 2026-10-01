import { useEffect, useState } from "react";
import { Check, LoaderCircle, Wallet } from "lucide-react";
import { ActionButton } from "../components/ActionButton.js";
import { Modal } from "../components/Modal.js";
import { listBrowserAccounts, type BrowserAccountOption } from "./connectors.js";
import { useI18n } from "../i18n/I18nProvider.js";

type Props = {
  open: boolean;
  currentAccount: string;
  onClose: () => void;
  onSelect: (address: string) => Promise<void>;
};

export function PolkadotAccountSwitchDialog({ open, currentAccount, onClose, onSelect }: Props) {
  const { t, text } = useI18n();
  const [accounts, setAccounts] = useState<BrowserAccountOption[]>([]);
  const [loading, setLoading] = useState(false);
  const [switching, setSwitching] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open) {
      setAccounts([]);
      setLoading(false);
      setSwitching(false);
      setError("");
      return;
    }
    let active = true;
    setLoading(true);
    setError("");
    void listBrowserAccounts("polkadot").then((next) => {
      if (active) setAccounts(next);
    }).catch((cause: unknown) => {
      if (active) setError(t("ui.polkadotAccountsLoadFailed"));
    }).finally(() => {
      if (active) setLoading(false);
    });
    return () => { active = false; };
  }, [open]);

  async function selectAccount(address: string) {
    if (switching) return;
    if (address === currentAccount) {
      onClose();
      return;
    }
    setSwitching(true);
    setError("");
    try {
      await onSelect(address);
      onClose();
    } catch (cause) {
      setError(t("ui.polkadotAccountSwitchFailed"));
    } finally {
      setSwitching(false);
    }
  }

  return <Modal open={open} title={t("ui.switchAccount")} onClose={() => { if (!switching) onClose(); }} preventOutsideDismiss={switching}>
    <p className="modal-lead">{t("ui.choosePolkadotAccount")}</p>
    {loading && <div className="account-switch-status" role="status" aria-busy="true"><LoaderCircle size={18} className="action-button__icon--loading" aria-hidden="true" /> {t("ui.loadingAccounts")}</div>}
    {!loading && accounts.length === 0 && !error && <p className="account-switch-empty">{t("ui.noPolkadotAccounts")}</p>}
    {accounts.length > 0 && <div className="account-switch-list" aria-label={t("ui.polkadotAccounts")}>
      {accounts.map((account) => {
        const selected = account.id === currentAccount;
        return <button key={account.id} type="button" className="account-switch-option" disabled={switching || loading} aria-current={selected ? "true" : undefined} onClick={() => void selectAccount(account.id)}>
          <span className="account-switch-option__icon"><Wallet size={18} aria-hidden="true" /></span>
          <span className="account-switch-option__text"><strong>{account.label}</strong><small>{account.description}</small><code>{account.id}</code></span>
          {selected && <span className="account-switch-option__selected"><Check size={16} aria-hidden="true" /> {t("ui.current")}</span>}
          {switching && !selected && <LoaderCircle size={17} className="action-button__icon--loading" aria-label={t("ui.switchingAccount")} />}
        </button>;
      })}
    </div>}
    {error && <div className="transaction-error" role="alert">{text(error)}</div>}
    <div className="account-switch-footer"><ActionButton variant="tertiary" disabled={switching} onClick={onClose}>{t("common.cancel")}</ActionButton></div>
  </Modal>;
}
