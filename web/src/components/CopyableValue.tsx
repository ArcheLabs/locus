import { Check, Copy } from "lucide-react";
import { useEffect, useState } from "react";
import { compactValue } from "./valueFormatting.js";
import { useI18n } from "../i18n/I18nProvider.js";
import { useGlobalNotify } from "./GlobalNotificationContext.js";

export { compactValue } from "./valueFormatting.js";

export function CopyableValue({ label, value, className = "", layout = "stacked", copyPlacement = "right" }: {
  label?: string;
  value: string;
  className?: string;
  layout?: "stacked" | "inline";
  copyPlacement?: "left" | "right";
}) {
  const { text, t } = useI18n();
  const notify = useGlobalNotify();
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const timeout = window.setTimeout(() => setCopied(false), 1_500);
    return () => window.clearTimeout(timeout);
  }, [copied]);

  async function copy() {
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(value);
      } else {
        const temporary = document.createElement("textarea");
        temporary.value = value;
        temporary.readOnly = true;
        temporary.style.position = "fixed";
        temporary.style.opacity = "0";
        document.body.append(temporary);
        temporary.select();
        const copied = document.execCommand("copy");
        temporary.remove();
        if (!copied) throw new Error("Clipboard unavailable");
      }
      setCopied(true);
      notify("Copied");
    } catch {
      setCopied(false);
    }
  }

  const copyButton = <button type="button" className="copyable-value__button" onClick={() => void copy()} aria-label={copied ? `${text(label ?? "Value")} ${t("common.copied")}` : `${t("common.copy")} ${text(label ?? "value")}`} title={t(copied ? "common.copied" : "common.copy")}>
    {copied ? <Check size={15} aria-hidden="true" /> : <Copy size={15} aria-hidden="true" />}
  </button>;
  return <span className={`copyable-value copyable-value--${layout} copyable-value--copy-${copyPlacement} ${className}`.trim()}>
    {label && <small>{text(label)}</small>}
    <span className="copyable-value__row">
      {copyPlacement === "left" && copyButton}
      <code title={value}>{compactValue(value)}</code>
      {copyPlacement === "right" && copyButton}
    </span>
  </span>;
}
