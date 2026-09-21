import { matrixOwnership, type Ownership } from "@archelabs/locus";
import type { MatrixDiscoveredKeys } from "./MatrixKeysQuery.js";
import { MatrixConnectorError } from "./MatrixErrors.js";

export type MatrixIdentityBootstrapMaterial = {
  subject: Ownership;
  proof: Uint8Array;
};

/**
 * Build the M→S→D cryptographic evidence that Locus submits as its
 * local identity bootstrap action. The controller is authenticated by the
 * outer SignedActionV2 and is therefore intentionally not duplicated here.
 */
export function buildMatrixIdentityBootstrapMaterial(keys: MatrixDiscoveredKeys): MatrixIdentityBootstrapMaterial {
  if (!keys.encodedProof) {
    throw new MatrixConnectorError("DEVICE_NOT_VERIFIED", "Verify this Matrix device before creating identity bootstrap material");
  }
  return {
    subject: matrixOwnership(keys.masterPublicKey),
    proof: keys.encodedProof.slice(),
  };
}
