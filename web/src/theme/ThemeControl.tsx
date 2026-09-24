import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { Check, Moon, Monitor, Sun } from "lucide-react";
import { useTheme } from "./ThemeProvider.js";
import type { ThemePreference } from "./theme.js";

const options: { value: ThemePreference; label: string; Icon: typeof Sun }[] = [
  { value: "system", label: "System", Icon: Monitor },
  { value: "light", label: "Light", Icon: Sun },
  { value: "dark", label: "Dark", Icon: Moon },
];

export function ThemeControl() {
  const { preference, resolvedTheme, setPreference } = useTheme();
  const Icon = preference === "system" ? Monitor : resolvedTheme === "dark" ? Moon : Sun;

  return <DropdownMenu.Root>
    <DropdownMenu.Trigger asChild>
      <button type="button" className="theme-trigger" aria-label={`Theme: ${preference}`} title={`Theme: ${preference}`}>
        <Icon size={18} aria-hidden="true" />
      </button>
    </DropdownMenu.Trigger>
    <DropdownMenu.Portal>
      <DropdownMenu.Content className="theme-menu" sideOffset={8} align="end" aria-label="Choose theme">
        <DropdownMenu.Label className="theme-menu-label">Appearance</DropdownMenu.Label>
        <DropdownMenu.RadioGroup value={preference} onValueChange={(value) => setPreference(value as ThemePreference)}>
          {options.map(({ value, label, Icon: OptionIcon }) => <DropdownMenu.RadioItem className="theme-option" value={value} key={value}>
            <OptionIcon size={17} aria-hidden="true" />
            <span>{label}</span>
            {preference === value && <Check size={16} aria-hidden="true" />}
          </DropdownMenu.RadioItem>)}
        </DropdownMenu.RadioGroup>
      </DropdownMenu.Content>
    </DropdownMenu.Portal>
  </DropdownMenu.Root>;
}
