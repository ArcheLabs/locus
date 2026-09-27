export type MatrixErrorCode =
  | "INVALID_LOGIN"
  | "HOMESERVER_UNAVAILABLE"
  | "CROSS_SIGNING_UNAVAILABLE"
  | "MATRIX_RESOLVER_UNCONFIGURED"
  | "MATRIX_MASTER_KEY_CHANGED"
  | "MATRIX_FEDERATION_FAILURE"
  | "MATRIX_QUERY_TIMEOUT"
  | "MATRIX_RESOLVER_CONFIGURATION_ERROR"
  | "DEVICE_NOT_VERIFIED"
  | "STALE_MATRIX_DEVICE"
  | "MATRIX_VERIFICATION_FAILED"
  | "CRYPTO_WASM_INIT_FAILED"
  | "CRYPTO_STORE_INIT_FAILED"
  | "CRYPTO_OUTGOING_REQUEST_FAILED"
  | "DEVICE_KEYS_UPLOAD_FAILED"
  | "CRYPTO_REQUEST_ACK_FAILED"
  | "TOKEN_REFRESH_FAILED"
  | "OAUTH_FAILED"
  | "CONTROLLER_NOT_AUTHORIZED"
  | "CONTROLLER_REVOKED"
  | "UNSUPPORTED_MATRIX_CRYPTO_REQUEST";

export class MatrixConnectorError extends Error {
  readonly code: MatrixErrorCode;

  constructor(code: MatrixErrorCode, message: string, options?: ErrorOptions) {
    super(message, options);
    this.code = code;
    this.name = "MatrixConnectorError";
  }
}

/** Keep diagnostics useful without showing credentials or OAuth secrets in the UI. */
export function describeMatrixCause(cause: unknown): string {
  let message: string;
  if (cause instanceof Error) message = cause.message || cause.name;
  else if (typeof cause === "string") message = cause;
  else if (cause && typeof cause === "object") {
    const candidate = cause as { name?: unknown; message?: unknown; errcode?: unknown; error?: unknown };
    const parts = [candidate.name, candidate.message, candidate.errcode, candidate.error]
      .filter((part): part is string => typeof part === "string" && part.length > 0);
    message = parts.join(": ") || "Unknown Matrix error";
  } else message = String(cause ?? "Unknown Matrix error");

  return message
    .replace(/\bBearer\s+[^\s,;]+/gi, "Bearer [redacted]")
    .replace(/((?:access|refresh)[_-]?token|password|code[_-]?verifier|login[_-]?token|authorization)\s*([=:])\s*[^\s&,;]+/gi, "$1$2[redacted]")
    .replace(/([?#&](?:code|token|access_token|refresh_token|loginToken|code_verifier)=)[^&#\s]+/gi, "$1[redacted]")
    .slice(0, 360);
}

export function matrixCryptoStageFailure(code: MatrixErrorCode, message: string, cause: unknown): MatrixConnectorError {
  if (cause instanceof MatrixConnectorError && cause.code === code) return cause;
  return new MatrixConnectorError(code, `${message} ${describeMatrixCause(cause)}`, { cause });
}

export function matrixControllerReceiptFailure(errorCode: number | null | undefined, proofDetails = ""): MatrixConnectorError {
  const code = typeof errorCode === "number" && Number.isInteger(errorCode) && errorCode >= 0
    ? errorCode >>> 0
    : null;
  if (code !== null && code >= 0x8000_0000) {
    const runtimeClass = code === 0x8000_0001 ? "FATAL_UNCAUGHT" : "JAMSCRIPT_RUNTIME_FATAL";
    const hex = `0x${code.toString(16).padStart(8, "0")}`;
    return new MatrixConnectorError(
      "CONTROLLER_NOT_AUTHORIZED",
      `Internal JamScript runtime error during Matrix controller authorization (${runtimeClass}, ${hex}).`,
    );
  }
  if (code === 5003) {
    return new MatrixConnectorError(
      "CONTROLLER_REVOKED",
      "This Locus Matrix controller was previously revoked. Sign in as a new Matrix device or use another active controller.",
    );
  }
  return new MatrixConnectorError(
    "CONTROLLER_NOT_AUTHORIZED",
    `Locus rejected the Matrix controller authorization (application error code ${code ?? "none"}). ${proofDetails}`,
  );
}
