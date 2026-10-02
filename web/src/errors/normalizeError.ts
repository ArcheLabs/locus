import { normalizeLocusError } from "@archelabs/locus";
import { LOCUS_ERROR_MESSAGES } from "./locusErrorMessages.js";

export function isWalletCancellation(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const candidate = error as { code?: unknown; name?: unknown; message?: unknown };
  return candidate.code === 4001
    || candidate.name === "UserRejectedRequestError"
    || (typeof candidate.message === "string" && /user rejected|request rejected|cancelled by user/i.test(candidate.message));
}

export function normalizeActionError(error: unknown, fallback = "The action could not be completed."): string {
  if (isWalletCancellation(error)) return "Request cancelled.";
  const backendMessage = knownBackendErrorMessage(error);
  if (backendMessage) return backendMessage;
  const normalized = normalizeLocusError(error);
  if (normalized?.code !== undefined && LOCUS_ERROR_MESSAGES[normalized.code]) return LOCUS_ERROR_MESSAGES[normalized.code]!;
  return error instanceof Error ? error.message : fallback;
}

export function knownActionErrorMessage(error: unknown): string | null {
  if (isWalletCancellation(error)) return "Request cancelled.";
  const backendMessage = knownBackendErrorMessage(error);
  if (backendMessage) return backendMessage;
  const normalized = normalizeLocusError(error);
  return normalized?.code === undefined ? null : LOCUS_ERROR_MESSAGES[normalized.code] ?? null;
}

function knownBackendErrorMessage(error: unknown): string | null {
  const message = error && typeof error === "object" && "message" in error
    ? String((error as { message?: unknown }).message ?? "")
    : "";
  if (message.includes("QUEUE_FULL")) return "The transaction queue is full. Wait briefly, then check transaction status before trying again.";
  if (message.includes("OWNERSHIP_NONCE_RECONCILIATION_REQUIRED")) return "An earlier Ownership transaction has an unresolved result. Check its status before signing another action.";
  if (message.includes("BEST_CONTEXT_UNAVAILABLE")) return "The current best-chain snapshot is unavailable. Retry when the network connection is healthy.";
  if (message.includes("STATE_ROOT_UNAVAILABLE")) return "State for this chain snapshot is unavailable. Refresh the view and check pending transactions.";
  if (message.includes("STALE_CONTEXT")) return "The chain changed while this action was prepared. Refresh the state and check transaction status before retrying.";
  if (message.includes("TRANSACTION_REORGED")) return "This transaction was removed from the best chain. Check its status before retrying.";
  return null;
}
