import { createClient, type MatrixClient } from "matrix-js-sdk";
import { MatrixDeviceController, type MatrixControlClaimBootstrapper } from "@jamscript/client";
import { matrixOwnership } from "@archelabs/locus";
import type { ControlClaimDeploymentDescriptor } from "../network/types.js";
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

type MatrixControlClaimOptions = {
  client: unknown;
  deployment: ControlClaimDeploymentDescriptor;
};

type ControlClaimClient = {
  bootstrapMatrixControlClaim?: (input: {
    deployment: ControlClaimDeploymentDescriptor;
    subject: ReturnType<typeof matrixOwnership>;
    controllerSigner: unknown;
    proof: Uint8Array;
  }) => Promise<{ transactionId: string; actionHash: string }>;
  hasBootstrapCompleted?: (deployment: ControlClaimDeploymentDescriptor, subject: ReturnType<typeof matrixOwnership>) => Promise<boolean>;
  isControllerActive?: (deployment: ControlClaimDeploymentDescriptor, subject: ReturnType<typeof matrixOwnership>, controller: ReturnType<typeof matrixOwnership>) => Promise<boolean>;
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

function createControlClaimBootstrapper(
  options: MatrixControlClaimOptions | undefined,
  controller: MatrixDeviceController,
  crypto: MatrixCryptoDevice,
): MatrixControlClaimBootstrapper | null {
  const client = options?.client as ControlClaimClient & {
    bootstrapMatrixControlClaim?: (input: {
      deployment: ControlClaimDeploymentDescriptor;
      subject: ReturnType<typeof matrixOwnership>;
      controllerSigner: {
        getController(): Promise<ReturnType<typeof matrixOwnership>>;
        signJamScriptAction(request: { message: Uint8Array }): Promise<Uint8Array>;
        signBootstrapMessage(message: Uint8Array): Promise<Uint8Array>;
      };
      proof: Uint8Array;
    }) => Promise<{ transactionId: string; actionHash: string }>;
    waitForAction?: (transactionId: string, actionHash: string, options: { intervalMs: number; timeoutMs: number }) => Promise<{ actionReceipt?: { status?: string }; errorCode?: number | null }>;
  } | undefined;
  if (!options || typeof client?.bootstrapMatrixControlClaim !== "function") return null;
  const signer = {
    getController: () => controller.getController(),
    signJamScriptAction: (request: { message: Uint8Array }) => controller.signJamScriptAction(request as Parameters<MatrixDeviceController["signJamScriptAction"]>[0]),
    signBootstrapMessage: (message: Uint8Array) => crypto.sign(message),
  };
  return {
    bootstrap: async (subject, device, proof) => {
      const submitted = await client.bootstrapMatrixControlClaim!({
        deployment: options.deployment,
        subject,
        controllerSigner: signer,
        proof,
      });
      if (typeof client.waitForAction !== "function") return;
      const result = await client.waitForAction(submitted.transactionId, submitted.actionHash, { intervalMs: 500, timeoutMs: 180_000 });
      if (result.actionReceipt?.status !== "applied") throw new Error(`ControlClaim bootstrap failed${result.errorCode == null ? "" : ` (error ${result.errorCode})`}`);
      void device;
    },
  };
}

async function ensureMatrixControlClaim(
  options: MatrixControlClaimOptions | undefined,
  bootstrapper: MatrixControlClaimBootstrapper | null,
  subject: ReturnType<typeof matrixOwnership>,
  controller: ReturnType<typeof matrixOwnership>,
  proof: Uint8Array | null,
): Promise<void> {
  if (!bootstrapper || !options) throw new MatrixConnectorError("CONTROL_CLAIM_FAILED", "The selected network has no Ownership Control service");
  if (!proof) throw new MatrixConnectorError("DEVICE_NOT_VERIFIED", "Verify this Matrix device before authorizing it for Locus");
  const client = options.client as ControlClaimClient;
  if (client.hasBootstrapCompleted && client.isControllerActive) {
    const initialized = await client.hasBootstrapCompleted(options.deployment, subject);
    if (initialized) {
      if (!await client.isControllerActive(options.deployment, subject, controller)) throw new MatrixConnectorError("CONTROL_CLAIM_FAILED", "This Matrix device is not an active controller");
      return;
    }
  }
  await bootstrapper.bootstrap(subject, controller, proof);
}

export type MatrixConnected = {
  session: LocusWebSession;
  client: MatrixClient;
  crypto: MatrixCryptoDevice;
  keys: Awaited<ReturnType<typeof queryMatrixKeys>>;
  bootstrapper: MatrixControlClaimBootstrapper | null;
  stored: MatrixStoredSession;
};

export async function connectMatrixSession(userId: string, password: string, configuredHomeserver?: string, matrixControlClaim?: MatrixControlClaimOptions): Promise<MatrixConnected> {
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
  const bootstrapper = createControlClaimBootstrapper(matrixControlClaim, controller, crypto);
  if (bootstrapper) await ensureMatrixControlClaim(matrixControlClaim, bootstrapper, owner, await controller.getController(), keys.encodedProof);
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
    bootstrapper,
    stored,
  };
}

export async function restoreMatrixSession(stored: MatrixStoredSession, matrixControlClaim?: MatrixControlClaimOptions): Promise<MatrixConnected> {
  const client = createClient({ baseUrl: stored.homeserver, accessToken: stored.accessToken, userId: stored.userId, deviceId: stored.deviceId });
  const crypto = await MatrixCryptoDevice.initialize(stored.userId, stored.deviceId, authenticatedHttp(stored.homeserver, stored.accessToken));
  const keys = await queryMatrixKeys(stored.userId, stored.deviceId, stored.homeserver, stored.accessToken);
  const controller = new MatrixDeviceController(keys.deviceEd25519Key, { sign: (message) => crypto.sign(message) });
  const owner = matrixOwnership(keys.masterPublicKey);
  const bootstrapper = createControlClaimBootstrapper(matrixControlClaim, controller, crypto);
  if (bootstrapper) await ensureMatrixControlClaim(matrixControlClaim, bootstrapper, owner, await controller.getController(), keys.encodedProof);
  return {
    session: { kind: "matrix", owner, controller: await controller.getController(), ownershipSession: { signer: controller, actAs: owner }, label: `Matrix ${stored.userId}`, address: stored.userId, connectionId: `${stored.homeserver}|${stored.userId}|${stored.deviceId}`, matrix: { userId: stored.userId, deviceId: stored.deviceId, homeserver: stored.homeserver }, cleanup: () => { crypto.dispose(); client.stopClient(); clearStoredMatrixSession(); } },
    client,
    crypto,
    keys,
    bootstrapper,
    stored,
  };
}

export function readStoredMatrixSession(): MatrixStoredSession | null {
  const value = window.sessionStorage.getItem(MATRIX_SESSION_KEY);
  if (!value) return null;
  try { return JSON.parse(value) as MatrixStoredSession; } catch { window.sessionStorage.removeItem(MATRIX_SESSION_KEY); return null; }
}

export function clearStoredMatrixSession(): void { window.sessionStorage.removeItem(MATRIX_SESSION_KEY); }
