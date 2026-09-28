import { Check, Copy } from "lucide-react";
import { useEffect, useState } from "react";
import { compactValue } from "./valueFormatting.js";

export { compactValue } from "./valueFormatting.js";

export function CopyableValue({ label, value, className = "" }: { label?: string; value: string; className?: string }) {
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
    } catch {
      setCopied(false);
    }
  }

  return <span className={`copyable-value ${className}`.trim()}>
    {label && <small>{label}</small>}
    <span className="copyable-value__row">
      <code title={value}>{compactValue(value)}</code>
      <button type="button" className="copyable-value__button" onClick={() => void copy()} aria-label={copied ? `${label ?? "Value"} copied` : `Copy ${label ?? "value"}`} title={copied ? "Copied" : "Copy"}>
        {copied ? <Check size={15} aria-hidden="true" /> : <Copy size={15} aria-hidden="true" />}
      </button>
    </span>
  </span>;
}
