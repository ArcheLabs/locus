import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { Check, ChevronDown, Network as NetworkIcon } from "lucide-react";
import { useNetwork } from "./NetworkProvider.js";
import type { LocusNetworkId } from "./types.js";
import { useI18n } from "../i18n/I18nProvider.js";

function statusLabel(status: string, text: (sourceText: string) => string): string {
  if (status === "ready") return text("Connected");
  if (status === "connecting") return text("Connecting");
  if (status === "unconfigured") return text("Not configured");
  if (status === "error") return text("Connection needs attention");
  return text("Idle");
}

export function NetworkSwitcher({ compact = false }: { compact?: boolean }) {
  const { networkId, config, status, switchNetwork } = useNetwork();
  const { t, text } = useI18n();
  if (!config) return null;
  const options = Object.keys(config.networks) as LocusNetworkId[];
  const selected = config.networks[networkId];
  const selectedStatus = statusLabel(status, text);
  const labelFor = (id: string, label: string) => id === "local" ? t("common.local") : id === "testnet" ? t("common.testnet") : id === "dev" || id === "development" ? t("common.development") : id === "mainnet" ? t("common.mainnet") : label;
  return (
    <DropdownMenu.Root>
      <div className="network-switcher">
        <DropdownMenu.Portal>
          <DropdownMenu.Content className="network-menu dropdown-surface" sideOffset={8} align={compact ? "end" : "start"}>
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
                <span><strong>{labelFor(id, entry.label)}</strong></span>
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
            aria-label={compact ? t("network.selectCurrent", { network: labelFor(networkId, selected.label), status: selectedStatus }) : undefined}
            title={compact ? t("network.networkStatus", { network: labelFor(networkId, selected.label), status: selectedStatus }) : undefined}
          >
            {compact ? <>
              <NetworkIcon size={19} aria-hidden="true" />
              <span className={`status-dot network-compact-status ${status}`} aria-hidden="true" />
            </> : <>
              <span className={`status-dot ${status}`} aria-hidden="true" />
              <span><strong>{labelFor(networkId, selected.label)}</strong></span>
              <span className="network-chevron"><ChevronDown size={16} aria-hidden="true" /></span>
            </>}
          </button>
        </DropdownMenu.Trigger>
      </div>
    </DropdownMenu.Root>
  );
}
