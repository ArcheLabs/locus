export type ErrorLevel = "field" | "form" | "action" | "page";

export type FieldErrors<T extends string = string> = Partial<Record<T, string>>;

export type FormValidation<T extends string = string> = {
  fields: FieldErrors<T>;
  formError?: string;
};
