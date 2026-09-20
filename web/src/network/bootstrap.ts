import { FetchRpcTransport, JamScriptClient } from "@jamscript/client";
import { LocusClient } from "@archelabs/locus";
import { loadDeploymentDescriptor } from "./config.js";
import { NetworkBootstrapError, type RuntimeNetwork } from "./types.js";

export async function bootstrapNetwork(
  network: RuntimeNetwork,
  fetchImpl: typeof fetch = fetch,
): Promise<{ deployment: NonNullable<Awaited<ReturnType<typeof loadDeploymentDescriptor>>>; protocolClient: JamScriptClient; locus: LocusClient }> {
  if (!network.backendUrl) {
    throw new NetworkBootstrapError("DEPLOYMENT_UNAVAILABLE", "This network is not configured yet.");
  }
  let deployment;
  try {
    deployment = await loadDeploymentDescriptor(network, fetchImpl);
  } catch (error) {
    throw new NetworkBootstrapError(
      "DEPLOYMENT_UNAVAILABLE",
      error instanceof Error ? error.message : "Deployment descriptor is unavailable.",
      network.deploymentUrl ?? undefined,
      error,
    );
  }

  const protocolClient = new JamScriptClient(
    deployment,
    new FetchRpcTransport(network.backendUrl, fetch.bind(globalThis)),
  );
  try {
    await protocolClient.validateDeployment();
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    const deploymentMismatch = message === "deployment genesis hash does not match the chain";
    const backendUnavailable = !deploymentMismatch;
    throw new NetworkBootstrapError(
      backendUnavailable ? "BACKEND_UNAVAILABLE" : "DEPLOYMENT_MISMATCH",
      backendUnavailable
        ? `Backend RPC validation failed${message ? `: ${message}` : "."}`
        : "The backend deployment does not match this network descriptor.",
      network.backendUrl,
      error,
    );
  }
  return { deployment, protocolClient, locus: new LocusClient(protocolClient) };
}
