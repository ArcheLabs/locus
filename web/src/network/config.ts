import { NetworkBootstrapError, type LocusNetworkId, type RuntimeNetworkConfig, type DeploymentDescriptor, type RuntimeNetwork } from "./types.js";
export { selectNetwork } from "./selection.js";

export const NETWORK_STORAGE_KEY = "locus.network.v1";

export function isNetworkId(value: unknown): value is LocusNetworkId {
  return value === "local" || value === "testnet";
}

export function readNetworkSelection(): LocusNetworkId | null {
  if (typeof window === "undefined") return null;
  const query = new URLSearchParams(window.location.search).get("network");
  if (isNetworkId(query)) return query;
  const stored = window.localStorage.getItem(NETWORK_STORAGE_KEY);
  return isNetworkId(stored) ? stored : null;
}

export function defaultNetworkFromEnv(): LocusNetworkId | null {
  const value = import.meta.env.VITE_LOCUS_DEFAULT_NETWORK;
  return isNetworkId(value) ? value : null;
}

function asRuntimeConfig(value: unknown): RuntimeNetworkConfig {
  if (!value || typeof value !== "object") throw new Error("network config must be an object");
  const record = value as Record<string, unknown>;
  if (record.version !== 1 || !isNetworkId(record.defaultNetwork)) throw new Error("unsupported network config");
  if (!record.networks || typeof record.networks !== "object") throw new Error("network config has no networks");
  const networks = record.networks as Record<string, unknown>;
  const result = {} as RuntimeNetworkConfig["networks"];
  for (const id of ["local", "testnet"] as const) {
    const entry = networks[id];
    if (!entry || typeof entry !== "object") throw new Error(`network config is missing ${id}`);
    const candidate = entry as Record<string, unknown>;
    if (typeof candidate.label !== "string") throw new Error(`${id} label is invalid`);
    if (candidate.backendUrl !== null && typeof candidate.backendUrl !== "string") throw new Error(`${id} backendUrl is invalid`);
    if (candidate.deploymentUrl !== null && typeof candidate.deploymentUrl !== "string") throw new Error(`${id} deploymentUrl is invalid`);
    result[id] = {
      label: candidate.label,
      backendUrl: candidate.backendUrl as string | null,
      deploymentUrl: candidate.deploymentUrl as string | null,
    };
  }
  return { version: 1, defaultNetwork: record.defaultNetwork, networks: result };
}

export async function loadRuntimeNetworkConfig(fetchImpl: typeof fetch = fetch): Promise<RuntimeNetworkConfig> {
  let response: Response;
  try {
    response = await fetchImpl("/locus-networks.json", { cache: "no-store" });
  } catch (error) {
    throw new Error("Network configuration unavailable.", { cause: error });
  }
  if (!response.ok) throw new Error(`Network configuration returned HTTP ${response.status}`);
  return asRuntimeConfig(await response.json());
}

function asDeployment(value: unknown): DeploymentDescriptor {
  if (!value || typeof value !== "object") throw new Error("deployment descriptor must be an object");
  const record = value as Record<string, unknown>;
  for (const field of ["genesisHash", "networkDomain", "serviceKey", "codeHash", "abi"]) {
    if (!(field in record)) throw new Error(`deployment descriptor is missing ${field}`);
  }
  if (typeof record.serviceId !== "number" || !Number.isInteger(record.serviceId)) throw new Error("deployment serviceId is invalid");
  if (record.abiVersion !== 1) throw new Error("unsupported deployment ABI version");
  return record as unknown as DeploymentDescriptor;
}

export async function loadDeploymentDescriptor(
  network: RuntimeNetwork,
  fetchImpl: typeof fetch = fetch,
): Promise<DeploymentDescriptor> {
  if (!network.deploymentUrl) throw new Error("This network is not configured yet.");
  let response: Response;
  try {
    response = await fetchImpl(network.deploymentUrl, { cache: "no-store" });
  } catch (error) {
    throw new Error("Deployment descriptor is unavailable.", { cause: error });
  }
  if (response.status === 404) throw new Error("This network is not configured yet.");
  if (!response.ok) throw new Error(`Deployment descriptor returned HTTP ${response.status}`);
  return asDeployment(await response.json());
}

export function isExplicitSelection(): boolean {
  return readNetworkSelection() !== null || defaultNetworkFromEnv() !== null;
}

export function classifyBootstrapError(error: unknown, network: RuntimeNetwork): NetworkBootstrapError {
  const message = error instanceof Error ? error.message : "Unknown network error";
  if (message.includes("not configured")) return new NetworkBootstrapError("DEPLOYMENT_UNAVAILABLE", message);
  if (message.includes("Deployment descriptor")) return new NetworkBootstrapError("DEPLOYMENT_UNAVAILABLE", message, network.deploymentUrl ?? undefined);
  if (message.includes("Network configuration")) return new NetworkBootstrapError("CONFIG_ERROR", message);
  return new NetworkBootstrapError("UNKNOWN", message, network.backendUrl ?? undefined, error);
}
