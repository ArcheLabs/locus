import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { ChevronDown, X } from "lucide-react";
import { RecipientIcon } from "./RecipientIcon.js";
import { IdentityOption } from "../components/IdentityOption.js";
import { recipientHints, recipientLabels, type RecipientType } from "./recipients.js";
import { useI18n } from "../i18n/I18nProvider.js";

export function RecipientTypeMenu({ type, open, onOpenChange, onChoose, networkMode, value, onChange, onClear, error, onBlur, disabled = false }: {
  type: RecipientType;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onChoose: (type: RecipientType) => void;
  networkMode: boolean;
  value: string;
  onChange: (value: string) => void;
  onClear: () => void;
  error?: string | null;
  onBlur?: () => void;
  disabled?: boolean;
}) {
  const { t, text } = useI18n();
  const types: RecipientType[] = ["matrix", "telegram", "email", "github", "evm", "polkadot", "solana", "locus"];
  const configured = (entry: RecipientType) => !networkMode || entry === "evm" || entry === "polkadot" || entry === "solana" || entry === "locus" || entry === "matrix";

  return <div className="field-group recipient-field">
    <label>{t("ui.to")}</label>
    <div className="recipient-control">
      <DropdownMenu.Root open={open && !disabled} onOpenChange={(next) => { if (!disabled) onOpenChange(next); }}>
        <DropdownMenu.Trigger asChild>
          <button type="button" className="type-button" aria-label={t("send.recipientType")} disabled={disabled}>
            <span className="identity-icon-slot"><RecipientIcon type={type} size={28} /></span>
            <ChevronDown size={16} className="muted" aria-hidden="true" />
          </button>
        </DropdownMenu.Trigger>
        <DropdownMenu.Portal>
          <DropdownMenu.Content className="type-menu identity-recipient-menu dropdown-surface" sideOffset={6} align="start">
            {types.map((entry) => {
              const disabled = !configured(entry);
              const selected = entry === type;
              return <DropdownMenu.Item
                key={entry}
                disabled={disabled}
                data-selected={selected ? "true" : undefined}
                className="identity-option-row identity-option-row--compact"
                onSelect={() => onChoose(entry)}
              >
                <IdentityOption
                  kind={entry}
                  title={text(recipientLabels[entry])}
                  description={disabled ? t("common.notConfigured") : recipientHints[entry]}
                  variant="compact"
                  disabled={disabled}
                  trailing={selected ? "check" : null}
                />
              </DropdownMenu.Item>;
            })}
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu.Root>
      <input value={value} placeholder={recipientHints[type]} aria-label={t("send.recipientAddress", { type: text(recipientLabels[type]) })} disabled={disabled} onChange={(event) => onChange(event.target.value)} onBlur={onBlur} aria-invalid={Boolean(error)} aria-describedby={error ? "send-recipient-error" : undefined} />
      {value && <button type="button" className="clear" aria-label={t("send.clearRecipient")} disabled={disabled} onClick={onClear}><X size={16} aria-hidden="true" /></button>}
    </div>
  </div>;
}
