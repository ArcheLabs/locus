import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { Check, Moon, Monitor, Sun } from "lucide-react";
import { useTheme } from "./ThemeProvider.js";
import type { ThemePreference } from "./theme.js";
import { useI18n } from "../i18n/I18nProvider.js";

const options: { value: ThemePreference; key: "common.system" | "common.light" | "common.dark"; Icon: typeof Sun }[] = [
  { value: "system", key: "common.system", Icon: Monitor },
  { value: "light", key: "common.light", Icon: Sun },
  { value: "dark", key: "common.dark", Icon: Moon },
];

export function ThemeControl() {
  const { preference, resolvedTheme, setPreference } = useTheme();
  const { t } = useI18n();
  const Icon = preference === "system" ? Monitor : resolvedTheme === "dark" ? Moon : Sun;

  return <DropdownMenu.Root>
    <DropdownMenu.Trigger asChild>
        <button type="button" className="theme-trigger" aria-label={`${t("common.theme")}: ${preference === "system" ? t("common.system") : preference === "light" ? t("common.light") : t("common.dark")}`} title={t("common.theme")}>
        <Icon size={18} aria-hidden="true" />
      </button>
    </DropdownMenu.Trigger>
    <DropdownMenu.Portal>
      <DropdownMenu.Content className="theme-menu dropdown-surface" sideOffset={8} align="end" aria-label={t("settings.chooseTheme")}>
        <DropdownMenu.Label className="theme-menu-label">{t("common.appearance")}</DropdownMenu.Label>
        <DropdownMenu.RadioGroup value={preference} onValueChange={(value) => setPreference(value as ThemePreference)}>
          {options.map(({ value, key, Icon: OptionIcon }) => <DropdownMenu.RadioItem className="theme-option" value={value} key={value}>
            <OptionIcon size={17} aria-hidden="true" />
            <span>{t(key)}</span>
            {preference === value && <Check size={16} aria-hidden="true" />}
          </DropdownMenu.RadioItem>)}
        </DropdownMenu.RadioGroup>
      </DropdownMenu.Content>
    </DropdownMenu.Portal>
  </DropdownMenu.Root>;
}
