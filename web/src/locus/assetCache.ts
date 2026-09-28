export type AssetRowIdentity = { assetIdHex: string };
export type AssetMetadataCache<T extends AssetRowIdentity> = { scope: string; rows: T[] };

export function keepAssetRowsForScope<T extends AssetRowIdentity>(previous: AssetMetadataCache<T>, scope: string, incoming: readonly T[]): AssetMetadataCache<T> {
  if (previous.scope !== scope) return { scope, rows: [...incoming] };
  const byId = new Map(previous.rows.map((row) => [row.assetIdHex.toLowerCase(), row]));
  for (const row of incoming) byId.set(row.assetIdHex.toLowerCase(), row);
  return { scope, rows: [...byId.values()] };
}

export function attachAssetBalances<T extends AssetRowIdentity>(rows: readonly T[], balances: ReadonlyMap<string, bigint>, hasOwner: boolean): Array<T & { balance: bigint | null }> {
  return rows.map((row) => ({ ...row, balance: hasOwner ? balances.get(row.assetIdHex.toLowerCase()) ?? null : null }));
}
