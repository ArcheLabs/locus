export type ManagedLiquidityIdentity = {
  managerKey: string;
} | null;

export function isConfiguredLiquidityManager(
  currentOwnerKey: string | null,
  config: ManagedLiquidityIdentity,
): boolean {
  return currentOwnerKey !== null
    && config !== null
    && currentOwnerKey.toLowerCase() === config.managerKey.toLowerCase();
}
