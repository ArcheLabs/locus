import type { ReactNode } from "react";
import { FieldMessage } from "./FieldMessage.js";

export function FormField({ label, htmlFor, error, errorId, children, className = "" }: {
  label: string;
  htmlFor?: string;
  error?: string | null;
  errorId?: string;
  children: ReactNode;
  className?: string;
}) {
  return <div className={`form-field ${className}`.trim()}>
    <label htmlFor={htmlFor}>{label}</label>
    {children}
    <FieldMessage id={errorId} error={error} />
  </div>;
}
