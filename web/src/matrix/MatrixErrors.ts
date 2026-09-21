export type MatrixErrorCode =
  | "INVALID_LOGIN"
  | "HOMESERVER_UNAVAILABLE"
  | "CROSS_SIGNING_UNAVAILABLE"
  | "DEVICE_NOT_VERIFIED"
  | "DEVICE_KEYS_UPLOAD_FAILED"
  | "TOKEN_REFRESH_FAILED"
  | "CONTROL_CLAIM_FAILED"
  | "UNSUPPORTED_MATRIX_CRYPTO_REQUEST";

export class MatrixConnectorError extends Error {
  readonly code: MatrixErrorCode;

  constructor(code: MatrixErrorCode, message: string, options?: ErrorOptions) {
    super(message, options);
    this.code = code;
    this.name = "MatrixConnectorError";
  }
}
