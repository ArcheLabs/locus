import { CircleDollarSign } from "lucide-react";
import { SiPolkadot, SiTether } from "react-icons/si";
import type { CSSProperties } from "react";
import minijamMark from "../assets/brands/minijam-w.svg";
import type { AssetView } from "../locus/assets.js";

export function AssetIcon({ asset, size = 40 }: { asset: AssetView; size?: number }) {
  const safeSize = Number.isInteger(size) && size > 0 ? size : 40;
  const { presentation } = asset;
  if (presentation.class === "equity-demo" && presentation.curated) {
    return <span className="asset-icon asset-icon--equity" style={{ width: safeSize, height: safeSize }} aria-label={`${asset.symbol} demo equity`}>
      <span>{asset.symbol}</span>
    </span>;
  }
  if (presentation.curated && presentation.iconKey === "dot") {
    return <span className="asset-icon asset-icon--dot" style={{ width: safeSize, height: safeSize }} aria-label="Polkadot test asset"><SiPolkadot size={Math.round(safeSize * 0.58)} aria-hidden="true" /></span>;
  }
  if (presentation.curated && presentation.iconKey === "usdt") {
    return <span className="asset-icon asset-icon--usdt" style={{ width: safeSize, height: safeSize }} aria-label="Tether test asset"><SiTether size={Math.round(safeSize * 0.58)} aria-hidden="true" /></span>;
  }
  if (presentation.curated && presentation.iconKey === "mini") {
    return <span className="asset-icon asset-icon--mini" style={{ width: safeSize, height: safeSize }} aria-label="MINI test asset"><img src={minijamMark} alt="" aria-hidden="true" /></span>;
  }
  let hash = 0;
  for (const char of asset.assetIdHex) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  const initials = asset.symbol.replace(/[^A-Za-z0-9]/g, "").slice(0, 2).toUpperCase() || "?";
  return <span className="asset-icon asset-icon--custom" style={{ width: safeSize, height: safeSize, "--asset-hue": hash % 360 } as CSSProperties} aria-label={`${asset.symbol} custom asset`}>
    {presentation.curated ? <CircleDollarSign size={Math.round(safeSize * 0.58)} aria-hidden="true" /> : <span>{initials}</span>}
  </span>;
}
