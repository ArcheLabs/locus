import type { DeploymentDescriptor as JamDeployment, JamScriptClient } from "@jamscript/client";
import type { LocusClient } from "@archelabs/locus";

export type LocusNetworkId = "local" | "testnet";
export type NetworkStatus = "idle" | "connecting" | "ready" | "error" | "unconfigured";
export type NetworkErrorCategory =
  | "CONFIG_ERROR"
  | "BACKEND_UNAVAILABLE"
  | "DEPLOYMENT_UNAVAILABLE"
  | "DEPLOYMENT_MISMATCH"
  | "UNKNOWN";

export type RuntimeNetwork = {
  label: string;
  backendUrl: string | null;
  deploymentUrl: string | null;
  matrixResolverUrl?: string;
};

export type RuntimeNetworkConfig = {
  version: 1;
  defaultNetwork: LocusNetworkId;
  networks: Record<LocusNetworkId, RuntimeNetwork>;
};

export type DeploymentDescriptor = JamDeployment;

export class NetworkBootstrapError extends Error {
  readonly category: NetworkErrorCategory;
  readonly endpoint?: string;

  constructor(category: NetworkErrorCategory, message: string, endpoint?: string, cause?: unknown) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = "NetworkBootstrapError";
    this.category = category;
    this.endpoint = endpoint;
  }
}

export type NetworkContextValue = {
  mode: "demo" | "network";
  networkId: LocusNetworkId;
  config: RuntimeNetworkConfig | null;
  network: RuntimeNetwork | null;
  deployment: DeploymentDescriptor | null;
  protocolClient: JamScriptClient | null;
  locus: LocusClient | null;
  status: NetworkStatus;
  error: NetworkBootstrapError | null;
  switchNetwork: (networkId: LocusNetworkId) => void;
  reconnect: () => void;
};
