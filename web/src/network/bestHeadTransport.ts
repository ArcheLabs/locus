import type { RpcTransport } from "@jamscript/client";
import type { BestContext } from "@archelabs/locus";

export function parseBestContext(value: unknown): BestContext {
  if (!value || typeof value !== "object") throw new Error("Backend returned an invalid best context");
  const context = value as Record<string, unknown>;
  if (context.contextType !== "best"
    || typeof context.blockHash !== "string"
    || !Number.isSafeInteger(context.blockNumber)
    || typeof context.stateRoot !== "string"
    || !Number.isSafeInteger(context.slot)) {
    throw new Error("Backend returned an invalid best context");
  }
  return context as unknown as BestContext;
}

export function bestHeadTransport(transport: RpcTransport): RpcTransport {
  return {
    call<T>(method: string, params?: unknown): Promise<T> {
      // JamScript client RC4 has no best-context API and uses this legacy
      // method for both state queries and Ownership nonce preparation.
      if (method === "minijam_getFinalizedContext") {
        return transport.call<unknown>("minijam_getBestContext", params).then(parseBestContext) as Promise<T>;
      }
      return transport.call<T>(method, params);
    },
  };
}
