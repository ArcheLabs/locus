type StructuredExecutionError = {
  code: string;
  message: string;
  submissionState?: "not_submitted";
  details?: Record<string, unknown>;
};

function structuredExecutionError(error: unknown): StructuredExecutionError | null {
  if (!error || typeof error !== "object") return null;
  const candidate = error as {
    structuredError?: unknown;
    errorInfo?: unknown;
    lastStatus?: { errorInfo?: unknown };
  };
  for (const value of [candidate.structuredError, candidate.errorInfo, candidate.lastStatus?.errorInfo]) {
    if (!value || typeof value !== "object") continue;
    const record = value as Record<string, unknown>;
    if (typeof record.code !== "string" || typeof record.message !== "string") continue;
    return {
      code: record.code,
      message: record.message,
      ...(record.submissionState === "not_submitted" ? { submissionState: "not_submitted" as const } : {}),
      ...(record.details && typeof record.details === "object" && !Array.isArray(record.details)
        ? { details: record.details as Record<string, unknown> }
        : {}),
    };
  }
  return null;
}

function nonNegativeSafeInteger(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null;
}

function byteCount(value: number): string {
  if (value > 0 && value % (1024 * 1024) === 0) return `${value / (1024 * 1024)} MiB`;
  if (value > 0 && value % 1024 === 0) return `${value / 1024} KiB`;
  return `${value} bytes`;
}

export function knownBackendErrorMessage(error: unknown): string | null {
  const structured = structuredExecutionError(error);
  if (structured) {
    const request = nonNegativeSafeInteger(structured.details?.requestedBytes);
    const limit = nonNegativeSafeInteger(structured.details?.heapMaxBytes);
    const budgetDetails = [
      ...(request !== null ? [`${byteCount(request)} requested`] : []),
      ...(limit !== null ? [`${byteCount(limit)} limit`] : []),
    ];
    const budget = budgetDetails.length > 0 ? ` (${budgetDetails.join("; ")})` : "";
    const notSubmitted = structured.submissionState === "not_submitted";
    switch (structured.code) {
      case "GUEST_HEAP_LIMIT_EXCEEDED":
        return notSubmitted
          ? `This action exceeded the Service guest memory budget${budget}. It was not submitted; reduce the action size and try again.`
          : `The Service hit its guest memory budget${budget}. Check transaction status before retrying.`;
      case "GUEST_MEMORY_GROW_FAILED":
        return notSubmitted
          ? "The Service could not grow guest memory. This action was not submitted."
          : "The Service could not grow guest memory. Check transaction status before retrying.";
      case "GUEST_MEMORY_ALLOCATION_FAILED":
        return notSubmitted
          ? "The Service could not allocate guest memory. This action was not submitted."
          : "The Service could not allocate guest memory. Check transaction status before retrying.";
      case "PVM_OUT_OF_GAS":
        return notSubmitted
          ? "The Service execution exceeded its gas budget. This action was not submitted."
          : "The Service execution exceeded its gas budget. Check transaction status before retrying.";
      default:
        break;
    }
  }
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
