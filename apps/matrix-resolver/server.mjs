import { createServer } from "node:http";
import { realpathSync } from "node:fs";
import { chmod, mkdir, open, readFile, rename, rm, stat } from "node:fs/promises";
import { dirname } from "node:path";
import { pathToFileURL } from "node:url";
import { formatLocusId, matrixOwnership } from "../../sdk/src/ownership.ts";

export const TUWUNEL_ORIGIN = "http://127.0.0.1:8008";
const KEYS_QUERY_URL = `${TUWUNEL_ORIGIN}/_matrix/client/v3/keys/query`;
const VERSIONS_URL = `${TUWUNEL_ORIGIN}/_matrix/client/versions`;
const MAX_REQUEST_BYTES = 4096;
const MATRIX_QUERY_TIMEOUT_MS = 10_000;
const HTTP_TIMEOUT_MS = 15_000;
const MATRIX_USER_ID = /^@[^:\s/]+:(?:\[[0-9a-fA-F:.]+\]|[A-Za-z0-9.-]+)(?::([0-9]{1,5}))?$/;
let temporaryFileCounter = 0;

const ERROR_STATUS = Object.freeze({
  INVALID_MATRIX_USER_ID: 400,
  INVALID_REQUEST: 400,
  INVALID_JSON: 400,
  REQUEST_TOO_LARGE: 413,
  MATRIX_CROSS_SIGNING_UNAVAILABLE: 404,
  MATRIX_MASTER_KEY_CHANGED: 409,
  MATRIX_FEDERATION_FAILURE: 502,
  MATRIX_INVALID_REMOTE_KEY: 502,
  MATRIX_HOMESERVER_UNAVAILABLE: 503,
  MATRIX_RESOLVER_CONFIGURATION_ERROR: 503,
  MATRIX_QUERY_TIMEOUT: 504,
});

export class ResolverError extends Error {
  constructor(code, options) {
    super(code, options);
    this.name = "ResolverError";
    this.code = code;
  }
}

function resolverError(code, cause) {
  return new ResolverError(code, cause === undefined ? undefined : { cause });
}

export function isValidMatrixUserId(userId) {
  if (typeof userId !== "string") return false;
  const match = MATRIX_USER_ID.exec(userId);
  if (!match) return false;
  if (match[1] !== undefined) {
    const port = Number(match[1]);
    if (!Number.isInteger(port) || port < 1 || port > 65535) return false;
  }
  return true;
}

function decodeMatrixBase64(value) {
  if (typeof value !== "string" || !/^[A-Za-z0-9+/]{43}$/.test(value)) {
    throw resolverError("MATRIX_INVALID_REMOTE_KEY");
  }
  const bytes = Buffer.from(value, "base64");
  if (bytes.length !== 32 || bytes.toString("base64").replace(/=+$/, "") !== value) {
    throw resolverError("MATRIX_INVALID_REMOTE_KEY");
  }
  return Uint8Array.from(bytes);
}

/** Validate the exact Matrix CrossSigningKey contract before encoding Ownership. */
export function validateMatrixMasterKey(requestedUserId, masterKeyObject) {
  if (!isValidMatrixUserId(requestedUserId)) throw resolverError("INVALID_MATRIX_USER_ID");
  if (!masterKeyObject || typeof masterKeyObject !== "object" || Array.isArray(masterKeyObject)) {
    throw resolverError("MATRIX_CROSS_SIGNING_UNAVAILABLE");
  }
  if (masterKeyObject.user_id !== requestedUserId) throw resolverError("MATRIX_INVALID_REMOTE_KEY");
  if (!Array.isArray(masterKeyObject.usage)
      || masterKeyObject.usage.length !== 1
      || masterKeyObject.usage[0] !== "master") {
    throw resolverError("MATRIX_INVALID_REMOTE_KEY");
  }
  const keys = masterKeyObject.keys;
  if (!keys || typeof keys !== "object" || Array.isArray(keys)) throw resolverError("MATRIX_INVALID_REMOTE_KEY");
  const entries = Object.entries(keys);
  if (entries.length !== 1) throw resolverError("MATRIX_INVALID_REMOTE_KEY");
  const [[keyId, value]] = entries;
  if (typeof value !== "string" || !keyId.startsWith("ed25519:") || keyId.slice("ed25519:".length) !== value) {
    throw resolverError("MATRIX_INVALID_REMOTE_KEY");
  }
  // Matrix master-key signatures are optional. Do not inspect or require signatures here.
  return decodeMatrixBase64(value);
}

