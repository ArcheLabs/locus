import { createClient, type MatrixClient } from "matrix-js-sdk";
import { MatrixDeviceController } from "@jamscript/client";
import { matrixOwnership, type LocusClient } from "@archelabs/locus";
import type { LocusWebSession } from "../session/types.js";
import { MatrixConnectorError } from "./MatrixErrors.js";
import { MatrixCryptoDevice } from "./MatrixCryptoDevice.js";
import { queryMatrixKeys } from "./MatrixKeysQuery.js";

export type MatrixStoredSession = {
  accessToken: string;
  refreshToken?: string;
  expiresAtMs?: number;
  userId: string;
  deviceId: string;
  homeserver: string;
};

export type MatrixConnectionState =
  | "AUTHENTICATED"
  | "KEYS_UPLOADED"
  | "AWAITING_VERIFICATION"
  | "VERIFIED"
  | "READY";

export type MatrixConnectionOptions = {
  locus: LocusClient | null;
};

const MATRIX_SESSION_KEY = "locus.matrix.session.v1";

type MatrixTokenResponse = {
  access_token?: string;
  refresh_token?: string;
  expires_in_ms?: number;
};

function stableDeviceId(homeserver: string, userId: string): string {
  const key = \`locus.matrix.device.v1.\${homeserver}|\${userId}\`;
  const existing = window.sessionStorage.getItem(key);
  if (existing && /^[A-Z0-9_-]{1,255}$/.test(existing)) return existing;
  const bytes = new Uint8Array(12);
  crypto.getRandomValues(bytes);
  const created = \`LOCUS-\${Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("").toUpperCase()}\`;
  window.sessionStorage.setItem(key, created);
  return created;
}

function homeserverFromUserId(userId: string): string {
  const separator = userId.indexOf(":");
  if (separator < 2 || separator === userId.length - 1) throw new MatrixConnectorError("INVALID_LOGIN", "Enter a valid Matrix ID such as @alice:example.org");
  return \`https://\${userId.slice(separator + 1)}\`;
}

export async function discoverHomeserver(userId: string, configured?: string): Promise<string> {
  const fallback = (configured || homeserverFromUserId(userId)).replace(/\/$/, "");
  if (configured) return fallback;
  const domain = homeserverFromUserId(userId).replace(/^https:\/\//, "");
  try {
    const response = await fetch(\`https://\${domain}/.well-known/matrix/client\`);
    if (!response.ok) return fallback;
    const json = await response.json() as { "m.homeserver"?: { base_url?: string } };
    return json["m.homeserver"]?.base_url?.replace(/\/$/, "") || fallback;
  } catch {
    return fallback;
  }
}

async function refreshMatrixAccessToken(stored: MatrixStoredSession): Promise<void> {
  if (!stored.refreshToken) throw new MatrixConnectorError("TOKEN_REFRESH_FAILED", "The Matrix session has no refresh token");
  let response: Response;
  try {
    response = await fetch(\`\${stored.homeserver.replace(/\/$/, "")}/_matrix/client/v3/refresh\`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ refresh_token: stored.refreshToken }),
    });
  } catch (cause) {
    throw new MatrixConnectorError("TOKEN_REFRESH_FAILED", "Unable to refresh the Matrix session", { cause });
  }
  let payload: MatrixTokenResponse = {};
  try { payload = await response.json() as MatrixTokenResponse; } catch (cause) {
    throw new MatrixConnectorError("TOKEN_REFRESH_FAILED", "Matrix token refresh returned invalid JSON", { cause });
  }
  if (!response.ok || typeof payload.access_token !== "string") {
    throw new MatrixConnectorError("TOKEN_REFRESH_FAILED", \`Matrix token refresh failed with HTTP \${response.status}\`);
  }
  stored.accessToken = payload.access_token;
  if (typeof payload.refresh_token === "string") stored.refreshToken = payload.refresh_token;
  if (typeof payload.expires_in_ms === "number" && Number.isFinite(payload.expires_in_ms)) {
    stored.expiresAtMs = Date.now() + payload.expires_in_ms;
  }
  window.sessionStorage.setItem(MATRIX_SESSION_KEY, JSON.stringify(stored));
}

async function ensureFreshMatrixToken(stored: MatrixStoredSession): Promise<void> {
  if (stored.expiresAtMs !== undefined && stored.expiresAtMs <= Date.now() + 5_000) await refreshMatrixAccessToken(stored);
}

function classifyLoginFailure(cause: unknown): MatrixConnectorError {
  if (cause instanceof MatrixConnectorError) return cause;
  const candidate = cause as { errcode?: unknown; httpStatus?: unknown; statusCode?: unknown } | null;
  const status = typeof candidate?.httpStatus === "number"
    ? candidate.httpStatus
    : typeof candidate?.statusCode === "number" ? candidate.statusCode : undefined;
  const errcode = typeof candidate?.errcode === "string" ? candidate.errcode : "";
  if (status === 401 || status === 403 || errcode === "M_FORBIDDEN" || errcode === "M_UNKNOWN_TOKEN") {
    return new MatrixConnectorError("INVALID_LOGIN", "Matrix login was rejected", { cause });
  }
  return new MatrixConnectorError("HOMESERVER_UNAVAILABLE", "Unable to reach or initialize the Matrix homeserver", { cause });
}

async function authenticatedFetch(stored: MatrixStoredSession, input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> {
  const request = async (): Promise<Response> => {
    const headers = new Headers(init.headers);
    headers.set("authorization", \`Bearer \${stored.accessToken}\`);
    return fetch(input, { ...init, headers });
  };
  await ensureFreshMatrixToken(stored);
  let response = await request();
  if (response.status === 401 && stored.refreshToken) {
    await refreshMatrixAccessToken(stored);
    response = await request();
  }
  return response;
}

function authenticatedHttp(homeserver: string, stored: MatrixStoredSession) {
  return async (path: string, body: string, method: "POST" | "PUT" = "POST"): Promise<string> => {
    const response = await authenticatedFetch(stored, \`\${homeserver.replace(/\/$/, "")}\${path}\`, {
      method,
      headers: { "content-type": "application/json" },
      body,
    });
    const text = await response.text();
    if (!response.ok) throw new MatrixConnectorError("DEVICE_KEYS_UPLOAD_FAILED", \`Matrix request \${path} failed with HTTP \${response.status}: \${text.slice(0, 240)}\`);
    return text || "{}";
  };
}

async function ensureMatrixController(
  locus: LocusClient | null,
  subject: ReturnType<typeof matrixOwnership>,
  controller: MatrixDeviceController,
  proof: Uint8Array | null,
): Promise<void> {
  if (!locus) throw new MatrixConnectorError("CONTROLLER_NOT_AUTHORIZED", "The selected network is not ready for Matrix identity authorization");
  if (!proof) throw new MatrixConnectorError("DEVICE_NOT_VERIFIED", "Verify this Matrix device before authorizing it for Locus");
  const scoped = locus.withSession({ signer: controller, subject });
  const initialized = await scoped.hasMatrixBootstrapCompleted(subject);
  if (initialized) {
    if (!await scoped.isControllerActive(subject, await controller.getController())) {
      throw new MatrixConnectorError("CONTROLLER_NOT_AUTHORIZED", "This Matrix device is not an active controller");
    }
    return;
  }
  try {
    const submitted = await scoped.bootstrapMatrixController(proof);
    const result = await scoped.waitForAction(submitted.transactionId, { intervalMs: 500, timeoutMs: 180_000 });
    if (result.actionReceipt.status !== "applied") {
      throw new Error(\`Matrix controller bootstrap failed\${result.errorCode == null ? "" : \` (error \${result.errorCode})\`}\`);
    }
  } catch (cause) {
    if (cause instanceof MatrixConnectorError) throw cause;
    throw new MatrixConnectorError("CONTROLLER_BOOTSTRAP_FAILED", "Matrix controller bootstrap was rejected", { cause });
  }
}

export type MatrixConnected = {
  session: LocusWebSession;
  client: MatrixClient;
  crypto: MatrixCryptoDevice;
  keys: Awaited<ReturnType<typeof queryMatrixKeys>>;
  stored: MatrixStoredSession;
  state: MatrixConnectionState;
  checkVerification: () => Promise<MatrixConnected>;
};

function sameBytes(left: Uint8Array, right: Uint8Array): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function connectedState(keys: Awaited<ReturnType<typeof queryMatrixKeys>>, locus: LocusClient | null): MatrixConnectionState {
  if (keys.verification === "pending") return "AWAITING_VERIFICATION";
  return locus ? "READY" : "VERIFIED";
}

async function makeConnected(
  stored: MatrixStoredSession,
  client: MatrixClient,
  crypto: MatrixCryptoDevice,
  keys: Awaited<ReturnType<typeof queryMatrixKeys>>,
  controller: MatrixDeviceController,
  locus: LocusClient | null,
): Promise<MatrixConnected> {
  const owner = matrixOwnership(keys.masterPublicKey);
  const currentController = await controller.getController();
  const state = connectedState(keys, locus);
  const session: LocusWebSession = {
    kind: "matrix",
    owner,
    controller: currentController,
    ownershipSession: { signer: controller, subject: owner },
    label: \`Matrix \${stored.userId}\`,
    address: stored.userId,
    connectionId: \`\${stored.homeserver}|\${stored.userId}|\${stored.deviceId}\`,
    matrix: { userId: stored.userId, deviceId: stored.deviceId, homeserver: stored.homeserver },
    cleanup: () => { crypto.dispose(); client.stopClient(); clearStoredMatrixSession(); },
  };
  const connected: MatrixConnected = {
    session,
    client,
    crypto,
    keys,
    stored,
    state,
    checkVerification: async () => {
      const refreshed = await queryMatrixKeys(
        stored.userId,
        stored.deviceId,
        stored.homeserver,
        stored.accessToken,
        (input, init) => authenticatedFetch(stored, input, init),
      );
      if (!sameBytes(refreshed.deviceEd25519Key, keys.deviceEd25519Key)) {
        throw new MatrixConnectorError("DEVICE_NOT_VERIFIED", "The Matrix device key changed; start a new login");
      }
      if (refreshed.verification === "verified") {
        await ensureMatrixController(locus, owner, controller, refreshed.encodedProof);
      }
      return makeConnected(stored, client, crypto, refreshed, controller, locus);
    },
  };
  return connected;
}

export async function connectMatrixSession(
  userId: string,
  password: string,
  configuredHomeserver?: string,
  options: MatrixConnectionOptions = { locus: null },
): Promise<MatrixConnected> {
  const homeserver = await discoverHomeserver(userId, configuredHomeserver);
  let loginClient: MatrixClient;
  try {
    loginClient = createClient({ baseUrl: homeserver });
  } catch (cause) {
    throw new MatrixConnectorError("HOMESERVER_UNAVAILABLE", "Unable to initialize Matrix homeserver client", { cause });
  }
  let login: Awaited<ReturnType<MatrixClient["loginRequest"]>>;
  try {
    const deviceId = stableDeviceId(homeserver, userId);
    login = await loginClient.loginRequest({
      type: "m.login.password",
      identifier: { type: "m.id.user", user: userId },
      password,
      device_id: deviceId,
      initial_device_display_name: "Locus",
      refresh_token: true,
    });
  } catch (cause) {
    throw classifyLoginFailure(cause);
  } finally {
    loginClient.stopClient();
  }
  const stored: MatrixStoredSession = {
    accessToken: login.access_token,
    refreshToken: login.refresh_token,
    expiresAtMs: typeof login.expires_in_ms === "number" ? Date.now() + login.expires_in_ms : undefined,
    userId: login.user_id,
    deviceId: login.device_id,
    homeserver,
  };
  const client = createClient({ baseUrl: homeserver, accessToken: stored.accessToken, userId: stored.userId, deviceId: stored.deviceId });
  const cryptoHttp = authenticatedHttp(homeserver, stored);
  const authFetch = (input: RequestInfo | URL, init?: RequestInit) => authenticatedFetch(stored, input, init);
  const crypto = await MatrixCryptoDevice.initialize(stored.userId, stored.deviceId, cryptoHttp);
  crypto.startSync(homeserver, authFetch, cryptoHttp);
  const keys = await queryMatrixKeys(stored.userId, stored.deviceId, homeserver, stored.accessToken, authFetch);
  const controller = new MatrixDeviceController(keys.deviceEd25519Key, { sign: (message) => crypto.sign(message) });
  const owner = matrixOwnership(keys.masterPublicKey);
  if (keys.verification === "verified") await ensureMatrixController(options.locus, owner, controller, keys.encodedProof);
  window.sessionStorage.setItem(MATRIX_SESSION_KEY, JSON.stringify(stored));
  return makeConnected(stored, client, crypto, keys, controller, options.locus);
}

export async function restoreMatrixSession(
  stored: MatrixStoredSession,
  options: MatrixConnectionOptions = { locus: null },
): Promise<MatrixConnected> {
  await ensureFreshMatrixToken(stored);
  const client = createClient({ baseUrl: stored.homeserver, accessToken: stored.accessToken, userId: stored.userId, deviceId: stored.deviceId });
  const cryptoHttp = authenticatedHttp(stored.homeserver, stored);
  const authFetch = (input: RequestInfo | URL, init?: RequestInit) => authenticatedFetch(stored, input, init);
  const crypto = await MatrixCryptoDevice.initialize(stored.userId, stored.deviceId, cryptoHttp);
  crypto.startSync(stored.homeserver, authFetch, cryptoHttp);
  const keys = await queryMatrixKeys(stored.userId, stored.deviceId, stored.homeserver, stored.accessToken, authFetch);
  const controller = new MatrixDeviceController(keys.deviceEd25519Key, { sign: (message) => crypto.sign(message) });
  const owner = matrixOwnership(keys.masterPublicKey);
  if (keys.verification === "verified") await ensureMatrixController(options.locus, owner, controller, keys.encodedProof);
  return makeConnected(stored, client, crypto, keys, controller, options.locus);
}

export function readStoredMatrixSession(): MatrixStoredSession | null {
  const value = window.sessionStorage.getItem(MATRIX_SESSION_KEY);
  if (!value) return null;
  try { return JSON.parse(value) as MatrixStoredSession; } catch { window.sessionStorage.removeItem(MATRIX_SESSION_KEY); return null; }
}

export function clearStoredMatrixSession(): void { window.sessionStorage.removeItem(MATRIX_SESSION_KEY); }
