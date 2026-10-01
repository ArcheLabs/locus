import { RecipientTypeMenu } from "./RecipientTypeMenu.js";
import { recipientLabels, type RecipientType } from "./recipients.js";
import { FieldMessage } from "../forms/FieldMessage.js";
import { useI18n } from "../i18n/I18nProvider.js";

export function OwnershipInput({ type, value, open, networkMode, message, valid, error, onBlur, onType, onToggle, onChange, onClear, disabled = false }: {
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
  disabled?: boolean;
}) {
  const { t, text } = useI18n();
  return <div className="ownership-input">
    <RecipientTypeMenu type={type} open={open} onOpenChange={onToggle} onChoose={onType} networkMode={networkMode} value={value} onChange={onChange} onClear={onClear} error={error} onBlur={onBlur} disabled={disabled} />
    {error ? <FieldMessage id="send-recipient-error" error={error} /> : message && <small className={valid ? "field-note valid" : "field-note"}>{networkMode ? text(message) : t("send.ownershipRecipientHint", { type: text(recipientLabels[type]) })}</small>}
  </div>;
}
