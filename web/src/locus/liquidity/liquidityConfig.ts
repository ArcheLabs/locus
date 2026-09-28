export type ManagedLiquidityPair = {
  assetA: string;
  assetB: string;
  enabled: boolean;
};

export type ManagedLiquidityConfig = {
  version: 1;
  network: "local" | "testnet";
  mode: "managed";
  managerKey: string;
  pairs: ManagedLiquidityPair[];
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

export function liquidityConfigPath(networkId: string, baseUrl: string): string {
  const base = baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`;
  return `${base}liquidity/${networkId}.json`;
}

export function parseManagedLiquidityConfig(
  value: unknown,
  networkId: "local" | "testnet",
  curatedAssetKeys: readonly string[],
): ManagedLiquidityConfig {
  if (!isRecord(value) || value.version !== 1 || value.network !== networkId || value.mode !== "managed"
    || typeof value.managerKey !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(value.managerKey)
    || !Array.isArray(value.pairs)) {
    throw new Error("Invalid managed liquidity configuration.");
  }
  const keys = new Set(curatedAssetKeys);
  if (keys.size !== curatedAssetKeys.length) throw new Error("Curated catalog has duplicate asset keys.");
  const seenPairs = new Set<string>();
  const pairs: ManagedLiquidityPair[] = [];
  for (const raw of value.pairs) {
    if (!isRecord(raw) || typeof raw.assetA !== "string" || typeof raw.assetB !== "string" || typeof raw.enabled !== "boolean") {
      throw new Error("Invalid managed liquidity pair.");
    }
    if (raw.assetA === raw.assetB) throw new Error("A managed liquidity pair must use two different assets.");
    if (!keys.has(raw.assetA) || !keys.has(raw.assetB)) throw new Error("Managed liquidity pair references an unknown curated asset.");
    const pairKey = [raw.assetA, raw.assetB].sort().join("\u0000");
    if (seenPairs.has(pairKey)) throw new Error("Managed liquidity configuration contains a duplicate pair.");
    seenPairs.add(pairKey);
    pairs.push({ assetA: raw.assetA, assetB: raw.assetB, enabled: raw.enabled });
  }
  return {
    version: 1,
    network: networkId,
    mode: "managed",
    managerKey: value.managerKey.toLowerCase(),
    pairs,
  };
}

export async function loadManagedLiquidityConfig(
  networkId: "local" | "testnet",
  curatedAssetKeys: readonly string[],
  baseUrl = import.meta.env.BASE_URL,
  fetchImpl: typeof fetch = fetch,
): Promise<ManagedLiquidityConfig | null> {
  try {
    const response = await fetchImpl(liquidityConfigPath(networkId, baseUrl), { cache: "no-store" });
    if (!response.ok) return null;
    return parseManagedLiquidityConfig(await response.json(), networkId, curatedAssetKeys);
  } catch {
    return null;
  }
}
