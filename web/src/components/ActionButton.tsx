import { useLayoutEffect, useRef, useState, type ButtonHTMLAttributes, type ReactNode } from "react";
import { LoaderCircle, type LucideIcon } from "lucide-react";
import { useI18n } from "../i18n/I18nProvider.js";

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
  const { text } = useI18n();
  const buttonRef = useRef<HTMLButtonElement>(null);
  const [idleWidth, setIdleWidth] = useState<number | null>(null);
  useLayoutEffect(() => {
    if (loading || !buttonRef.current) return;
    const width = Math.ceil(buttonRef.current.getBoundingClientRect().width);
    setIdleWidth((current) => current === width ? current : width);
  }, [children, loading]);
  const classes = ["action-button", `action-button--${variant}`, `action-button--${size}`, fullWidth && "action-button--full", className].filter(Boolean).join(" ");
  const LeadingIcon = loading ? LoaderCircle : iconPosition === "start" ? Icon : undefined;
  const TrailingIcon = !loading && iconPosition === "end" ? Icon : undefined;
  return <button {...props} ref={buttonRef} type={type} className={classes} style={loading && !fullWidth && idleWidth !== null ? { ...props.style, minWidth: Math.max(idleWidth, 96) } : props.style} disabled={disabled || loading} aria-busy={loading || props["aria-busy"]}>
    {LeadingIcon && <LeadingIcon className={`action-button__icon${loading ? " action-button__icon--loading" : ""}`} size={18} strokeWidth={2} aria-hidden="true" />}
    <span>{typeof children === "string" ? text(children) : children}</span>
    {TrailingIcon && <TrailingIcon className="action-button__icon" size={18} strokeWidth={2} aria-hidden="true" />}
  </button>;
}
