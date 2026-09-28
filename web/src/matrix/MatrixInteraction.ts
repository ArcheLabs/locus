import type { MatrixConnectionState } from "./MatrixConnector.js";

export type MatrixConnectionOrigin = "restore" | "fresh";

export function matrixStateRequiresUserInteraction(state: MatrixConnectionState, origin: MatrixConnectionOrigin): boolean {
  if (state === "VERIFICATION_REQUIRED" || state === "VERIFICATION_REQUESTED" || state === "VERIFICATION_SAS_READY") return true;
  if (origin === "fresh" && state === "VERIFICATION_CONFIRMING") return true;
  return state === "CONTROLLER_AUTHORIZATION_UNKNOWN"
    || state === "CONTROLLER_REVOKED"
    || state === "CONTROLLER_AUTHORIZATION_FAILED";
}
