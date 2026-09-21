import { createServer } from "node:http";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

const MATRIX_USER_ID = /^@[^\s:]+:[^\s:]+$/;
const MASTER_KEY_ID = /^ed25519:/;

export function decodeBase64Url(value) {
  if (typeof value !== "string" || !value) throw new Error("invalid base64 value");
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  return Uint8Array.from(Buffer.from(normalized, "base64"));
}

export function formatMatrixOwnership(masterKey) {
  if (!(masterKey instanceof Uint8Array) || masterKey.length !== 32) throw new Error("Matrix master key must be 32 bytes");
  const encoded = Buffer.concat([Buffer.from([1, 0, 32, 0]), Buffer.from(masterKey)]).toString("base64url");
  return `locus:${encoded}`;
}

function homeserverFromUserId(userId) {
  return `https://${userId.slice(userId.indexOf(":") + 1)}`;
}

async function discoverHomeserver(userId, fetchImpl) {
  const fallback = homeserverFromUserId(userId);
  try {
    const response = await fetchImpl(`${fallback}/.well-known/matrix/client`);
    if (!response.ok) return fallback;
    const body = await response.json();
    return typeof body?.["m.homeserver"]?.base_url === "string"
      ? body["m.homeserver"].base_url.replace(/\/$/, "")
      : fallback;
  } catch {
    return fallback;
  }
}

function firstMasterKey(masterKeys) {
  const entries = Object.entries(masterKeys?.keys ?? {}).filter(([key]) => MASTER_KEY_ID.test(key));
  if (entries.length !== 1) throw new Error("MATRIX_CROSS_SIGNING_UNAVAILABLE");
  const [, value] = entries[0];
  const decoded = decodeBase64Url(value);
  if (decoded.length !== 32) throw new Error("MATRIX_CROSS_SIGNING_UNAVAILABLE");
  return decoded;
}

export async function resolveMasterOwnership(userId, { accessToken, fetchImpl = fetch, previous } = {}) {
  if (!MATRIX_USER_ID.test(userId)) throw new Error("INVALID_MATRIX_USER_ID");
  if (!accessToken) throw new Error("MATRIX_RESOLVER_ACCESS_TOKEN_MISSING");
  const homeserver = await discoverHomeserver(userId, fetchImpl);
  const response = await fetchImpl(`${homeserver}/_matrix/client/v3/keys/query`, {
    method: "POST",
    headers: { authorization: `Bearer ${accessToken}`, "content-type": "application/json" },
    body: JSON.stringify({ device_keys: { [userId]: [] } }),
  });
  if (!response.ok) throw new Error(`MATRIX_KEYS_QUERY_HTTP_${response.status}`);
  const payload = await response.json();
  const masterKey = firstMasterKey(payload.master_keys?.[userId]);
  const encodedKey = Buffer.from(masterKey).toString("base64url");
  if (previous && previous.masterKey !== encodedKey) throw new Error("MATRIX_MASTER_KEY_CHANGED");
  return {
    userId,
    homeserver,
    masterKey: encodedKey,
    ownership: formatMatrixOwnership(masterKey),
    fetchedAt: new Date().toISOString(),
  };
}

async function readState(path) {
  try { return JSON.parse(await readFile(path, "utf8")); } catch (error) {
    if (error.code === "ENOENT") return {};
    throw error;
  }
}

async function writeState(path, state) {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.tmp-${process.pid}`;
  await writeFile(temporary, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });
  await rename(temporary, path);
}

function json(response, status, body) {
  const encoded = JSON.stringify(body);
  response.writeHead(status, { "content-type": "application/json", "content-length": Buffer.byteLength(encoded) });
  response.end(encoded);
}

export async function createResolverServer({ port = Number(process.env.PORT || 8787), accessToken = process.env.MATRIX_RESOLVER_ACCESS_TOKEN, statePath = process.env.MATRIX_RESOLVER_STATE || ".matrix-resolver/state.json", fetchImpl = fetch } = {}) {
  if (!accessToken) throw new Error("MATRIX_RESOLVER_ACCESS_TOKEN is required");
  const state = await readState(statePath);
  const server = createServer(async (request, response) => {
    if (request.method === "GET" && request.url === "/healthz") return json(response, 200, { status: "ready" });
    if (request.method !== "POST" || request.url !== "/v1/resolve") return json(response, 404, { error: "NOT_FOUND" });
    try {
      const chunks = [];
      for await (const chunk of request) chunks.push(chunk);
      const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      const userId = body?.userId;
      const key = String(userId);
      const resolved = await resolveMasterOwnership(key, { accessToken, fetchImpl, previous: state[key] });
      state[key] = { masterKey: resolved.masterKey, homeserver: resolved.homeserver, firstSeen: state[key]?.firstSeen || resolved.fetchedAt };
      await writeState(statePath, state);
      return json(response, 200, resolved);
    } catch (error) {
      const message = error instanceof Error ? error.message : "RESOLUTION_FAILED";
      const status = message === "MATRIX_MASTER_KEY_CHANGED" ? 409 : message === "INVALID_MATRIX_USER_ID" ? 400 : 502;
      return json(response, status, { error: message });
    }
  });
  await new Promise((resolve) => server.listen(port, "127.0.0.1", resolve));
  return server;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  createResolverServer().then((server) => {
    const address = server.address();
    console.log(`Matrix resolver listening on http://127.0.0.1:${typeof address === "object" ? address.port : address}`);
  }).catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
