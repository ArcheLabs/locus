import type { AssetView } from "../locus/assets.js";
import { AssetIdentity } from "./AssetSelector.js";

export type ConfirmationAssetLine = {
  asset: AssetView;
  amount: string;
  detail?: string;
};

export function ConfirmationAssetList({ items, className = "" }: {
  items: readonly ConfirmationAssetLine[];
  className?: string;
}) {
  return <div className={`confirmation-asset-list ${className}`.trim()}>
    {items.map(({ asset, amount, detail }) => <AssetIdentity
      key={asset.assetIdHex}
      asset={asset}
      size={28}
      detail={detail}
      amount={amount}
    />)}
  </div>;
}
