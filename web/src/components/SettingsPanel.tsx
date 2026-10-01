import { useState } from "react";
import { Settings } from "lucide-react";
import { Modal } from "./Modal.js";
import { useTheme } from "../theme/ThemeProvider.js";
import { useNetwork } from "../network/NetworkProvider.js";
import { useI18n, type Language } from "../i18n/I18nProvider.js";
import { SelectField } from "./SelectField.js";

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
    <div className="settings-field">
      <span>{t("common.theme")}</span>
      <SelectField value={preference} onValueChange={(value) => setPreference(value as "system" | "light" | "dark")} aria-label={t("settings.chooseTheme")} options={[
        { value: "system", label: t("common.system") },
        { value: "light", label: t("common.light") },
        { value: "dark", label: t("common.dark") },
      ]} />
    </div>
    {mode === "network" && <div className="settings-field">
      <span>{t("common.network")}</span>
      <SelectField value={config ? networkId : undefined} disabled={!config || networkOptions.length === 0} onValueChange={(value) => switchNetwork(value as typeof networkId)} aria-label={t("settings.chooseNetwork")} placeholder={!config ? t("common.loading") : undefined} options={networkOptions.map(([id, entry]) => ({ value: id, label: networkLabel(id, entry.label) }))} />
    </div>}
    <div className="settings-field">
      <span>{t("common.language")}</span>
      <SelectField value={language} onValueChange={(value) => setLanguage(value as Language)} aria-label={t("settings.chooseLanguage")} options={[
        { value: "zh-Hans", label: "简体中文" },
        { value: "en", label: "English" },
        { value: "ja", label: "日本語" },
        { value: "de", label: "Deutsch" },
      ]} />
    </div>
  </div>;
}
