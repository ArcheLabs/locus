import * as Popover from "@radix-ui/react-popover";
import { Check, ChevronDown } from "lucide-react";
import { displayAmount, type AssetView } from "./assets.js";

export function AssetPicker({ networkMode, asset, assets, search, open, onOpenChange, onSearch, onSelect, onCycleDemo }: {
  networkMode: boolean;
  asset: AssetView | { symbol: string; name: string; balance: bigint; decimals: number; color: string } | null;
  assets: AssetView[];
  search: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSearch: (value: string) => void;
  onSelect: (asset: AssetView) => void;
  onCycleDemo: () => void;
}) {
  const symbol = asset?.symbol ?? "Asset";
  const matching = assets.filter((entry) => !search || `${entry.name} ${entry.symbol} ${entry.assetIdHex}`.toLowerCase().includes(search.toLowerCase()));
  const selectedId = asset && "assetIdHex" in asset ? asset.assetIdHex : undefined;
  const trigger = <button type="button" className="asset-picker" onClick={networkMode ? undefined : onCycleDemo} aria-label="Select asset">
    <span className="coin" style={{ background: asset?.color ?? "#98a2b3" }}>{asset?.symbol?.[0] ?? "?"}</span>
    <span className="asset-copy"><strong>{symbol}</strong><small>{asset?.name ?? "No assets found on this network."}</small></span>
    <span className="balance-copy"><small>Balance</small><strong>{displayAmount(asset?.balance ?? null, asset?.decimals ?? 0)} {asset ? symbol : ""}</strong></span>
    <ChevronDown size={17} className="muted" aria-hidden="true" />
  </button>;
  if (!networkMode) return <div className="asset-picker-wrap">{trigger}</div>;
  return <Popover.Root open={open} onOpenChange={onOpenChange}>
    <Popover.Trigger asChild>{trigger}</Popover.Trigger>
    <Popover.Portal>
      <Popover.Content className="asset-menu" sideOffset={8} align="start" aria-label="Select asset">
        <input autoFocus value={search} placeholder="Search assets" onChange={(event) => onSearch(event.target.value)} />
        {matching.length === 0 ? <div className="empty-state">No matching assets.</div> : matching.map((entry) => <button type="button" role="option" aria-selected={entry.assetIdHex === selectedId} key={entry.assetIdHex} onClick={() => { onSelect(entry); onOpenChange(false); }}><span className="coin small-coin" style={{ background: entry.color }}>{entry.symbol[0]}</span><span><strong>{entry.symbol}</strong><small>{entry.name}</small></span><span>{displayAmount(entry.balance, entry.decimals)}</span>{entry.assetIdHex === selectedId && <Check size={15} aria-hidden="true" />}</button>)}
      </Popover.Content>
    </Popover.Portal>
  </Popover.Root>;
}
