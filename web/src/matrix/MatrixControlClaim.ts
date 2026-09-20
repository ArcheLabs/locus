import { matrixOwnership, type Ownership } from "@archelabs/locus";
import type { MatrixControlClaimBootstrapper } from "@jamscript/client";
import type { MatrixDiscoveredKeys } from "./MatrixKeysQuery.js";
import { MatrixConnectorError } from "./MatrixErrors.js";

export type MatrixControlClaimMaterial = {
  subject: Ownership;
  controller: Ownership;
  proof: Uint8Array;
};

export function buildMatrixControlClaimMaterial(keys: MatrixDiscoveredKeys): MatrixControlClaimMaterial {
  return {
    subject: matrixOwnership(keys.masterPublicKey),
    controller: matrixOwnership(keys.deviceEd25519Key),
    proof: keys.encodedProof.slice(),
  };
}

export async function bootstrapMatrixControlClaim(bootstrapper: MatrixControlClaimBootstrapper | null, material: MatrixControlClaimMaterial): Promise<void> {
  if (!bootstrapper) throw new MatrixConnectorError("CONTROL_CLAIM_FAILED", "The JamScript client has no Matrix ControlClaim bootstrap ingress");
  try {
    await bootstrapper.bootstrap(material.subject, material.controller, material.proof);
  } catch (cause) {
    throw new MatrixConnectorError("CONTROL_CLAIM_FAILED", "Matrix ControlClaim bootstrap was rejected", { cause });
  }
}
