export function FieldMessage({ id, error, children }: { id?: string; error?: string | null; children?: string | null }) {
  const message = error || children;
  if (!message) return null;
  return <p id={id} className={error ? "field-message field-message--error" : "field-message"} role={error ? "alert" : "status"}>{message}</p>;
}
