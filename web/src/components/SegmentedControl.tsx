import type { ReactNode } from "react";

export type SegmentedOption = { value: string; label: ReactNode };

export function SegmentedControl({
  value,
  options,
  onValueChange,
  ariaLabel,
  className = "",
}: {
  value: string;
  options: readonly SegmentedOption[];
  onValueChange: (value: string) => void;
  ariaLabel: string;
  className?: string;
}) {
  return <div className={`segmented-control ${className}`.trim()} role="group" aria-label={ariaLabel}>
    {options.map((option) => <button
      key={option.value}
      type="button"
      aria-pressed={value === option.value}
      className={value === option.value ? "active" : ""}
      onClick={() => onValueChange(option.value)}
    >{option.label}</button>)}
  </div>;
}
