import { SelectField, type SelectFieldOption } from "./SelectField.js";
import { SegmentedControl } from "./SegmentedControl.js";

export type ResponsiveSelectOption = Pick<SelectFieldOption, "value" | "label" | "textValue">;

export function ResponsiveSelect({
  id,
  ariaLabel,
  value,
  options,
  onValueChange,
}: {
  id: string;
  ariaLabel: string;
  value: string;
  options: readonly ResponsiveSelectOption[];
  onValueChange: (value: string) => void;
}) {
  return (
    <div className="responsive-select">
      <SegmentedControl
        className="responsive-select__tabs asset-class-tabs"
        ariaLabel={ariaLabel}
        value={value}
        options={options}
        onValueChange={onValueChange}
      />
      <div className="responsive-select__mobile">
        <SelectField
          id={id}
          aria-label={ariaLabel}
          value={value}
          onValueChange={onValueChange}
          options={options}
        />
      </div>
    </div>
  );
}
