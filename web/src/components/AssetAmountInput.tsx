import type { ReactNode } from "react";
import { useI18n } from "../i18n/I18nProvider.js";

/** Shared asset selector + amount control used by Send, Swap, and Liquidity. */
export function AssetAmountInput({
  selector,
  label,
  balance,
  id,
  amount,
  onAmountChange,
  onAmountBlur,
  onMax,
  maxDisabled = false,
  disabled = false,
  readOnly = false,
  placeholder = "0",
  ariaLabel,
  ariaInvalid,
  ariaDescribedBy,
  className = "",
}: {
  selector: ReactNode;
  label: string;
  balance?: ReactNode;
  id: string;
  amount: string;
  onAmountChange?: (value: string) => void;
  onAmountBlur?: () => void;
  onMax?: () => void;
  maxDisabled?: boolean;
  disabled?: boolean;
  readOnly?: boolean;
  placeholder?: string;
  ariaLabel: string;
  ariaInvalid?: boolean;
  ariaDescribedBy?: string;
  className?: string;
}) {
  const { text } = useI18n();
  const inputPlaceholder = /^\d+(?:\.\d+)?$/.test(placeholder) ? placeholder : text(placeholder);
  return <div className={`asset-amount-field ${className}`.trim()}>
    <div className="asset-amount-heading">
      <label htmlFor={readOnly ? undefined : id}>{text(label)}</label>
      {balance && <span>{typeof balance === "string" ? text(balance) : balance}</span>}
    </div>
    <div className={`asset-amount-control${readOnly ? " asset-amount-control--output" : ""}`}>
      <div className="asset-amount-selector">{selector}</div>
      <input
        id={id}
        className={readOnly ? "asset-amount-output" : undefined}
        value={amount}
        inputMode="decimal"
        placeholder={inputPlaceholder}
        disabled={disabled}
        readOnly={readOnly}
        onBlur={onAmountBlur}
        onChange={(event) => onAmountChange?.(event.target.value)}
        aria-label={text(ariaLabel)}
        aria-invalid={ariaInvalid}
        aria-describedby={ariaDescribedBy}
      />
      {onMax && <button type="button" className="asset-amount-max" disabled={disabled || maxDisabled} onClick={onMax}>{text("Max")}</button>}
    </div>
  </div>;
}
