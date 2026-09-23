import { RecipientTypeMenu } from "./RecipientTypeMenu.js";
import { recipientLabels, type RecipientType } from "./recipients.js";

export function OwnershipInput({ type, value, open, networkMode, message, valid, onType, onToggle, onChange, onClear }: {
  type: RecipientType;
  value: string;
  open: boolean;
  networkMode: boolean;
  message: string;
  valid: boolean;
  onType: (type: RecipientType) => void;
  onToggle: (open: boolean) => void;
  onChange: (value: string) => void;
  onClear: () => void;
}) {
  return <div className="ownership-input">
    <RecipientTypeMenu type={type} open={open} onOpenChange={onToggle} onChoose={onType} networkMode={networkMode} value={value} onChange={onChange} onClear={onClear} />
    <small className={valid ? "field-note valid" : "field-note"}>{networkMode ? message : `${recipientLabels[type]} describes who controls the destination Ownership, not a target chain.`}</small>
  </div>;
}
