import { normalizeLocusError } from "@archelabs/locus";
import { LOCUS_ERROR_MESSAGES } from "./locusErrorMessages.js";
import { knownBackendErrorMessage } from "./backendExecutionError.js";

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
