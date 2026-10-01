import { useI18n } from "../i18n/I18nProvider.js";

export function FieldMessage({ id, error, children }: { id?: string; error?: string | null; children?: string | null }) {
  const { text } = useI18n();
  const message = error || children;
  if (!message) return null;
  return <p id={id} className={error ? "field-message field-message--error" : "field-message"} role={error ? "alert" : "status"}>{text(message)}</p>;
}
