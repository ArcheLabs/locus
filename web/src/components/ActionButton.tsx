import type { ButtonHTMLAttributes, ReactNode } from "react";
import { LoaderCircle, type LucideIcon } from "lucide-react";

type ActionButtonProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children"> & {
  icon?: LucideIcon;
  iconPosition?: "start" | "end";
  variant?: "primary" | "secondary" | "tertiary" | "danger";
  size?: "small" | "medium" | "large";
  loading?: boolean;
  fullWidth?: boolean;
  children: ReactNode;
};

export function ActionButton({ icon: Icon, iconPosition = "start", variant = "secondary", size = "medium", loading = false, fullWidth = false, disabled, children, className = "", type = "button", ...props }: ActionButtonProps) {
  const classes = ["action-button", `action-button--${variant}`, `action-button--${size}`, fullWidth && "action-button--full", className].filter(Boolean).join(" ");
  const LeadingIcon = loading ? LoaderCircle : iconPosition === "start" ? Icon : undefined;
  const TrailingIcon = !loading && iconPosition === "end" ? Icon : undefined;
  return <button {...props} type={type} className={classes} disabled={disabled || loading} aria-busy={loading || props["aria-busy"]}>
    {LeadingIcon && <LeadingIcon className={`action-button__icon${loading ? " action-button__icon--loading" : ""}`} size={18} strokeWidth={2} aria-hidden="true" />}
    <span>{children}</span>
    {TrailingIcon && <TrailingIcon className="action-button__icon" size={18} strokeWidth={2} aria-hidden="true" />}
  </button>;
}
