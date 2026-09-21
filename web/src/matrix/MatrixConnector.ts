import { createClient, type MatrixClient } from "matrix-js-sdk";
import { MatrixDeviceController, type MatrixControlClaimBootstrapper } from "@jamscript/client";
import { matrixOwnership } from "@archelabs/locus";
import type { LocusWebSession } from "../session/types.js";
import { MatrixConnectorError } from "./MatrixErrors.js";
import { MatrixCryptoDevice } from "./MatrixCryptoDevice.js";
import { queryMatrixKeys } from "./MatrixKeysQuery.js";

export type MatrixStoredSession = {
  accessToken: string;
  refreshToken?: string;
  userId: string;
  deviceId: string;
  homeserver: string;
};

const MATRIX_SESSION_KEY = "locus.matrix.session.v1";

function stableDeviceId(homeserver: string, userId: string): string {
  const key = `locus.matrix.device.v1.${homeserver}|${userId}`;
  const existing = window.sessionStorage.getItem(key);
  if (existing && /^[A-Z0-9_-]{1,255}$/.test(existing)) return existing;
  const bytes = new Uint8Array(12);
  crypto.getRandomValues(bytes);
  const created = `LOCUS-${Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("").toUpperCase()}`;
  window.sessionStorage.setItem(key, created);
  return created;
}

function homeserverFromUserId(userId: string): string {
  const separator = userId.indexOf(":");
  if (separator < 2 || separator === userId.length - 1) throw new MatrixConnectorError("INVALID_LOGIN", "Enter a valid Matrix ID such as @alice:example.org");
  return `https://${userId.slice(separator + 1)}`;
}

export async function discoverHomeserver(userId: string, configured?: string): Promise<string> {
  const fallback = (configured || homeserverFromUserId(userId)).replace(/\/$/, "");
  if (configured) return fallback;
  const domain = homeserverFromUserId(userId).replace(/^https:\/\//, "");
  try {
    const response = await fetch(`https://${domain}/.well-known/matrix/client`);
    if (!response.ok) return fallback;
    const json = await response.json() as { "m.homeserver"?: { base_url?: string } };
    return json["m.homeserver"]?.base_url?.replace(/\/$/, "") || fallback;
  } catch {
    return fallback;
  }
}

function authenticatedHttp(homeserver: string, accessToken: string) {
  return async (path: string, body: string, method: "POST" | "PUT" = "POST"): Promise<string> => {
    const response = await fetch(`${homeserver.replace(/\/$/, "")}${path}`, {
      method,
      headers: { authorization: `Bearer ${accessToken}`, "content-type": "application/json" },
      body,
    });
    const text = await response.text();
    if (!response.ok) throw new MatrixConnectorError("DEVICE_KEYS_UPLOAD_FAILED", `Matrix request ${path} failed with HTTP ${response.status}: ${text.slice(0, 240)}`);
    return text || "{}";
  };
}

export type MatrixConnected = {
  session: LocusWebSession;
  client: MatrixClient;
  crypto: MatrixCryptoDevice;
  keys: Awaited<ReturnType<typeof queryMatrixKeys>>;
  bootstrapper: MatrixControlClaimBootstrapper | null;
  stored: MatrixStoredSession;
};

export async function connectMatrixSession(userId: string, password: string, configuredHomeserver?: string): Promise<MatrixConnected> {
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
    throw new MatrixConnectorError("INVALID_LOGIN", "Matrix login was rejected", { cause });
  } finally {
    loginClient.stopClient();
  }
  const stored: MatrixStoredSession = { accessToken: login.access_token, refreshToken: login.refresh_token, userId: login.user_id, deviceId: login.device_id, homeserver };
  const client = createClient({ baseUrl: homeserver, accessToken: stored.accessToken, userId: stored.userId, deviceId: stored.deviceId });
  const crypto = await MatrixCryptoDevice.initialize(stored.userId, stored.deviceId, authenticatedHttp(homeserver, stored.accessToken));
  const keys = await queryMatrixKeys(stored.userId, stored.deviceId, homeserver, stored.accessToken);
  const controller = new MatrixDeviceController(keys.deviceEd25519Key, { sign: (message) => crypto.sign(message) });
  const owner = matrixOwnership(keys.masterPublicKey);
  window.sessionStorage.setItem(MATRIX_SESSION_KEY, JSON.stringify(stored));
  return {
    session: {
      kind: "matrix",
      owner,
      controller: await controller.getController(),
      ownershipSession: { signer: controller, actAs: owner },
      label: `Matrix ${stored.userId}`,
      address: stored.userId,
      connectionId: `${stored.homeserver}|${stored.userId}|${stored.deviceId}`,
      matrix: { userId: stored.userId, deviceId: stored.deviceId, homeserver: stored.homeserver },
      cleanup: () => { crypto.dispose(); client.stopClient(); clearStoredMatrixSession(); },
    },
    client,
    crypto,
    keys,
    // The current published client exposes the proof codec but no executable
    // chain ControlClaim ingress. Keep this explicit instead of pretending a
    // local UI session has an active on-chain claim.
    bootstrapper: null,
    stored,
  };
}

export async function restoreMatrixSession(stored: MatrixStoredSession): Promise<MatrixConnected> {
  const client = createClient({ baseUrl: stored.homeserver, accessToken: stored.accessToken, userId: stored.userId, deviceId: stored.deviceId });
  const crypto = await MatrixCryptoDevice.initialize(stored.userId, stored.deviceId, authenticatedHttp(stored.homeserver, stored.accessToken));
  const keys = await queryMatrixKeys(stored.userId, stored.deviceId, stored.homeserver, stored.accessToken);
  const controller = new MatrixDeviceController(keys.deviceEd25519Key, { sign: (message) => crypto.sign(message) });
  const owner = matrixOwnership(keys.masterPublicKey);
  return {
    session: { kind: "matrix", owner, controller: await controller.getController(), ownershipSession: { signer: controller, actAs: owner }, label: `Matrix ${stored.userId}`, address: stored.userId, connectionId: `${stored.homeserver}|${stored.userId}|${stored.deviceId}`, matrix: { userId: stored.userId, deviceId: stored.deviceId, homeserver: stored.homeserver }, cleanup: () => { crypto.dispose(); client.stopClient(); clearStoredMatrixSession(); } },
    client,
    crypto,
    keys,
    bootstrapper: null,
    stored,
  };
}

export function readStoredMatrixSession(): MatrixStoredSession | null {
  const value = window.sessionStorage.getItem(MATRIX_SESSION_KEY);
  if (!value) return null;
  try { return JSON.parse(value) as MatrixStoredSession; } catch { window.sessionStorage.removeItem(MATRIX_SESSION_KEY); return null; }
}

export function clearStoredMatrixSession(): void { window.sessionStorage.removeItem(MATRIX_SESSION_KEY); }
