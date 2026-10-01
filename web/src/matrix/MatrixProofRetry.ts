import { MatrixConnectorError } from "./MatrixErrors.ts";

export type MatrixProofFailureClass = "PENDING" | "INVALID" | "SESSION_INVALID" | "RELOGIN_REQUIRED";

export function classifyMatrixProofFailure(cause: unknown): MatrixProofFailureClass {
  if (!(cause instanceof MatrixConnectorError)) return "PENDING";
  if (cause.code === "OWNERSHIP_PROOF_INVALID") return "INVALID";
  if (cause.code === "MATRIX_SESSION_INVALID") return "SESSION_INVALID";
  if (cause.code === "MATRIX_IDENTITY_CHANGED" || cause.code === "MATRIX_DEVICE_REVOKED") {
    return "RELOGIN_REQUIRED";
  }
  return "PENDING";
}

export const MATRIX_PROOF_RETRY_DELAYS_MS = [750, 1_750] as const;
export const MATRIX_PROOF_MAX_RETRY_AFTER_MS = 30_000;

export type MatrixProofRetryOptions = {
  delaysMs?: readonly number[];
  maxRetryAfterMs?: number;
  sleep?: (delayMs: number) => Promise<void>;
};

/** Retry only pre-submission proof reads; never resubmit an ambiguous action. */
export async function retryMatrixProofPreparation<T>(
  prepare: () => Promise<T>,
  options: MatrixProofRetryOptions = {},
): Promise<T> {
  const delays = options.delaysMs ?? MATRIX_PROOF_RETRY_DELAYS_MS;
  const maxRetryAfterMs = options.maxRetryAfterMs ?? MATRIX_PROOF_MAX_RETRY_AFTER_MS;
  const sleep = options.sleep ?? ((delayMs) => new Promise<void>((resolve) => globalThis.setTimeout(resolve, delayMs)));
  let retryIndex = 0;
  for (;;) {
    try { return await prepare(); }
    catch (cause) {
      if (classifyMatrixProofFailure(cause) !== "PENDING" || retryIndex >= delays.length) throw cause;
      const retryAfter = cause instanceof MatrixConnectorError ? cause.retryAfterMs : undefined;
      const delay = retryAfter ?? delays[retryIndex];
      if (!Number.isFinite(delay) || delay < 0 || delay > maxRetryAfterMs) throw cause;
      retryIndex += 1;
      await sleep(delay);
    }
  }
}

export function missingMatrixProof(): MatrixConnectorError {
  return new MatrixConnectorError("OWNERSHIP_PROOF_PENDING", "Matrix proof is not available yet. Waiting for cross-signing keys to sync.");
}
