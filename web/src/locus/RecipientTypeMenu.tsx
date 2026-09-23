import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { Check, ChevronDown, X } from "lucide-react";
import { RecipientIcon } from "./RecipientIcon.js";
import { recipientHints, recipientLabels, type RecipientType } from "./recipients.js";

export function RecipientTypeMenu({ type, open, onOpenChange, onChoose, networkMode, value, onChange, onClear }: {
  type: RecipientType;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onChoose: (type: RecipientType) => void;
  networkMode: boolean;
  value: string;
  onChange: (value: string) => void;
  onClear: () => void;
}) {
  const types: RecipientType[] = ["matrix", "telegram", "email", "github", "evm", "polkadot", "solana", "locus"];
  const configured = (entry: RecipientType) => !networkMode || entry === "evm" || entry === "polkadot" || entry === "solana" || entry === "locus" || entry === "matrix";

  return <div className="field-group recipient-field">
    <label>To</label>
    <div className="recipient-control">
      <DropdownMenu.Root open={open} onOpenChange={onOpenChange}>
        <DropdownMenu.Trigger asChild>
          <button type="button" className="type-button" aria-label="Recipient type">
            <span className="identity-icon-slot"><RecipientIcon type={type} size={24} /></span>
            <ChevronDown size={16} className="muted" aria-hidden="true" />
          </button>
        </DropdownMenu.Trigger>
        <DropdownMenu.Portal>
          <DropdownMenu.Content className="type-menu identity-recipient-menu" sideOffset={6} align="start">
            {types.map((entry) => {
              const disabled = !configured(entry);
              const selected = entry === type;
              return <DropdownMenu.Item
                key={entry}
                disabled={disabled}
                data-selected={selected ? "true" : undefined}
                className="type-menu-item"
                onSelect={() => onChoose(entry)}
              >
                <span className="identity-icon-slot"><RecipientIcon type={entry} size={24} /></span>
                <span className="type-menu-copy">
                  <strong>{recipientLabels[entry]}</strong>
                  <small>{disabled ? "Not configured" : recipientHints[entry]}</small>
                </span>
                <span className="type-menu-check">{selected && <Check size={18} aria-hidden="true" />}</span>
              </DropdownMenu.Item>;
            })}
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu.Root>
      <input value={value} placeholder={recipientHints[type]} onChange={(event) => onChange(event.target.value)} />
      {value && <button type="button" className="clear" aria-label="Clear recipient" onClick={onClear}><X size={16} aria-hidden="true" /></button>}
    </div>
  </div>;
}
