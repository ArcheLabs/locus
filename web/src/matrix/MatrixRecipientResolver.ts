import type { Ownership } from "@archelabs/locus";
import { discoverHomeserver } from "./MatrixConnector.js";
import { resolveMatrixMasterOwnership } from "./MatrixKeysQuery.js";

/** Resolve a Matrix ID through its homeserver master key, never a device key. */
export async function resolveMatrixRecipient(userId: string, homeserver?: string): Promise<Ownership> {
  const resolvedHomeserver = await discoverHomeserver(userId, homeserver);
  return resolveMatrixMasterOwnership(userId, resolvedHomeserver);
}
