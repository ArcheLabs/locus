import { decodeAssetName, decodeAssetSymbol, formatUnits, ownershipKey, toHex, type AssetId, type LocusClient, type Ownership } from "@archelabs/locus";
import type { DeploymentDescriptor } from "@jamscript/client";
import { assetCatalogPath } from "../network/paths.js";

export type AssetClass = "crypto" | "equity-demo" | "custom";
export type CuratedIconKey = "dot" | "mini" | "usdt" | "ticker";
export type AssetPresentation = {
  class: AssetClass;
  curated: boolean;
  iconKey?: CuratedIconKey;
  badge: "Test asset" | "Demo equity" | "Custom";
  unit?: string;
  disclosure?: string;
};

export type AssetView = {
  assetId: AssetId;
  assetIdHex: string;
  catalogKey?: string;
  issuer: Ownership;
  name: string;
  symbol: string;
  decimals: number;
  totalSupply: bigint;
  balance: bigint | null;
  presentation: AssetPresentation;
};

export type AssetMetadata = Omit<AssetView, "balance">;

export type CuratedCatalogEntry = {
  key: string;
  assetId: string;
  symbol: string;
  name: string;
  decimals: number;
  issuerKey: string;
  class: "crypto" | "equity-demo";
  status: "test" | "demo";
  icon: CuratedIconKey;
  unit?: string;
  disclosure: string;
};

export type CuratedCatalog = {
  version: 1;
  network: "local" | "testnet";
  genesisHash: string;
  serviceId: number;
  assets: CuratedCatalogEntry[];
};

const CURATED_EXPECTATIONS: Record<string, Pick<CuratedCatalogEntry, "name" | "symbol" | "decimals" | "class" | "status" | "icon" | "unit" | "disclosure">> = {
  dot: { name: "Polkadot", symbol: "DOT", decimals: 10, class: "crypto", status: "test", icon: "dot", disclosure: "Test representation on MiniJAM. It is not native DOT and is not redeemable for DOT." },
  mini: { name: "MiniJAM", symbol: "MINI", decimals: 6, class: "crypto", status: "test", icon: "mini", disclosure: "Development inventory for testing on MiniJAM." },
  usdt: { name: "Tether USD", symbol: "USDT", decimals: 6, class: "crypto", status: "test", icon: "usdt", disclosure: "Test representation only. It is not issued or redeemable by Tether." },
  aapl: { name: "Apple Demo Equity", symbol: "AAPL", decimals: 4, class: "equity-demo", status: "demo", icon: "ticker", unit: "shares", disclosure: "Demo representation only. This asset does not represent equity ownership, voting rights, dividends, custody, or redemption rights." },
  nvda: { name: "NVIDIA Demo Equity", symbol: "NVDA", decimals: 4, class: "equity-demo", status: "demo", icon: "ticker", unit: "shares", disclosure: "Demo representation only. This asset does not represent equity ownership, voting rights, dividends, custody, or redemption rights." },
  tsla: { name: "Tesla Demo Equity", symbol: "TSLA", decimals: 4, class: "equity-demo", status: "demo", icon: "ticker", unit: "shares", disclosure: "Demo representation only. This asset does not represent equity ownership, voting rights, dividends, custody, or redemption rights." },
};

