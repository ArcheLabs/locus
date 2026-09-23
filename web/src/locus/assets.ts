import { decodeAssetName, decodeAssetSymbol, formatUnits, toHex, type AssetId, type LocusClient, type Ownership } from "@archelabs/locus";

export type AssetView = {
  assetId: AssetId;
  assetIdHex: string;
  name: string;
  symbol: string;
  decimals: number;
  totalSupply: bigint;
  balance: bigint | null;
  color: string;
};

const colors = ["#247eaa", "#8555df", "#18a56b", "#7c8798", "#d06b3c"];

export async function loadAssets(locus: LocusClient, owner: Ownership | null): Promise<AssetView[]> {
  const ids = await locus.listAssets();
  return Promise.all(ids.map(async (assetId, index) => {
    const asset = await locus.getAsset(assetId);
    if (!asset) throw new Error(`asset ${toHex(assetId)} disappeared while loading`);
    return {
      assetId,
      assetIdHex: toHex(assetId),
      name: decodeAssetName(asset.name),
      symbol: decodeAssetSymbol(asset.symbol),
      decimals: asset.decimals,
      totalSupply: asset.totalSupply,
      balance: owner ? await locus.balanceOf(assetId, owner) : null,
      color: colors[index % colors.length],
    };
  }));
}

export function displayAmount(value: bigint | null, decimals: number): string {
  return formatUnits(value ?? 0n, decimals);
}
