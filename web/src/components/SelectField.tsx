import type { ReactNode } from "react";
import * as Select from "@radix-ui/react-select";
import { Check, ChevronDown, ChevronUp } from "lucide-react";

export type SelectFieldOption = {
  value: string;
  label: ReactNode;
  textValue?: string;
  disabled?: boolean;
};

export type SelectFieldProps = Omit<Select.SelectProps, "children"> & {
  id?: string;
  "aria-label"?: string;
  triggerClassName?: string;
  placeholder?: ReactNode;
  options: readonly SelectFieldOption[];
};

/** Shared Radix single-choice control for site-wide keyboard-accessible selection. */
export function SelectField({
  id,
  "aria-label": ariaLabel,
  triggerClassName = "",
  placeholder,
  options,
  ...props
}: SelectFieldProps) {
  return (
    <Select.Root {...props}>
      <Select.Trigger id={id} aria-label={ariaLabel} className={`select-field__trigger ${triggerClassName}`.trim()}>
        <Select.Value placeholder={placeholder} />
        <Select.Icon className="select-field__icon"><ChevronDown size={16} aria-hidden="true" /></Select.Icon>
      </Select.Trigger>
      <Select.Portal>
        <Select.Content className="select-field__content dropdown-surface" position="popper" sideOffset={4}>
          <Select.ScrollUpButton className="select-field__scroll-button"><ChevronUp size={16} aria-hidden="true" /></Select.ScrollUpButton>
          <Select.Viewport className="select-field__viewport">
            {options.map((option) => (
              <Select.Item
                key={option.value}
                value={option.value}
                textValue={option.textValue}
                disabled={option.disabled}
                className="select-field__item"
              >
                <Select.ItemText>{option.label}</Select.ItemText>
                <Select.ItemIndicator className="select-field__item-check"><Check size={16} aria-hidden="true" /></Select.ItemIndicator>
              </Select.Item>
            ))}
          </Select.Viewport>
          <Select.ScrollDownButton className="select-field__scroll-button"><ChevronDown size={16} aria-hidden="true" /></Select.ScrollDownButton>
        </Select.Content>
      </Select.Portal>
    </Select.Root>
  );
}