function validateConfiguredHomeserver(value) {
  if (value !== TUWUNEL_ORIGIN) throw resolverError("MATRIX_RESOLVER_CONFIGURATION_ERROR");
}

function timeoutSignal(milliseconds) {
  return AbortSignal.timeout(milliseconds);
}

function errorIsTimeout(error) {
  return error?.name === "TimeoutError" || error?.name === "AbortError";
}

async function requestTuwunel(userId, asToken, fetchImpl) {
  let response;
  try {
    response = await fetchImpl(KEYS_QUERY_URL, {
      method: "POST",
      headers: {
        authorization: `Bearer ${asToken}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ device_keys: { [userId]: [] }, timeout: MATRIX_QUERY_TIMEOUT_MS }),
      signal: timeoutSignal(HTTP_TIMEOUT_MS),
      redirect: "error",
    });
  } catch (error) {
    if (error instanceof ResolverError) throw error;
    throw resolverError(errorIsTimeout(error) ? "MATRIX_QUERY_TIMEOUT" : "MATRIX_HOMESERVER_UNAVAILABLE", error);
  }

  if (response.redirected || (response.status >= 300 && response.status < 400)) {
    throw resolverError("MATRIX_HOMESERVER_UNAVAILABLE");
  }
  if (response.status === 401 || response.status === 403 || response.status === 404) {
    throw resolverError("MATRIX_RESOLVER_CONFIGURATION_ERROR");
  }
  if (!response.ok) {
    throw resolverError(response.status >= 500 ? "MATRIX_FEDERATION_FAILURE" : "MATRIX_HOMESERVER_UNAVAILABLE");
  }

  let payload;
  try {
    payload = await response.json();
  } catch (error) {
    throw resolverError("MATRIX_HOMESERVER_UNAVAILABLE", error);
  }
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw resolverError("MATRIX_HOMESERVER_UNAVAILABLE");
  }
  if (payload.failures && typeof payload.failures === "object" && Object.keys(payload.failures).length > 0) {
    throw resolverError("MATRIX_FEDERATION_FAILURE");
  }
  const master = payload.master_keys?.[userId];
  if (!master) throw resolverError("MATRIX_CROSS_SIGNING_UNAVAILABLE");
  return validateMatrixMasterKey(userId, master);
}

/** Query only the fixed local Tuwunel; the MXID is data, never a URL. */
export async function resolveMasterOwnership(userId, { asToken, fetchImpl = fetch } = {}) {
  if (!isValidMatrixUserId(userId)) throw resolverError("INVALID_MATRIX_USER_ID");
  if (typeof asToken !== "string" || asToken.length < 32 || /\s/.test(asToken)) {
    throw resolverError("MATRIX_RESOLVER_CONFIGURATION_ERROR");
  }
  const masterKey = await requestTuwunel(userId, asToken, fetchImpl);
  const owner = matrixOwnership(masterKey);
  return {
    userId,
    ownership: formatLocusId(owner),
    masterKey: Buffer.from(masterKey).toString("base64url"),
  };
}

async function readState(path) {
  try {
    const metadata = await stat(path);
    if (!metadata.isFile() || (metadata.mode & 0o077) !== 0) {
      throw resolverError("MATRIX_RESOLVER_CONFIGURATION_ERROR");
    }
    const parsed = JSON.parse(await readFile(path, "utf8"));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw resolverError("MATRIX_RESOLVER_CONFIGURATION_ERROR");
    }
    for (const [userId, pin] of Object.entries(parsed)) {
      if (!isValidMatrixUserId(userId) || !pin || typeof pin !== "object"
          || typeof pin.masterKey !== "string" || typeof pin.firstSeen !== "string" || typeof pin.lastSeen !== "string") {
        throw resolverError("MATRIX_RESOLVER_CONFIGURATION_ERROR");
      }
    }
    return parsed;
  } catch (error) {
    if (error?.code === "ENOENT") return {};
    if (error instanceof ResolverError) throw error;
    throw resolverError("MATRIX_RESOLVER_CONFIGURATION_ERROR", error);
  }
}

async function writeState(path, state) {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = `${path}.tmp-${process.pid}-${++temporaryFileCounter}`;
  let handle;
  try {
    handle = await open(temporary, "wx", 0o600);
    await handle.writeFile(`${JSON.stringify(state, null, 2)}\n`, "utf8");
    await handle.sync();
    await handle.close();
    handle = undefined;
    await rename(temporary, path);
    await chmod(path, 0o600);
    const directory = await open(dirname(path), "r");
    try { await directory.sync(); } finally { await directory.close(); }
  } catch (error) {
    if (handle) await handle.close().catch(() => {});
    await rm(temporary, { force: true }).catch(() => {});
    throw resolverError("MATRIX_RESOLVER_CONFIGURATION_ERROR", error);
  }
}

function serialize(queue, operation) {
  const result = queue.then(operation, operation);
  return { result, next: result.then(() => undefined, () => undefined) };
}

function pinMasterKey(userId, masterKey, state, statePath, queueRef) {
  const encodedKey = masterKey;
  const queued = serialize(queueRef.current, async () => {
    const previous = state[userId];
    if (previous && previous.masterKey !== encodedKey) throw resolverError("MATRIX_MASTER_KEY_CHANGED");
    const now = new Date().toISOString();
    const next = {
      ...state,
      [userId]: {
        masterKey: encodedKey,
        firstSeen: previous?.firstSeen ?? now,
        lastSeen: now,
      },
    };
    await writeState(statePath, next);
    for (const key of Object.keys(state)) delete state[key];
    Object.assign(state, next);
    return state[userId];
  });
  queueRef.current = queued.next;
  return queued.result;
}

function json(response, status, body, headers = {}) {
  const encoded = JSON.stringify(body);
  response.writeHead(status, {
    "cache-control": "no-store",
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(encoded),
    "x-content-type-options": "nosniff",
    ...headers,
  });
  response.end(encoded);
}

async function readRequestJson(request) {
  const contentType = request.headers["content-type"] ?? "";
  if (!/^application\/json(?:\s*;|$)/i.test(contentType)) throw resolverError("INVALID_REQUEST");
  const declaredLength = Number(request.headers["content-length"] ?? 0);
  if (Number.isFinite(declaredLength) && declaredLength > MAX_REQUEST_BYTES) throw resolverError("REQUEST_TOO_LARGE");
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > MAX_REQUEST_BYTES) throw resolverError("REQUEST_TOO_LARGE");
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch (error) {
    if (error instanceof ResolverError) throw error;
    throw resolverError("INVALID_JSON", error);
  }
}

async function loadAsToken(path) {
  if (typeof path !== "string" || !path) throw resolverError("MATRIX_RESOLVER_CONFIGURATION_ERROR");
  try {
    const metadata = await stat(path);
    if (!metadata.isFile() || (metadata.mode & 0o077) !== 0) throw resolverError("MATRIX_RESOLVER_CONFIGURATION_ERROR");
    const token = (await readFile(path, "utf8")).trim();
    if (token.length < 32 || /\s/.test(token)) throw resolverError("MATRIX_RESOLVER_CONFIGURATION_ERROR");
    return token;
  } catch (error) {
    if (error instanceof ResolverError) throw error;
    throw resolverError("MATRIX_RESOLVER_CONFIGURATION_ERROR", error);
  }
}

function parseAllowedOrigins(value) {
  if (typeof value !== "string") throw resolverError("MATRIX_RESOLVER_CONFIGURATION_ERROR");
  const origins = new Set();
  for (const candidate of value.split(",").map((item) => item.trim()).filter(Boolean)) {
    let parsed;
    try {
      parsed = new URL(candidate);
    } catch (error) {
      throw resolverError("MATRIX_RESOLVER_CONFIGURATION_ERROR", error);
    }
    if (parsed.protocol !== "https:"
        || parsed.origin !== candidate
        || parsed.username !== ""
        || parsed.password !== ""
        || parsed.pathname !== "/"
        || parsed.search !== ""
        || parsed.hash !== "") {
      throw resolverError("MATRIX_RESOLVER_CONFIGURATION_ERROR");
    }
    origins.add(candidate);
  }
  return origins;
}

export async function createResolverServer({
  port = Number(process.env.PORT || 8787),
  host = "127.0.0.1",
  homeserverUrl = process.env.MATRIX_HOMESERVER_URL || TUWUNEL_ORIGIN,
  asTokenFile = process.env.MATRIX_HOMESERVER_AS_TOKEN_FILE,
  statePath = process.env.MATRIX_RESOLVER_STATE || "/var/lib/locus-matrix-resolver/state.json",
  allowedOrigins = process.env.MATRIX_RESOLVER_ALLOWED_ORIGINS ?? "",
  fetchImpl = fetch,
} = {}) {
  validateConfiguredHomeserver(homeserverUrl);
  if (host !== "127.0.0.1") throw resolverError("MATRIX_RESOLVER_CONFIGURATION_ERROR");
  const asToken = await loadAsToken(asTokenFile);
  const state = await readState(statePath);
  const allowedOriginSet = parseAllowedOrigins(allowedOrigins);
  const queueRef = { current: Promise.resolve() };

  const server = createServer(async (request, response) => {
    const origin = request.headers.origin;
    let corsHeaders = {};
    if (origin !== undefined) {
      if (!allowedOriginSet.has(origin)) return json(response, 403, { error: "ORIGIN_NOT_ALLOWED" });
      corsHeaders = {
        "access-control-allow-origin": origin,
        "access-control-allow-methods": "POST, OPTIONS",
        "access-control-allow-headers": "content-type",
        "access-control-max-age": "600",
        vary: "Origin",
      };
    }
    if (request.method === "OPTIONS" && request.url === "/v1/resolve") {
      const requestedMethod = request.headers["access-control-request-method"];
      const requestedHeaders = (request.headers["access-control-request-headers"] ?? "")
        .split(",")
        .map((header) => header.trim().toLowerCase())
        .filter(Boolean);
      if (!origin || requestedMethod !== "POST" || requestedHeaders.some((header) => header !== "content-type")) {
        return json(response, 403, { error: "INVALID_PREFLIGHT" }, corsHeaders);
      }
      response.writeHead(204, {
        "cache-control": "no-store",
        ...corsHeaders,
        "content-length": "0",
      });
      return response.end();
    }
    if (request.method === "GET" && request.url === "/healthz") return json(response, 200, { status: "ready" }, corsHeaders);
    if (request.method === "GET" && request.url === "/readyz") {
      try {
        const upstream = await fetchImpl(VERSIONS_URL, { method: "GET", signal: timeoutSignal(3_000), redirect: "error" });
        if (!upstream.ok || upstream.redirected) throw resolverError("MATRIX_HOMESERVER_UNAVAILABLE");
        return json(response, 200, { status: "ready" }, corsHeaders);
      } catch {
        return json(response, 503, { error: "MATRIX_HOMESERVER_UNAVAILABLE" }, corsHeaders);
      }
    }
    if (request.method !== "POST" || request.url !== "/v1/resolve") return json(response, 404, { error: "NOT_FOUND" }, corsHeaders);

    try {
      const body = await readRequestJson(request);
      if (!body || typeof body !== "object" || Array.isArray(body)
          || Object.keys(body).length !== 1 || !Object.hasOwn(body, "userId")) {
        throw resolverError("INVALID_REQUEST");
      }
      const userId = body.userId;
      if (!isValidMatrixUserId(userId)) throw resolverError("INVALID_MATRIX_USER_ID");
      const resolved = await resolveMasterOwnership(userId, { asToken, fetchImpl });
      await pinMasterKey(userId, resolved.masterKey, state, statePath, queueRef);
      return json(response, 200, { userId, ownership: resolved.ownership }, corsHeaders);
    } catch (error) {
      const code = error instanceof ResolverError ? error.code : "MATRIX_RESOLVER_CONFIGURATION_ERROR";
      const status = ERROR_STATUS[code] ?? 503;
      return json(response, status, { error: code }, corsHeaders);
    }
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, resolve);
  });
  return server;
}

// Node resolves a symlinked entry point to its real path for import.meta.url.
// Resolve argv[1] the same way so this starts when launched through /opt/locus/current.
const invokedPath = process.argv[1];
const isMainModule = invokedPath !== undefined
  && import.meta.url === pathToFileURL(realpathSync(invokedPath)).href;

if (isMainModule) {
  createResolverServer().then((server) => {
    const address = server.address();
    console.log(`Matrix resolver listening on http://127.0.0.1:${typeof address === "object" ? address.port : address}`);
  }).catch((error) => {
    const code = error instanceof ResolverError ? error.code : "MATRIX_RESOLVER_CONFIGURATION_ERROR";
    console.error(code);
    process.exitCode = 1;
  });
}
