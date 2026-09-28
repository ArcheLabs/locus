export type MatrixRecipientResolverErrorCode =
  | "RESOLVER_UNCONFIGURED"
  | "MATRIX_MASTER_KEY_CHANGED"
  | "MATRIX_CROSS_SIGNING_UNAVAILABLE"
  | "MATRIX_FEDERATION_FAILURE"
  | "MATRIX_HOMESERVER_UNAVAILABLE"
  | "MATRIX_RESOLVER_CONFIGURATION_ERROR"
  | "MATRIX_QUERY_TIMEOUT"
  | "MATRIX_INVALID_REMOTE_KEY"
  | "INVALID_MATRIX_USER_ID"
  | "INVALID_REQUEST";

export class MatrixRecipientRequestError extends Error {
  code: MatrixRecipientResolverErrorCode;
}

export function requestMatrixRecipientOwnership(
  userId: string,
  resolverUrl: string | undefined,
  signal?: AbortSignal,
  fetchImpl?: typeof fetch,
): Promise<string>;
