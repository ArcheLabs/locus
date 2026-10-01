import type { MatrixConnectionState } from "./MatrixConnector.js";

export type MatrixConnectionOrigin = "restore" | "fresh";

export function matrixStateRequiresUserInteraction(state: MatrixConnectionState, _origin: MatrixConnectionOrigin): boolean {
  return state === "TRUST_UNKNOWN" || state === "VERIFICATION_REQUIRED" || state === "VERIFICATION_REQUESTED"
    || state === "VERIFICATION_SAS_READY" || state === "VERIFICATION_CONFIRMING" || state === "RELOGIN_REQUIRED";
}
