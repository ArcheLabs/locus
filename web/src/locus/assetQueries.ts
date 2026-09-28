export type AssetFilter = "all" | "crypto" | "equities" | "custom";

export function assetIdsQueryKey(networkId: string, serviceId: number) {
  return ["locus", "assets", "ids", networkId, serviceId] as const;
}

export function assetMetadataQueryKey(networkId: string, serviceId: number, assetIdHex: string) {
  return ["locus", "assets", "metadata", networkId, serviceId, assetIdHex.toLowerCase()] as const;
}

export function assetBalanceQueryKey(networkId: string, serviceId: number, ownerKey: string, assetIdHex: string) {
  return ["locus", "assets", "balance", networkId, serviceId, ownerKey, assetIdHex.toLowerCase()] as const;
}

export const assetQueryRetry = 2;
export const assetQueryRetryDelay = (attempt: number) => Math.min(500 * (attempt + 1), 2_000);
