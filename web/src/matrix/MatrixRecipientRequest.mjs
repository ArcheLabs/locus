const resolverMessages = Object.freeze({
  RESOLVER_UNCONFIGURED: "Matrix recipient resolution is not configured for this network.",
  MATRIX_MASTER_KEY_CHANGED: "This Matrix account's master key has changed. Verify the recipient through a trusted channel before sending.",
  MATRIX_CROSS_SIGNING_UNAVAILABLE: "This Matrix account has no available cross-signing master key.",
  MATRIX_FEDERATION_FAILURE: "The remote Matrix homeserver could not provide this account's keys.",
  MATRIX_HOMESERVER_UNAVAILABLE: "The Matrix recipient resolver is temporarily unavailable.",
  MATRIX_RESOLVER_CONFIGURATION_ERROR: "The Matrix recipient resolver is not ready.",
  MATRIX_QUERY_TIMEOUT: "The remote Matrix key query timed out. Try again.",
  MATRIX_INVALID_REMOTE_KEY: "The remote Matrix homeserver returned an invalid master key.",
  INVALID_MATRIX_USER_ID: "Enter a valid Matrix user ID.",
  INVALID_REQUEST: "The Matrix recipient request was rejected.",
});

export class MatrixRecipientRequestError extends Error {
  constructor(code, message = resolverMessages[code] ?? resolverMessages.MATRIX_HOMESERVER_UNAVAILABLE, options) {
    super(message, options);
    this.name = "MatrixRecipientRequestError";
    this.code = code;
  }
}

function normalizedResolverError(status, payload) {
  if (status === 409) return "MATRIX_MASTER_KEY_CHANGED";
  if (status === 404) return "MATRIX_CROSS_SIGNING_UNAVAILABLE";
  if (status === 502) {
    return payload?.error === "MATRIX_INVALID_REMOTE_KEY" ? "MATRIX_INVALID_REMOTE_KEY" : "MATRIX_FEDERATION_FAILURE";
  }
  if (status === 503) return "MATRIX_RESOLVER_CONFIGURATION_ERROR";
  if (status === 504) return "MATRIX_QUERY_TIMEOUT";
  return "MATRIX_HOMESERVER_UNAVAILABLE";
}

/** Browser-side transport has no credential parameter and sends only the MXID. */
export async function requestMatrixRecipientOwnership(userId, resolverUrl, signal, fetchImpl = fetch) {
  if (typeof resolverUrl !== "string" || resolverUrl.trim() === "") {
    throw new MatrixRecipientRequestError("RESOLVER_UNCONFIGURED");
  }
  const url = `${resolverUrl.replace(/\/$/, "")}/v1/resolve`;
  let response;
  try {
    response = await fetchImpl(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ userId }),
      credentials: "omit",
      mode: "same-origin",
      redirect: "error",
      ...(signal ? { signal } : {}),
    });
  } catch (cause) {
    if (signal?.aborted) throw cause;
    throw new MatrixRecipientRequestError("MATRIX_HOMESERVER_UNAVAILABLE", undefined, { cause });
  }

  let payload;
  try {
    payload = await response.json();
  } catch (cause) {
    throw new MatrixRecipientRequestError("MATRIX_HOMESERVER_UNAVAILABLE", undefined, { cause });
  }
  if (!response.ok) {
    const code = normalizedResolverError(response.status, payload);
    throw new MatrixRecipientRequestError(code);
  }
  if (!payload || typeof payload !== "object" || typeof payload.ownership !== "string") {
    throw new MatrixRecipientRequestError("MATRIX_HOMESERVER_UNAVAILABLE");
  }
  return payload.ownership;
}
