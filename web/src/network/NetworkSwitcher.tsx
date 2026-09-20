import { useState } from "react";
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
  if (!config) return null;
  const options: LocusNetworkId[] = ["local", "testnet"];
  const selected = config.networks[networkId];
  return (
    <div className="network-switcher">
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
                <span className="network-option-check">{id === networkId ? "✓" : ""}</span>
                <span><strong>{entry.label}</strong><small>{id === "local" ? "Local development" : "MiniJAM Testnet"}</small></span>
              </button>
            );
          })}
        </div>
      )}
      <button type="button" className="network-trigger" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((value) => !value)}>
        <span className={`status-dot ${status}`} aria-hidden="true" />
        <span><strong>{selected.label}</strong><small>{statusLabel(status)}</small></span>
        <span className="network-chevron">{open ? "▴" : "▾"}</span>
      </button>
    </div>
  );
}
