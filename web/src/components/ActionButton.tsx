import type { ButtonHTMLAttributes } from "react";
import type { LucideIcon } from "lucide-react";

type ActionButtonProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children"> & {
  icon: LucideIcon;
  variant: "primary" | "secondary";
  children: string;
};

export function ActionButton({ icon: Icon, variant, children, className = "", type = "button", ...props }: ActionButtonProps) {
  const classes = ["action-button", `action-button--${variant}`, className].filter(Boolean).join(" ");
  return <button {...props} type={type} className={classes}>
    <Icon className="action-button__icon" size={18} strokeWidth={2} aria-hidden="true" />
    <span>{children}</span>
  </button>;
}
