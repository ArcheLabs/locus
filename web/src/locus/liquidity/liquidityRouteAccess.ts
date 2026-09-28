export type LiquidityRouteReadiness = {
  networkMode: boolean;
  networkStatus: "idle" | "connecting" | "ready" | "error" | "unconfigured";
  sessionLifecycle: "restoring" | "connected" | "disconnected";
  catalogPending: boolean;
  catalogError: boolean;
  catalogMatchesDeployment: boolean;
  managedConfigPending: boolean;
};

/**
 * A direct /liquidity load must wait until network, catalog, manager config,
 * and any persisted session restore have settled before deciding access.
 */
export function canResolveLiquidityRouteAccess(state: LiquidityRouteReadiness): boolean {
  if (!state.networkMode || state.networkStatus === "idle") return true;
  if (state.networkStatus === "connecting") return false;
  if (state.networkStatus !== "ready") return true;
  if (state.sessionLifecycle === "restoring" || state.catalogPending) return false;
  if (state.catalogError || !state.catalogMatchesDeployment) return true;
  return !state.managedConfigPending;
}
