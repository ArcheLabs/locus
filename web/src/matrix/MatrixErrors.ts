export type MatrixErrorCode =
  | "INVALID_LOGIN"
  | "HOMESERVER_UNAVAILABLE"
  | "CROSS_SIGNING_UNAVAILABLE"
  | "DEVICE_NOT_VERIFIED"
  | "DEVICE_KEYS_UPLOAD_FAILED"
  | "CONTROL_CLAIM_FAILED"
  | "UNSUPPORTED_MATRIX_CRYPTO_REQUEST";

export class MatrixConnectorError extends Error {
  constructor(readonly code: MatrixErrorCode, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "MatrixConnectorError";
  }
}
