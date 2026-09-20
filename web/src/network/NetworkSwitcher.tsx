import { useEffect, useRef, useState } from "react";
import { Check, ChevronDown, ChevronUp } from "lucide-react";
import { useNetwork } from "./NetworkProvider.js";
import type { LocusNetworkId } from "./types.js";

function statusLabel(status: string): string {
  if (status === "ready") return "Connected";
  if (status === "connecting") return "Connecting";
  if (status === "unconfigured") return "Not configured";
  if (status === "error") return "Unavailable";
  return "Idle";
}

export function NetworkSwitcher() {
  const { networkId, config, status, switchNetwork } = useNetwork();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    function closeOnOutside(event: PointerEvent) {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    }
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    document.addEventListener("pointerdown", closeOnOutside);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutside);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [open]);
  if (!config) return null;
  const options: LocusNetworkId[] = ["local", "testnet"];
  const selected = config.networks[networkId];
  return (
    <div className="network-switcher" ref={rootRef}>
      {open && (
        <div className="network-menu" role="menu">
          {options.map((id) => {
            const entry = config.networks[id];
            return (
              <button
                type="button"
                role="menuitemradio"
                aria-checked={id === networkId}
                className={id === networkId ? "network-option active" : "network-option"}
                key={id}
                onClick={() => { switchNetwork(id); setOpen(false); }}
              >
                <span className="network-option-check">{id === networkId && <Check size={15} aria-hidden="true" />}</span>
                <span><strong>{entry.label}</strong><small>{id === "local" ? "Local development" : "MiniJAM Testnet"}</small></span>
              </button>
            );
          })}
        </div>
      )}
      <button type="button" className="network-trigger" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((value) => !value)}>
        <span className={`status-dot ${status}`} aria-hidden="true" />
        <span><strong>{selected.label}</strong><small>{statusLabel(status)}</small></span>
        <span className="network-chevron">{open ? <ChevronUp size={16} aria-hidden="true" /> : <ChevronDown size={16} aria-hidden="true" />}</span>
      </button>
    </div>
  );
}
