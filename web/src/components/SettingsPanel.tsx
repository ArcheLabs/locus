import { useState } from "react";
import { Settings } from "lucide-react";
import { Modal } from "./Modal.js";
import { useTheme } from "../theme/ThemeProvider.js";
import { useNetwork } from "../network/NetworkProvider.js";
import { useI18n, type Language } from "../i18n/I18nProvider.js";

export function SettingsButton() {
  const [open, setOpen] = useState(false);
  const { t } = useI18n();
  return <>
    <button type="button" className="settings-trigger" aria-label={t("common.settings")} title={t("common.settings")} onClick={() => setOpen(true)}>
      <Settings size={18} aria-hidden="true" /><span>{t("common.settings")}</span>
    </button>
    <Modal open={open} title={t("settings.title")} onClose={() => setOpen(false)}>
      <SettingsFields />
    </Modal>
  </>;
}

export function SettingsFields({ mobile = false }: { mobile?: boolean }) {
  const { preference, setPreference } = useTheme();
  const { mode, config, networkId, switchNetwork } = useNetwork();
  const { language, setLanguage, t } = useI18n();
  const networkOptions = config ? Object.entries(config.networks) : [];
  const networkLabel = (id: string, original: string) => id === "local" ? t("common.local")
    : id === "testnet" ? t("common.testnet")
      : id === "dev" || id === "development" ? t("common.development")
        : id === "mainnet" ? t("common.mainnet") : original;

  return <div className={`settings-fields${mobile ? " settings-fields--mobile" : ""}`}>
    <label className="settings-field">
      <span>{t("common.theme")}</span>
      <select value={preference} onChange={(event) => setPreference(event.target.value as "system" | "light" | "dark")} aria-label={t("settings.chooseTheme")}>
        <option value="system">{t("common.system")}</option>
        <option value="light">{t("common.light")}</option>
        <option value="dark">{t("common.dark")}</option>
      </select>
    </label>
    {mode === "network" && <label className="settings-field">
      <span>{t("common.network")}</span>
      <select value={config ? networkId : ""} disabled={!config || networkOptions.length === 0} onChange={(event) => switchNetwork(event.target.value as typeof networkId)} aria-label={t("settings.chooseNetwork")}>
        {!config && <option value="">{t("common.loading")}</option>}
        {networkOptions.map(([id, entry]) => <option key={id} value={id}>{networkLabel(id, entry.label)}</option>)}
      </select>
    </label>}
    <label className="settings-field">
      <span>{t("common.language")}</span>
      <select value={language} onChange={(event) => setLanguage(event.target.value as Language)} aria-label={t("settings.chooseLanguage")}>
        <option value="zh-Hans">{t("common.chinese")}</option>
        <option value="en">English</option>
      </select>
    </label>
  </div>;
}
