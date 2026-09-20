import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type PropsWithChildren } from "react";
import { bootstrapNetwork } from "./bootstrap.js";
import { defaultNetworkFromEnv, isExplicitSelection, isNetworkId, loadRuntimeNetworkConfig, NETWORK_STORAGE_KEY, readNetworkSelection } from "./config.js";
import { NetworkBootstrapError, type NetworkContextValue, type LocusNetworkId, type NetworkStatus } from "./types.js";

const NetworkContext = createContext<NetworkContextValue | null>(null);

function initialNetwork(): LocusNetworkId {
  return readNetworkSelection() ?? defaultNetworkFromEnv() ?? "local";
}

export function NetworkProvider({ children }: PropsWithChildren) {
  const mode: "demo" | "network" = import.meta.env.VITE_LOCUS_MODE === "network" ? "network" : "demo";
  const [networkId, setNetworkId] = useState<LocusNetworkId>(initialNetwork);
  const [config, setConfig] = useState<NetworkContextValue["config"]>(null);
  const [status, setStatus] = useState<NetworkStatus>(mode === "network" ? "connecting" : "idle");
  const [error, setError] = useState<NetworkBootstrapError | null>(null);
  const [deployment, setDeployment] = useState<NetworkContextValue["deployment"]>(null);
  const [protocolClient, setProtocolClient] = useState<NetworkContextValue["protocolClient"]>(null);
  const [locus, setLocus] = useState<NetworkContextValue["locus"]>(null);
  const [retry, setRetry] = useState(0);
  const generation = useRef(0);

  useEffect(() => {
    if (mode !== "network") return;
    let cancelled = false;
    loadRuntimeNetworkConfig()
      .then((loaded) => {
        if (cancelled) return;
        setConfig(loaded);
        if (!isExplicitSelection() && loaded.defaultNetwork !== networkId) setNetworkId(loaded.defaultNetwork);
      })
      .catch((cause) => {
        if (cancelled) return;
        setStatus("error");
        setError(new NetworkBootstrapError("CONFIG_ERROR", "Network configuration unavailable.", undefined, cause));
      });
    return () => { cancelled = true; };
  }, [mode, retry]);

  useEffect(() => {
    if (mode !== "network" || !config) return;
    const currentGeneration = ++generation.current;
    let cancelled = false;
    const network = config.networks[networkId];
    setStatus("connecting");
    setError(null);
    setDeployment(null);
    setProtocolClient(null);
    setLocus(null);
    if (!network.backendUrl || !network.deploymentUrl) {
      setStatus("unconfigured");
      setError(new NetworkBootstrapError("DEPLOYMENT_UNAVAILABLE", `${network.label} deployment is not configured.`));
      return () => { cancelled = true; };
    }
    bootstrapNetwork(network)
      .then((result) => {
        if (cancelled || generation.current !== currentGeneration) return;
        setDeployment(result.deployment);
        setProtocolClient(result.protocolClient);
        setLocus(result.locus);
        setStatus("ready");
      })
      .catch((cause) => {
        if (cancelled || generation.current !== currentGeneration) return;
        const bootstrapError = cause instanceof NetworkBootstrapError
          ? cause
          : new NetworkBootstrapError("BACKEND_UNAVAILABLE", cause instanceof Error ? cause.message : "Unable to connect to the network.", network.backendUrl ?? undefined, cause);
        setError(bootstrapError);
        setStatus(bootstrapError.category === "DEPLOYMENT_UNAVAILABLE" && !network.backendUrl ? "unconfigured" : "error");
      });
    return () => { cancelled = true; };
  }, [config, mode, networkId, retry]);

  const switchNetwork = useCallback((next: LocusNetworkId) => {
    if (!isNetworkId(next)) return;
    window.localStorage.setItem(NETWORK_STORAGE_KEY, next);
    setNetworkId(next);
    setRetry((value) => value + 1);
  }, []);
  const reconnect = useCallback(() => setRetry((value) => value + 1), []);
  const value = useMemo<NetworkContextValue>(() => ({
    mode,
    networkId,
    config,
    network: config?.networks[networkId] ?? null,
    deployment,
    protocolClient,
    locus,
    status,
    error,
    switchNetwork,
    reconnect,
  }), [config, deployment, error, locus, mode, networkId, protocolClient, reconnect, status, switchNetwork]);

  return <NetworkContext.Provider value={value}>{children}</NetworkContext.Provider>;
}

export function useNetwork(): NetworkContextValue {
  const value = useContext(NetworkContext);
  if (!value) throw new Error("useNetwork must be used inside NetworkProvider");
  return value;
}
