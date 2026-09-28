import { ChevronDown } from "lucide-react";
import { displayAmount, type AssetView } from "./assets.js";
import { AssetIcon } from "../components/AssetIcon.js";
import { AssetSelector } from "../components/AssetSelector.js";

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
  const selectedId = asset && "assetIdHex" in asset ? asset.assetIdHex : undefined;
  if (!networkMode) return <div className="asset-picker-wrap"><button type="button" className="asset-picker" onClick={onCycleDemo} aria-label="Select asset">
    {asset && "presentation" in asset ? <AssetIcon asset={asset} /> : <span className="coin" style={{ background: asset?.color ?? "#98a2b3" }}>{asset?.symbol?.[0] ?? "?"}</span>}
    <span className="asset-copy"><strong>{symbol}</strong><small>{asset?.name ?? "No assets found on this network."}</small></span>
    <span className="balance-copy"><small>Balance</small><strong>{`${displayAmount(asset?.balance ?? null, asset?.decimals ?? 0)} ${asset ? symbol : ""}`}</strong></span>
    <ChevronDown size={17} className="muted" aria-hidden="true" />
  </button></div>;
  return <AssetSelector assets={assets} value={selectedId ?? ""} onValueChange={onSelect} aria-label="Select asset" variant="card" triggerClassName="asset-picker" search={search} onSearch={onSearch} open={open} onOpenChange={onOpenChange} />;
}
