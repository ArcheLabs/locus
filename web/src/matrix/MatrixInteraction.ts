import type { MatrixConnectionState } from "./MatrixConnector.js";

export type MatrixConnectionOrigin = "restore" | "fresh";

export function matrixStateRequiresUserInteraction(state: MatrixConnectionState, _origin: MatrixConnectionOrigin): boolean {
  // Until the existing Locus service accepts the ownership proof, keep the
  // Matrix login surface available for waiting, refreshing, or re-authentication.
  return state !== "READY";
}
