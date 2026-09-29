import type { ReactNode } from "react";

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
  balance?: string;
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
  return <div className={`asset-amount-field ${className}`.trim()}>
    <div className="asset-amount-heading">
      <label htmlFor={readOnly ? undefined : id}>{label}</label>
      {balance && <span>{balance}</span>}
    </div>
    <div className={`asset-amount-control${readOnly ? " asset-amount-control--output" : ""}`}>
      <div className="asset-amount-selector">{selector}</div>
      <input
        id={id}
        className={readOnly ? "asset-amount-output" : undefined}
        value={amount}
        inputMode="decimal"
        placeholder={placeholder}
        disabled={disabled}
        readOnly={readOnly}
        onBlur={onAmountBlur}
        onChange={(event) => onAmountChange?.(event.target.value)}
        aria-label={ariaLabel}
        aria-invalid={ariaInvalid}
        aria-describedby={ariaDescribedBy}
      />
      {onMax && <button type="button" className="asset-amount-max" disabled={disabled || maxDisabled} onClick={onMax}>Max</button>}
    </div>
  </div>;
}
