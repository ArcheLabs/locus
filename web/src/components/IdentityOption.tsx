import { ArrowRight, Check } from "lucide-react";
import { IdentityIcon, type IdentityKind } from "./IdentityIcon.js";

export type IdentityOptionVariant = "comfortable" | "compact";

export function IdentityOption({
  kind,
  title,
  description,
  variant,
  disabled = false,
  trailing,
}: {
  kind: IdentityKind;
  title: string;
  description: string;
  variant: IdentityOptionVariant;
  disabled?: boolean;
  trailing: "arrow" | "check" | null;
}) {
  return <>
    <span className="identity-icon-slot"><IdentityIcon kind={kind} size={24} /></span>
    <span className={`identity-option-copy identity-option-copy--${variant}`} data-disabled={disabled ? "true" : undefined}>
      <strong>{title}</strong>
      <small>{description}</small>
    </span>
    <span className={`identity-option-trailing identity-option-trailing--${trailing ?? "empty"}`} aria-hidden="true">
      {trailing === "arrow" && <ArrowRight size={18} />}
      {trailing === "check" && <Check size={18} />}
    </span>
  </>;
}
