import type { LocusClient, Ownership, Pool } from "@archelabs/locus";
import type { AssetView, CuratedCatalog } from "../assets.js";
import { ManagedLiquidityPanel, type ManagedLiquidityScope } from "./ManagedLiquidityPanel.js";
import type { ManagedLiquidityConfig } from "./liquidityConfig.js";

export function LiquidityPage({ config, catalog, assets, pools, poolsError, poolsLoading, locus, networkId, serviceId, sessionOwner, connectionId, networkReady, isScopeCurrent, onPoolsRefreshed, onRefreshAssets }: {
  config: ManagedLiquidityConfig;
  catalog: CuratedCatalog;
  assets: AssetView[];
  pools: Pool[];
  poolsError: string;
  poolsLoading: boolean;
  locus: LocusClient | null;
  networkId: string;
  serviceId: number | null;
  sessionOwner: Ownership;
  connectionId: string | null;
  networkReady: boolean;
  isScopeCurrent: (scope: ManagedLiquidityScope) => boolean;
  onPoolsRefreshed: (pools: Pool[]) => void;
  onRefreshAssets: () => Promise<unknown>;
}) {
  return <section className="page liquidity-page">
    <header className="page-heading"><div><h1>Liquidity</h1><p className="muted">Managed pools for this network.</p></div></header>
    <p className="liquidity-disclosure">Locus v1 uses managed liquidity. Each pool has one manager Ownership; this version does not issue LP tokens or track individual liquidity shares.</p>
    {poolsError && <div className="inline-alert" role="alert">Pool information could not be refreshed. Existing on-chain data is still shown where available.</div>}
    {poolsLoading && pools.length === 0 && <p className="muted">Loading pool information…</p>}
    <ManagedLiquidityPanel
      config={config}
      curatedAssets={catalog.assets}
      assets={assets}
      pools={pools}
      locus={locus}
      networkId={networkId}
      serviceId={serviceId}
      sessionOwner={sessionOwner}
      connectionId={connectionId}
      networkReady={networkReady}
      isScopeCurrent={isScopeCurrent}
      onPoolsRefreshed={onPoolsRefreshed}
      onRefreshAssets={onRefreshAssets}
    />
  </section>;
}