const CUSTOM_PRESENTATION: AssetPresentation = { class: "custom", curated: false, badge: "Custom" };
const CURATED_ICONS = new Set<CuratedIconKey>(["dot", "mini", "usdt", "ticker"]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

export async function loadCuratedCatalog(
  networkId: "local" | "testnet",
  fetchImpl: typeof fetch = fetch,
): Promise<CuratedCatalog | null> {
  let response: Response;
  try {
    response = await fetchImpl(assetCatalogPath(networkId, import.meta.env.BASE_URL), { cache: "no-store" });
  } catch {
    return null;
  }
  if (!response.ok) return null;
  const value: unknown = await response.json();
  if (!isRecord(value) || value.version !== 1 || value.network !== networkId
    || typeof value.genesisHash !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(value.genesisHash)
    || typeof value.serviceId !== "number" || !Number.isSafeInteger(value.serviceId)
    || !Array.isArray(value.assets)) return null;
  const assets: CuratedCatalogEntry[] = [];
  for (const raw of value.assets) {
    if (!isRecord(raw) || typeof raw.key !== "string" || typeof raw.assetId !== "string"
      || !/^0x[0-9a-fA-F]{64}$/.test(raw.assetId) || typeof raw.symbol !== "string"
      || typeof raw.name !== "string" || typeof raw.decimals !== "number"
      || !Number.isInteger(raw.decimals) || typeof raw.issuerKey !== "string"
      || !/^0x[0-9a-fA-F]{64}$/.test(raw.issuerKey)
      || (raw.class !== "crypto" && raw.class !== "equity-demo")
      || (raw.status !== "test" && raw.status !== "demo")
      || typeof raw.icon !== "string" || !CURATED_ICONS.has(raw.icon as CuratedIconKey)
      || typeof raw.disclosure !== "string"
      || (raw.unit !== undefined && typeof raw.unit !== "string")) return null;
    const expected = CURATED_EXPECTATIONS[raw.key];
    if (!expected || raw.name !== expected.name || raw.symbol !== expected.symbol
      || raw.decimals !== expected.decimals || raw.class !== expected.class
      || raw.status !== expected.status || raw.icon !== expected.icon) return null;
    if (raw.disclosure !== expected.disclosure || raw.unit !== expected.unit) return null;
    assets.push(raw as unknown as CuratedCatalogEntry);
  }
  if (assets.length !== Object.keys(CURATED_EXPECTATIONS).length
    || new Set(assets.map((entry) => entry.key)).size !== assets.length
    || new Set(assets.map((entry) => entry.assetId.toLowerCase())).size !== assets.length) return null;
  return { version: 1, network: networkId, genesisHash: value.genesisHash, serviceId: value.serviceId, assets };
}

function catalogMatchesDeployment(catalog: CuratedCatalog | null, networkId: string, deployment: DeploymentDescriptor): catalog is CuratedCatalog {
  return !!catalog
    && catalog.network === networkId
    && catalog.genesisHash.toLowerCase() === deployment.genesisHash.toLowerCase()
    && catalog.serviceId === deployment.serviceId;
}

export async function loadAssetIds(locus: LocusClient): Promise<AssetId[]> {
  return locus.listAssets();
}

export async function loadAssetMetadataForId(
  locus: LocusClient,
  assetId: AssetId,
  catalog: CuratedCatalog | null = null,
  networkId = "local",
  deployment?: DeploymentDescriptor | null,
): Promise<AssetMetadata> {
  const catalogEnabled = !!deployment && catalogMatchesDeployment(catalog, networkId, deployment);
  const curatedById = new Map((catalogEnabled ? catalog.assets : []).map((entry) => [entry.assetId.toLowerCase(), entry]));
  const asset = await locus.getAsset(assetId);
  if (!asset) throw new Error(`asset ${toHex(assetId)} disappeared while loading`);
  const assetIdHex = toHex(assetId).toLowerCase();
  const name = decodeAssetName(asset.name);
  const symbol = decodeAssetSymbol(asset.symbol);
  const issuerKey = toHex(ownershipKey(asset.issuer)).toLowerCase();
  const candidate = curatedById.get(assetIdHex);
  const curated = candidate
    && candidate.name === name
    && candidate.symbol === symbol
    && candidate.decimals === asset.decimals
    && candidate.issuerKey.toLowerCase() === issuerKey
    ? candidate
    : null;
  const presentation: AssetPresentation = curated ? {
    class: curated.class,
    curated: true,
    iconKey: curated.icon,
    badge: curated.class === "crypto" ? "Test asset" : "Demo equity",
    ...(curated.unit ? { unit: curated.unit } : {}),
    disclosure: curated.disclosure,
  } : CUSTOM_PRESENTATION;
  return {
    assetId,
    assetIdHex,
    ...(curated ? { catalogKey: curated.key } : {}),
    issuer: asset.issuer,
    name,
    symbol,
    decimals: asset.decimals,
    totalSupply: asset.totalSupply,
    presentation,
  };
}

export async function loadAssetBalance(locus: LocusClient, assetId: AssetId, owner: Ownership): Promise<bigint> {
  return locus.balanceOf(assetId, owner);
}

export async function loadAssets(
  locus: LocusClient,
  owner: Ownership | null,
  catalog: CuratedCatalog | null = null,
  networkId = "local",
  deployment?: DeploymentDescriptor | null,
): Promise<AssetView[]> {
  const ids = await loadAssetIds(locus);
  return Promise.all(ids.map(async (assetId) => {
    const metadata = await loadAssetMetadataForId(locus, assetId, catalog, networkId, deployment);
    let balance: bigint | null = null;
    if (owner) {
      try { balance = await loadAssetBalance(locus, assetId, owner); } catch { balance = null; }
    }
    return { ...metadata, balance };
  }));
}

export function displayAmount(value: bigint | null, decimals: number): string {
  return formatUnits(value ?? 0n, decimals);
}

export function displayAssetAmount(asset: Pick<AssetView, "balance" | "decimals" | "symbol" | "presentation">, value = asset.balance): string {
  const amount = formatUnits(value ?? 0n, asset.decimals);
  return asset.presentation.unit === "shares" ? `${amount} shares` : `${amount} ${asset.symbol}`;
}
