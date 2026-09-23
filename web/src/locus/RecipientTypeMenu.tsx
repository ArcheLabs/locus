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
  return <div className="field-group recipient-field"><label>To</label><div className="recipient-control">
    <DropdownMenu.Root open={open} onOpenChange={onOpenChange}>
      <DropdownMenu.Trigger asChild><button type="button" className="type-button" aria-label="Recipient type"><span className={`type-icon ${type}`}><RecipientIcon type={type} /></span><ChevronDown size={16} className="muted" aria-hidden="true" /></button></DropdownMenu.Trigger>
      <DropdownMenu.Portal><DropdownMenu.Content className="type-menu" sideOffset={6} align="start">{types.map((entry) => { const disabled = !configured(entry); return <DropdownMenu.Item key={entry} disabled={disabled} className={`type-menu-item${disabled ? " disabled" : ""}`} onSelect={() => onChoose(entry)}><span className={`type-icon ${entry}`}><RecipientIcon type={entry} /></span><span><strong>{recipientLabels[entry]}</strong><small>{disabled ? "Not configured" : recipientHints[entry]}</small></span>{entry === type && <Check size={15} aria-hidden="true" />}</DropdownMenu.Item>; })}</DropdownMenu.Content></DropdownMenu.Portal>
    </DropdownMenu.Root>
    <input value={value} placeholder={recipientHints[type]} onChange={(event) => onChange(event.target.value)} />{value && <button type="button" className="clear" aria-label="Clear recipient" onClick={onClear}><X size={16} aria-hidden="true" /></button>}
  </div></div>;
}
