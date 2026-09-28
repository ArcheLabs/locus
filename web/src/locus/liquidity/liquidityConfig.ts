export type FeaturedLiquidityPair = { assetA: string; assetB: string };
export type PermissionlessLiquidityConfig = {
  version: 2;
  network: "local" | "testnet";
  mode: "permissionless";
  featuredPairs: FeaturedLiquidityPair[];
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

export function liquidityConfigPath(networkId: string, baseUrl: string): string {
  const base = baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`;
  return `${base}liquidity/${networkId}.json`;
}

export function parsePermissionlessLiquidityConfig(
  value: unknown,
  networkId: "local" | "testnet",
  knownAssetKeys: readonly string[],
): PermissionlessLiquidityConfig {
  if (!isRecord(value) || value.version !== 2 || value.network !== networkId || value.mode !== "permissionless" || !Array.isArray(value.featuredPairs)) {
    throw new Error("Invalid permissionless liquidity configuration.");
  }
  const known = new Set(knownAssetKeys);
  if (known.size !== knownAssetKeys.length) throw new Error("Asset catalog has duplicate keys.");
  const seen = new Set<string>();
  const featuredPairs: FeaturedLiquidityPair[] = [];
  for (const raw of value.featuredPairs) {
    if (!isRecord(raw) || typeof raw.assetA !== "string" || typeof raw.assetB !== "string") throw new Error("Invalid featured liquidity pair.");
    if (raw.assetA === raw.assetB) throw new Error("Featured pair must use two different assets.");
    if (!known.has(raw.assetA) || !known.has(raw.assetB)) throw new Error("Featured pair references an unknown asset key.");
    const pairKey = [raw.assetA, raw.assetB].sort().join("\u0000");
    if (seen.has(pairKey)) throw new Error("Duplicate featured pair.");
    seen.add(pairKey);
    featuredPairs.push({ assetA: raw.assetA, assetB: raw.assetB });
  }
  return { version: 2, network: networkId, mode: "permissionless", featuredPairs };
}

export async function loadPermissionlessLiquidityConfig(
  networkId: "local" | "testnet",
  knownAssetKeys: readonly string[],
  baseUrl = import.meta.env.BASE_URL,
  fetchImpl: typeof fetch = fetch,
): Promise<PermissionlessLiquidityConfig | null> {
  try {
    const response = await fetchImpl(liquidityConfigPath(networkId, baseUrl), { cache: "no-store" });
    if (!response.ok) return null;
    return parsePermissionlessLiquidityConfig(await response.json(), networkId, knownAssetKeys);
  } catch {
    return null;
  }
}
