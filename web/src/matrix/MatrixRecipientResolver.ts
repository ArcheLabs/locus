import { parseLocusId, type Ownership } from "@archelabs/locus";
import { discoverHomeserver } from "./MatrixConnector.js";
import { resolveMatrixMasterOwnership } from "./MatrixKeysQuery.js";
import { MatrixConnectorError } from "./MatrixErrors.js";

/** Resolve a Matrix ID through the authenticated resolver service, never anonymously. */
export async function resolveMatrixRecipient(userId: string, options: { resolverUrl?: string; accessToken?: string } = {}): Promise<Ownership> {
  if (!options.resolverUrl) throw new MatrixConnectorError("HOMESERVER_UNAVAILABLE", "Matrix recipient resolver is not configured for this network");
  let response: Response;
  try {
    response = await fetch(`${options.resolverUrl.replace(/\/$/, "")}/v1/resolve`, {
      method: "POST",
      headers: { "content-type": "application/json", ...(options.accessToken ? { authorization: `Bearer ${options.accessToken}` } : {}) },
      body: JSON.stringify({ userId }),
    });
  } catch (cause) {
    throw new MatrixConnectorError("HOMESERVER_UNAVAILABLE", "Unable to reach the Matrix recipient resolver", { cause });
  }
  const text = await response.text();
  let payload: unknown;
  try { payload = text ? JSON.parse(text) : {}; } catch (cause) {
    throw new MatrixConnectorError("HOMESERVER_UNAVAILABLE", "Matrix recipient resolver returned invalid JSON", { cause });
  }
  if (!response.ok) {
    const error = payload && typeof payload === "object" && "error" in payload ? String((payload as { error?: unknown }).error) : `HTTP ${response.status}`;
    throw new MatrixConnectorError("HOMESERVER_UNAVAILABLE", `Matrix recipient resolver failed: ${error}`);
  }
  if (!payload || typeof payload !== "object" || typeof (payload as { ownership?: unknown }).ownership !== "string") {
    throw new MatrixConnectorError("CROSS_SIGNING_UNAVAILABLE", "Matrix recipient resolver did not return a canonical Ownership");
  }
  try {
    return parseLocusId((payload as { ownership: string }).ownership);
  } catch (cause) {
    throw new MatrixConnectorError("CROSS_SIGNING_UNAVAILABLE", "Matrix recipient resolver returned an invalid Ownership", { cause });
  }
}

/** Authenticated direct lookup for the logged-in Matrix account only. */
export async function resolveAuthenticatedMatrixRecipient(userId: string, homeserver?: string, accessToken?: string): Promise<Ownership> {
  const resolvedHomeserver = await discoverHomeserver(userId, homeserver);
  return resolveMatrixMasterOwnership(userId, resolvedHomeserver, accessToken);
}
