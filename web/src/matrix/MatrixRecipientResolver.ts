import { parseLocusId, type Ownership } from "@archelabs/locus";
import { MatrixRecipientRequestError, requestMatrixRecipientOwnership } from "./MatrixRecipientRequest.mjs";
import { MatrixConnectorError, type MatrixErrorCode } from "./MatrixErrors.js";

const requestErrorCodes: Record<MatrixRecipientRequestError["code"], MatrixErrorCode> = {
  RESOLVER_UNCONFIGURED: "MATRIX_RESOLVER_UNCONFIGURED",
  MATRIX_MASTER_KEY_CHANGED: "MATRIX_MASTER_KEY_CHANGED",
  MATRIX_CROSS_SIGNING_UNAVAILABLE: "CROSS_SIGNING_UNAVAILABLE",
  MATRIX_FEDERATION_FAILURE: "MATRIX_FEDERATION_FAILURE",
  MATRIX_HOMESERVER_UNAVAILABLE: "HOMESERVER_UNAVAILABLE",
  MATRIX_RESOLVER_CONFIGURATION_ERROR: "MATRIX_RESOLVER_CONFIGURATION_ERROR",
  MATRIX_QUERY_TIMEOUT: "MATRIX_QUERY_TIMEOUT",
  MATRIX_INVALID_REMOTE_KEY: "CROSS_SIGNING_UNAVAILABLE",
  INVALID_MATRIX_USER_ID: "CROSS_SIGNING_UNAVAILABLE",
  INVALID_REQUEST: "HOMESERVER_UNAVAILABLE",
};

export async function resolveMatrixRecipient(
  userId: string,
  options: { resolverUrl?: string; signal?: AbortSignal } = {},
): Promise<Ownership> {
  try {
    const locusId = await requestMatrixRecipientOwnership(userId, options.resolverUrl, options.signal);
    try {
      return parseLocusId(locusId);
    } catch (cause) {
      throw new MatrixConnectorError("CROSS_SIGNING_UNAVAILABLE", "Matrix recipient resolver returned an invalid Locus Ownership.", { cause });
    }
  } catch (cause) {
    if (cause instanceof MatrixConnectorError) throw cause;
    if (cause instanceof MatrixRecipientRequestError) {
      const code = requestErrorCodes[cause.code];
      throw new MatrixConnectorError(code, cause.message, { cause });
    }
    if (options.signal?.aborted) throw cause;
    throw new MatrixConnectorError("HOMESERVER_UNAVAILABLE", "Unable to reach the Matrix recipient resolver.", { cause });
  }
}
