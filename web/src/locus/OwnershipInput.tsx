import { RecipientTypeMenu } from "./RecipientTypeMenu.js";
import { recipientLabels, type RecipientType } from "./recipients.js";
import { FieldMessage } from "../forms/FieldMessage.js";

export function OwnershipInput({ type, value, open, networkMode, message, valid, error, onBlur, onType, onToggle, onChange, onClear }: {
  type: RecipientType;
  value: string;
  open: boolean;
  networkMode: boolean;
  message: string;
  valid: boolean;
  error?: string | null;
  onBlur?: () => void;
  onType: (type: RecipientType) => void;
  onToggle: (open: boolean) => void;
  onChange: (value: string) => void;
  onClear: () => void;
}) {
  return <div className="ownership-input">
    <RecipientTypeMenu type={type} open={open} onOpenChange={onToggle} onChoose={onType} networkMode={networkMode} value={value} onChange={onChange} onClear={onClear} error={error} onBlur={onBlur} />
    {error ? <FieldMessage id="send-recipient-error" error={error} /> : message && <small className={valid ? "field-note valid" : "field-note"}>{networkMode ? message : `${recipientLabels[type]} describes who controls the destination Ownership, not a target chain.`}</small>}
  </div>;
}
