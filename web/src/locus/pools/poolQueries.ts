type PoolPairLike = { asset0: Uint8Array; asset1: Uint8Array };

function bytesToHex(value: Uint8Array): string {
  let result = "0x";
  for (const byte of value) result += byte.toString(16).padStart(2, "0");
  return result;
}

export function poolListQueryKey(networkId: string, serviceId: number | null) {
  return ["locus", "pools", networkId, serviceId ?? 0] as const;
}

export function poolListError(error: unknown): string {
  return error instanceof Error ? error.message : "Pools could not be loaded.";
}

export function directPoolForPair<T extends PoolPairLike>(pools: readonly T[], assetInId: string, assetOutId: string): T | null {
  const input = assetInId.toLowerCase();
  const output = assetOutId.toLowerCase();
  if (!input || !output || input === output) return null;
  return pools.find((pool) => {
    const asset0 = bytesToHex(pool.asset0).toLowerCase();
    const asset1 = bytesToHex(pool.asset1).toLowerCase();
    return (asset0 === input && asset1 === output) || (asset0 === output && asset1 === input);
  }) ?? null;
}
