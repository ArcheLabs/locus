import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { Check, ChevronDown } from "lucide-react";
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
  if (!config) return null;
  const options: LocusNetworkId[] = ["local", "testnet"];
  const selected = config.networks[networkId];
  return (
    <DropdownMenu.Root>
      <div className="network-switcher">
        <DropdownMenu.Portal>
          <DropdownMenu.Content className="network-menu" sideOffset={8} align="start">
            <DropdownMenu.RadioGroup value={networkId} onValueChange={(value) => switchNetwork(value as LocusNetworkId)}>
          {options.map((id) => {
            const entry = config.networks[id];
            return (
              <DropdownMenu.RadioItem
                value={id}
                className={id === networkId ? "network-option active" : "network-option"}
                key={id}
                onSelect={() => switchNetwork(id)}
              >
                <DropdownMenu.ItemIndicator className="network-option-check"><Check size={15} aria-hidden="true" /></DropdownMenu.ItemIndicator>
                <span><strong>{entry.label}</strong><small>{id === "local" ? "Local development" : "MiniJAM Testnet"}</small></span>
              </DropdownMenu.RadioItem>
            );
          })}
            </DropdownMenu.RadioGroup>
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
        <DropdownMenu.Trigger asChild>
          <button type="button" className="network-trigger">
        <span className={`status-dot ${status}`} aria-hidden="true" />
        <span><strong>{selected.label}</strong><small>{statusLabel(status)}</small></span>
            <span className="network-chevron"><ChevronDown size={16} aria-hidden="true" /></span>
          </button>
        </DropdownMenu.Trigger>
      </div>
    </DropdownMenu.Root>
  );
}
