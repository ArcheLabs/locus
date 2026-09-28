import { useMemo, useState } from "react";
import * as Popover from "@radix-ui/react-popover";
import { Check, ChevronDown } from "lucide-react";
import type { AssetView } from "../locus/assets.js";
import { displayAssetAmount } from "../locus/assets.js";
import { AssetIcon } from "./AssetIcon.js";

export function AssetIdentity({ asset, size = 40, detail, amount, className = "" }: {
  asset: AssetView;
  size?: number;
  detail?: string;
  amount?: string;
  className?: string;
}) {
  return <span className={`asset-identity ${className}`.trim()}>
    <AssetIcon asset={asset} size={size} />
    <span className="asset-identity__copy"><strong>{asset.symbol}</strong><small>{detail ?? asset.name}</small></span>
    {amount !== undefined && <strong className="asset-identity__amount">{amount}</strong>}
  </span>;
}

export function AssetSelector({ id, assets, value, onValueChange, "aria-label": ariaLabel, variant = "card", showBalance, triggerClassName = "", disabled = false, search, onSearch, open, onOpenChange, searchPlaceholder = "Search assets" }: {
  id?: string;
  assets: readonly AssetView[];
  value: string;
  onValueChange: (asset: AssetView) => void;
  "aria-label": string;
  variant?: "card" | "compact";
  showBalance?: boolean;
  triggerClassName?: string;
  disabled?: boolean;
  search?: string;
  onSearch?: (value: string) => void;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  searchPlaceholder?: string;
}) {
  const [internalOpen, setInternalOpen] = useState(false);
  const [internalSearch, setInternalSearch] = useState("");
  const selected = assets.find((asset) => asset.assetIdHex.toLowerCase() === value.toLowerCase()) ?? null;
  const isOpen = open ?? internalOpen;
  const searchValue = search ?? internalSearch;
  const balanceVisible = showBalance ?? variant === "card";
  const matching = useMemo(() => {
    const query = searchValue.trim().toLowerCase();
    return assets.filter((asset) => !query || `${asset.name} ${asset.symbol} ${asset.assetIdHex}`.toLowerCase().includes(query));
  }, [assets, searchValue]);

  function changeOpen(next: boolean) {
    if (open === undefined) setInternalOpen(next);
    onOpenChange?.(next);
  }

  function changeSearch(next: string) {
    if (search === undefined) setInternalSearch(next);
    onSearch?.(next);
  }

  return <Popover.Root open={isOpen} onOpenChange={changeOpen}>
    <Popover.Trigger asChild>
      <button id={id} type="button" className={`asset-select-trigger ${variant === "compact" ? "asset-select-trigger--compact" : "asset-select-trigger--card"} ${triggerClassName}`.trim()} aria-label={ariaLabel} disabled={disabled}>
        {selected
          ? <AssetIdentity asset={selected} size={variant === "compact" ? 32 : 40} className="asset-select-trigger__identity" />
          : <span className="asset-select-placeholder">Choose asset</span>}
        {balanceVisible && selected && <span className="balance-copy"><small>Balance</small><strong>{displayAssetAmount(selected)}</strong></span>}
        <ChevronDown size={17} className="muted" aria-hidden="true" />
      </button>
    </Popover.Trigger>
    <Popover.Portal>
      <Popover.Content className="asset-menu dropdown-surface" sideOffset={8} align="start" aria-label={ariaLabel}>
        <input autoFocus className="asset-menu__search" value={searchValue} placeholder={searchPlaceholder} onChange={(event) => changeSearch(event.target.value)} />
        {matching.length === 0
          ? <div className="empty-state">No matching assets.</div>
          : <div className="asset-menu__options" role="listbox" aria-label={ariaLabel}>
            {matching.map((asset) => {
              const isSelected = asset.assetIdHex.toLowerCase() === value.toLowerCase();
              return <button type="button" className="asset-menu__option" role="option" aria-selected={isSelected} key={asset.assetIdHex} onClick={() => { onValueChange(asset); changeOpen(false); }}>
                <AssetIcon asset={asset} size={36} />
                <span className="asset-menu__copy"><strong>{asset.symbol}</strong><small>{asset.name} · {asset.presentation.badge}</small></span>
                <span className="asset-menu__balance">{displayAssetAmount(asset)}</span>
                {isSelected && <Check size={16} className="asset-menu__check" aria-hidden="true" />}
              </button>;
            })}
          </div>}
      </Popover.Content>
    </Popover.Portal>
  </Popover.Root>;
}
