import type { ReactNode } from "react";
import { FieldMessage } from "./FieldMessage.js";

export function FormField({ label, htmlFor, error, errorId, children, className = "", reserveMessage = false }: {
  label: ReactNode;
  htmlFor?: string;
  error?: string | null;
  errorId?: string;
  children: ReactNode;
  className?: string;
  reserveMessage?: boolean;
}) {
  return <div className={`form-field ${className}`.trim()}>
    <label htmlFor={htmlFor}>{label}</label>
    {children}
    {reserveMessage ? <div className="form-field__message-slot"><FieldMessage id={errorId} error={error} /></div> : <FieldMessage id={errorId} error={error} />}
  </div>;
}
