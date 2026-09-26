import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { Check, ChevronDown, Network as NetworkIcon } from "lucide-react";
import { useNetwork } from "./NetworkProvider.js";
import type { LocusNetworkId } from "./types.js";

function statusLabel(status: string): string {
  if (status === "ready") return "Connected";
  if (status === "connecting") return "Connecting";
  if (status === "unconfigured") return "Not configured";
  if (status === "error") return "Unavailable";
  return "Idle";
}

export function NetworkSwitcher({ compact = false }: { compact?: boolean }) {
  const { networkId, config, status, switchNetwork } = useNetwork();
  if (!config) return null;
  const options: LocusNetworkId[] = ["local", "testnet"];
  const selected = config.networks[networkId];
  return (
    <DropdownMenu.Root>
      <div className="network-switcher">
        <DropdownMenu.Portal>
          <DropdownMenu.Content className="network-menu" sideOffset={8} align={compact ? "end" : "start"}>
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
                <span><strong>{entry.label}</strong></span>
              </DropdownMenu.RadioItem>
            );
          })}
            </DropdownMenu.RadioGroup>
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
        <DropdownMenu.Trigger asChild>
          <button
            type="button"
            className={compact ? "network-trigger network-trigger-compact" : "network-trigger"}
            aria-label={compact ? `Select network. Current network: ${selected.label}, ${statusLabel(status)}` : undefined}
            title={compact ? `Network: ${selected.label} (${statusLabel(status)})` : undefined}
          >
            {compact ? <>
              <NetworkIcon size={19} aria-hidden="true" />
              <span className={`status-dot network-compact-status ${status}`} aria-hidden="true" />
            </> : <>
              <span className={`status-dot ${status}`} aria-hidden="true" />
              <span><strong>{selected.label}</strong></span>
              <span className="network-chevron"><ChevronDown size={16} aria-hidden="true" /></span>
            </>}
          </button>
        </DropdownMenu.Trigger>
      </div>
    </DropdownMenu.Root>
  );
}
