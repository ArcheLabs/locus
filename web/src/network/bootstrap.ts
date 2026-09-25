import { asWorkRpc, FetchRpcTransport, JamScriptClient } from "@jamscript/client";
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

  const transport = new FetchRpcTransport(network.backendUrl, fetch.bind(globalThis));
  const workRpc = asWorkRpc(transport);
  const protocolClient = Object.assign(
    new JamScriptClient(deployment, transport),
    // JamScript rc.3 exposes finalized context on WorkRpc, but not on
    // JamScriptClient. The bootstrap recovery flow needs the signed action's
    // validity horizon when its transaction mapping is lost after restart.
    { finalizedContext: () => workRpc.finalizedContext() },
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
