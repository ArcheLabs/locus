import { ChevronDown } from "lucide-react";
import { displayAmount, type AssetView } from "./assets.js";
import { AssetIcon } from "../components/AssetIcon.js";
import { AssetSelector } from "../components/AssetSelector.js";
import { useI18n } from "../i18n/I18nProvider.js";

export function AssetPicker({ networkMode, asset, assets, search, open, onOpenChange, onSearch, onSelect, onCycleDemo, variant = "card" }: {
  networkMode: boolean;
  asset: AssetView | { symbol: string; name: string; balance: bigint; decimals: number; color: string } | null;
  assets: AssetView[];
  search: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSearch: (value: string) => void;
  onSelect: (asset: AssetView) => void;
  onCycleDemo: () => void;
  variant?: "card" | "compact";
}) {
  const { t } = useI18n();
  const symbol = asset?.symbol ?? "Asset";
  const selectedId = asset && "assetIdHex" in asset ? asset.assetIdHex : undefined;
  if (!networkMode) return <div className="asset-picker-wrap"><button type="button" className={`asset-picker ${variant === "compact" ? "asset-picker--compact" : ""}`} onClick={onCycleDemo} aria-label={t("assets.title")}>
    {asset && "presentation" in asset ? <AssetIcon asset={asset} /> : <span className="coin" style={{ background: asset?.color ?? "#98a2b3" }}>{asset?.symbol?.[0] ?? "?"}</span>}
    <span className="asset-copy"><strong>{symbol}</strong><small>{asset?.name ?? t("ui.noAssets")}</small></span>
    {variant === "card" && <span className="balance-copy"><small>{t("common.balance")}</small><strong>{`${displayAmount(asset?.balance ?? null, asset?.decimals ?? 0)} ${asset ? symbol : ""}`}</strong></span>}
    <ChevronDown size={17} className="muted" aria-hidden="true" />
  </button></div>;
  return <div className="asset-picker-wrap"><AssetSelector assets={assets} value={selectedId ?? ""} onValueChange={onSelect} aria-label={t("common.selectAsset")} variant={variant} showBalance={variant === "card"} triggerClassName="asset-picker" search={search} onSearch={onSearch} open={open} onOpenChange={onOpenChange} /></div>;
}
