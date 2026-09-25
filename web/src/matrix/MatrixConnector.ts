import { createClient, type MatrixClient } from "matrix-js-sdk";
import { decodeMatrixControlClaimProofV1, encodeMatrixControlClaimProofV1, MatrixDeviceController } from "@jamscript/client";
import { matrixOwnership, type LocusClient } from "@archelabs/locus";
import type { LocusWebSession } from "../session/types.js";
import { describeMatrixCause, MatrixConnectorError } from "./MatrixErrors.js";
import { destroyMatrixCryptoStore, MatrixCryptoDevice, type MatrixVerificationSnapshot } from "./MatrixCryptoDevice.js";
import { queryMatrixDeviceKeyParity, queryMatrixKeys, type MatrixDiscoveredKeys } from "./MatrixKeysQuery.js";
import { clearMatrixDeviceId, commitMatrixSessionAfterCryptoSetup, committedMatrixDeviceId, matrixDeviceId, refreshMatrixOAuthToken, revokeMatrixOAuthSession, type MatrixOAuthSession } from "./MatrixOAuth.js";

export type MatrixStoredSession = MatrixOAuthSession;

export type MatrixConnectionState =
  | "AUTHENTICATED"
  | "DEVICE_KEYS_READY"
  | "VERIFICATION_REQUIRED"
  | "VERIFICATION_REQUESTED"
  | "VERIFICATION_SAS_READY"
  | "VERIFICATION_CONFIRMING"
  | "VERIFIED"
  | "CONTROLLER_BOOTSTRAPPING"
  | "CONTROLLER_AUTHORIZATION_FAILED"
  | "READY";

export type MatrixConnectionOptions = {
  locus: LocusClient | null;
  onState?: (state: MatrixConnectionState) => void;
  signal?: AbortSignal;
};

const MATRIX_SESSION_KEY = "locus.matrix.session.v1";

type MatrixTokenResponse = {
  access_token?: string;
  refresh_token?: string;
  expires_in_ms?: number;
};

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

async function refreshMatrixAccessToken(stored: MatrixStoredSession, persist = true): Promise<void> {
  if (!stored.refreshToken) throw new MatrixConnectorError("TOKEN_REFRESH_FAILED", "The Matrix session has no refresh token");
  if (stored.authType === "oauth") {
    try { await refreshMatrixOAuthToken(stored, persist); }
    catch (cause) { throw new MatrixConnectorError("TOKEN_REFRESH_FAILED", "Matrix OAuth token refresh failed. Sign in again if the session has expired.", { cause }); }
    return;
  }
  let response: Response;
  try {
    response = await fetch(`${stored.homeserver.replace(/\/$/, "")}/_matrix/client/v3/refresh`, {
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
    throw new MatrixConnectorError("TOKEN_REFRESH_FAILED", `Matrix token refresh failed with HTTP ${response.status}`);
  }
  stored.accessToken = payload.access_token;
  if (typeof payload.refresh_token === "string") stored.refreshToken = payload.refresh_token;
  if (typeof payload.expires_in_ms === "number" && Number.isFinite(payload.expires_in_ms)) {
    stored.expiresAtMs = Date.now() + payload.expires_in_ms;
  }
  if (persist) window.localStorage.setItem(MATRIX_SESSION_KEY, JSON.stringify(stored));
}

async function ensureFreshMatrixToken(stored: MatrixStoredSession, persist = true): Promise<void> {
  if (stored.expiresAtMs !== undefined && stored.expiresAtMs <= Date.now() + 5_000) await refreshMatrixAccessToken(stored, persist);
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

async function authenticatedFetch(stored: MatrixStoredSession, input: RequestInfo | URL, init: RequestInit = {}, persistRefresh = true): Promise<Response> {
  const request = async (): Promise<Response> => {
    const headers = new Headers(init.headers);
    headers.set("authorization", `Bearer ${stored.accessToken}`);
    return fetch(input, { ...init, headers });
  };
  await ensureFreshMatrixToken(stored, persistRefresh);
  let response = await request();
  if (response.status === 401 && stored.refreshToken) {
    await refreshMatrixAccessToken(stored, persistRefresh);
    response = await request();
  }
  return response;
}

function authenticatedHttp(homeserver: string, stored: MatrixStoredSession, persistRefresh = true) {
  return async (path: string, body: string, method: "POST" | "PUT" = "POST"): Promise<string> => {
    const response = await authenticatedFetch(stored, `${homeserver.replace(/\/$/, "")}${path}`, {
      method,
      headers: { "content-type": "application/json" },
      body,
    }, persistRefresh);
    const text = await response.text();
    if (!response.ok) {
      let matrixError = "";
      try {
        const payload = JSON.parse(text) as { errcode?: unknown; error?: unknown };
        const code = typeof payload.errcode === "string" ? payload.errcode : "";
        const message = typeof payload.error === "string" ? describeMatrixCause(payload.error) : "";
        matrixError = [code, message].filter(Boolean).join(": ");
      } catch { /* Do not expose an unstructured server response body. */ }
      throw new MatrixConnectorError("DEVICE_KEYS_UPLOAD_FAILED", `Matrix device request ${path} failed with HTTP ${response.status}${matrixError ? ` (${matrixError})` : ""}.`);
    }
    return text || "{}";
  };
}

async function ensureMatrixController(
  locus: LocusClient | null,
  subject: ReturnType<typeof matrixOwnership>,
  controller: MatrixDeviceController,
  keys: MatrixDiscoveredKeys,
): Promise<void> {
  if (!locus) throw new MatrixConnectorError("CONTROLLER_NOT_AUTHORIZED", "The selected network is not ready for Matrix identity authorization");
  const proof = keys.encodedProof;
  if (!proof) throw new MatrixConnectorError("DEVICE_NOT_VERIFIED", "Verify this Matrix device before authorizing it for Locus");
  const scoped = locus.withSession({ signer: controller, subject });
  const controllerOwnership = await controller.getController();
  const proofDetails = await matrixProofDiagnostics(keys, subject, controllerOwnership, proof);
  const [bootstrapUsed, controllerGrant] = await Promise.all([
    scoped.hasMatrixBootstrapCompleted(subject),
    scoped.isControllerActive(subject, controllerOwnership),
  ]);
  if (bootstrapUsed && !controllerGrant) {
    throw new MatrixConnectorError("CONTROLLER_NOT_AUTHORIZED", `Matrix bootstrap is already marked complete, but this device has no active controller grant. bootstrapUsed=${bootstrapUsed}; controllerGrant=${controllerGrant}; ${proofDetails}`);
  }
  if (controllerGrant) {
    return;
  }
  let submitted: Awaited<ReturnType<typeof scoped.bootstrapMatrixController>> | null = null;
  let result: Awaited<ReturnType<typeof scoped.waitForAction>> | null = null;
  try {
    submitted = await scoped.bootstrapMatrixController(proof);
    result = await scoped.waitForAction(submitted.transactionId, { intervalMs: 500, timeoutMs: 180_000 });
    if (result.actionReceipt.status !== "applied") {
      throw new Error("JamScript reported a non-applied controller bootstrap action.");
    }
  } catch (cause) {
    const actionReceipt = result?.actionReceipt;
    const failureData = cause && typeof cause === "object"
      ? (cause as { data?: unknown }).data
      : undefined;
    const transaction = failureData && typeof failureData === "object"
      ? failureData as { status?: unknown; error?: unknown; actionReceipts?: unknown }
      : undefined;
    const rejectedReceipt = Array.isArray(transaction?.actionReceipts)
      ? transaction.actionReceipts.find((receipt) => receipt && typeof receipt === "object"
        && typeof (receipt as { actionHash?: unknown }).actionHash === "string"
        && (receipt as { actionHash: string }).actionHash.toLowerCase() === submitted?.actionHash.toLowerCase()) as { status?: unknown; errorCode?: unknown } | undefined
      : undefined;
    const errorCode = result?.errorCode ?? actionReceipt?.errorCode
      ?? (typeof rejectedReceipt?.errorCode === "number" ? rejectedReceipt.errorCode : null);
    const details = [
      `transactionId=${submitted?.transactionId ?? "not-submitted"}`,
      `actionHash=${submitted?.actionHash ?? "not-submitted"}`,
      `actionReceipt.status=${actionReceipt?.status ?? rejectedReceipt?.status ?? "not-received"}`,
      `errorCode=${errorCode ?? "none"}`,
      `transactionStatus=${result?.transactionStatus ?? (typeof transaction?.status === "string" ? transaction.status : "unknown")}`,
      `bootstrapUsed=${bootstrapUsed}`,
      `controllerGrant=${controllerGrant}`,
      proofDetails,
      ...(typeof transaction?.error === "string" ? [`transactionError=${describeMatrixCause(transaction.error)}`] : []),
    ].join("; ");
    throw new MatrixConnectorError(
      "CONTROLLER_BOOTSTRAP_FAILED",
      `Matrix controller bootstrap failed (${details}). ${describeMatrixCause(cause)}`,
      { cause },
    );
  }
}

export type MatrixConnected = {
  session: LocusWebSession;
  client: MatrixClient;
  crypto: MatrixCryptoDevice;
  keys: Awaited<ReturnType<typeof queryMatrixKeys>>;
  stored: MatrixStoredSession;
  state: MatrixConnectionState;
  verification: MatrixVerificationSnapshot | null;
  error: string;
  subscribe: (listener: () => void) => () => void;
  startVerification: () => Promise<void>;
  confirmVerification: (matches: boolean) => Promise<void>;
  cancelVerification: () => Promise<void>;
  retryControllerAuthorization: () => Promise<void>;
};

function sameBytes(left: Uint8Array, right: Uint8Array): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function hex(bytes: Uint8Array): string {
  return Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join("");
}

async function matrixProofDiagnostics(
  keys: MatrixDiscoveredKeys,
  subject: ReturnType<typeof matrixOwnership>,
  controller: Awaited<ReturnType<MatrixDeviceController["getController"]>>,
  proof: Uint8Array,
): Promise<string> {
  let proofHash = "unavailable";
  try {
    const proofBuffer = Uint8Array.from(proof).buffer;
    proofHash = hex(new Uint8Array(await globalThis.crypto.subtle.digest("SHA-256", proofBuffer)));
  } catch { /* Diagnostics must not block the authorization result. */ }
  let clientRoundtrip = false;
  try {
    clientRoundtrip = sameBytes(encodeMatrixControlClaimProofV1(decodeMatrixControlClaimProofV1(proof)), proof);
  } catch { /* The exact encoder/decoder failure is represented by false. */ }
  return [
    `deviceId=${keys.deviceId}`,
    `algorithms=${keys.algorithms.join(",")}`,
    `subjectEqualsMaster=${subject.kind === 0 && sameBytes(subject.public, keys.masterPublicKey)}`,
    `controllerEqualsDeviceEd25519=${controller.kind === 0 && sameBytes(controller.public, keys.deviceEd25519Key)}`,
    `masterPublicKey=0x${hex(keys.masterPublicKey)}`,
    `selfSigningPublicKey=0x${hex(keys.selfSigningPublicKey)}`,
    `deviceEd25519Key=0x${hex(keys.deviceEd25519Key)}`,
    `deviceCurve25519Key=0x${hex(keys.deviceCurve25519Key)}`,
    `encodedProof.length=${proof.length}`,
    `encodedProof.sha256=0x${proofHash}`,
    `clientProofRoundtrip=${clientRoundtrip}`,
    `encodedProof.hex=0x${hex(proof)}`,
  ].join("; ");
}

function throwIfAborted(signal?: AbortSignal): void {
  if (!signal?.aborted) return;
  const error = new Error("Matrix sign-in was cancelled.");
  error.name = "AbortError";
  throw error;
}

async function connectStoredMatrixSession(
  stored: MatrixStoredSession,
  options: MatrixConnectionOptions,
  persistRefresh: boolean,
  freshDevice: boolean,
): Promise<MatrixConnected> {
  throwIfAborted(options.signal);
  options.onState?.("AUTHENTICATED");
  const homeserver = stored.homeserver.replace(/\/$/, "");
  const client = createClient({ baseUrl: homeserver, accessToken: stored.accessToken, userId: stored.userId, deviceId: stored.deviceId });
  const cryptoDevice: { current: MatrixCryptoDevice | null } = { current: null };
  let cryptoSetupCommitted = false;
  try {
    const cryptoHttp = authenticatedHttp(homeserver, stored, persistRefresh);
    const authFetch = (input: RequestInfo | URL, init?: RequestInit) => authenticatedFetch(stored, input, init, persistRefresh);
    const { device, keys } = await commitMatrixSessionAfterCryptoSetup(stored, async () => {
      throwIfAborted(options.signal);
      const device = await MatrixCryptoDevice.initialize(stored.userId, stored.deviceId);
      cryptoDevice.current = device;
      const localDeviceId = device.machine.deviceId;
      let localDeviceIdText: string;
      try { localDeviceIdText = localDeviceId.toString(); }
      finally { localDeviceId.free(); }
      if (localDeviceIdText !== stored.deviceId) {
        throw new MatrixConnectorError("STALE_MATRIX_DEVICE", "The local Matrix crypto store belongs to a different device ID.");
      }
      if (!freshDevice) {
        const parity = await queryMatrixDeviceKeyParity(stored.userId, stored.deviceId, homeserver, stored.accessToken, device.localIdentityKeys, authFetch);
        if (parity.status !== "match") {
          throw new MatrixConnectorError("STALE_MATRIX_DEVICE", `The saved Matrix device is stale (${parity.status}); its server and local crypto keys do not match.`);
        }
      }
      throwIfAborted(options.signal);
      await device.flushRequests(cryptoHttp);
      const parity = await queryMatrixDeviceKeyParity(stored.userId, stored.deviceId, homeserver, stored.accessToken, device.localIdentityKeys, authFetch);
      if (parity.status !== "match") {
        throw new MatrixConnectorError("STALE_MATRIX_DEVICE", `Matrix did not retain the new device key pair (${parity.status}).`);
      }
      const keys = await queryMatrixKeys(stored.userId, stored.deviceId, homeserver, stored.accessToken, authFetch);
      throwIfAborted(options.signal);
      options.onState?.("DEVICE_KEYS_READY");
      device.startSync(homeserver, authFetch, cryptoHttp);
      return { device, keys };
    });
    cryptoSetupCommitted = true;
    throwIfAborted(options.signal);
    const controller = new MatrixDeviceController(keys.deviceEd25519Key, { sign: (message) => device.sign(message) });
    const owner = matrixOwnership(keys.masterPublicKey);
    if (keys.verification === "verified" && options.locus) {
      options.onState?.("VERIFIED");
      options.onState?.("CONTROLLER_BOOTSTRAPPING");
      await ensureMatrixController(options.locus, owner, controller, keys);
    } else if (keys.verification === "pending") {
      options.onState?.("VERIFICATION_REQUIRED");
    } else options.onState?.("VERIFIED");
    return await makeConnected(stored, client, device, keys, controller, options.locus, options);
  } catch (cause) {
    try { cryptoDevice.current?.dispose(); } catch { /* Preserve the original connection error. */ }
    client.stopClient();
    if (freshDevice && (!cryptoSetupCommitted || options.signal?.aborted)) {
      clearMatrixDeviceId(stored.homeserver, stored.userId, stored.deviceId);
      try { await destroyMatrixCryptoStore(stored.userId, stored.deviceId); } catch { /* A failed fresh store is never reused because new auth allocates a new ID. */ }
      if (options.signal?.aborted && readStoredMatrixSession()?.deviceId === stored.deviceId) clearStoredMatrixSession();
      try { await revokeMatrixOAuthSession(stored, false); } catch { /* Keep the setup error as the actionable failure. */ }
    }
    throw cause;
  }
}

async function makeConnected(
  stored: MatrixStoredSession,
  client: MatrixClient,
  crypto: MatrixCryptoDevice,
  keys: Awaited<ReturnType<typeof queryMatrixKeys>>,
  controller: MatrixDeviceController,
  locus: LocusClient | null,
  options: MatrixConnectionOptions,
): Promise<MatrixConnected> {
  const owner = matrixOwnership(keys.masterPublicKey);
  const currentController = await controller.getController();
  const listeners = new Set<() => void>();
  let disposed = false;
  let checkingProof = false;
  let unsubscribeCrypto: () => void = () => {};
  let unsubscribeSyncError: () => void = () => {};
  const initialVerification = crypto.currentVerification;
  const initialState: MatrixConnectionState = keys.verification === "verified"
    ? (locus ? "READY" : "VERIFIED")
    : initialVerification?.phase === "sas-ready" ? "VERIFICATION_SAS_READY"
      : initialVerification ? "VERIFICATION_REQUESTED" : "VERIFICATION_REQUIRED";
  const session: LocusWebSession = {
    kind: "matrix",
    owner,
    controller: currentController,
    ownershipSession: { signer: controller, subject: owner },
    label: `Matrix ${stored.userId}`,
    address: stored.userId,
    connectionId: `${stored.homeserver}|${stored.userId}|${stored.deviceId}`,
    matrix: { userId: stored.userId, deviceId: stored.deviceId, homeserver: stored.homeserver },
    cleanup: () => {
      if (disposed) return;
      disposed = true;
      unsubscribeCrypto();
      unsubscribeSyncError();
      crypto.dispose();
      client.stopClient();
    },
  };
  const connected: MatrixConnected = {
    session,
    client,
    crypto,
    keys,
    stored,
    state: initialState,
    verification: initialVerification,
    error: "",
    subscribe: (listener) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
    startVerification: async () => {
      if (!connected.verification) throw new MatrixConnectorError("MATRIX_VERIFICATION_FAILED", "Waiting for an incoming verification request from Element.");
      await crypto.startVerification(connected.verification.flowId, authenticatedHttp(stored.homeserver, stored));
    },
    confirmVerification: async (matches) => {
      if (!connected.verification) throw new MatrixConnectorError("MATRIX_VERIFICATION_FAILED", "There is no active Matrix verification to confirm.");
      await crypto.confirmVerification(connected.verification.flowId, matches, authenticatedHttp(stored.homeserver, stored));
    },
    cancelVerification: async () => {
      if (!connected.verification) return;
      await crypto.cancelVerification(connected.verification.flowId, authenticatedHttp(stored.homeserver, stored));
    },
    retryControllerAuthorization: async () => {
      if (disposed) throw new MatrixConnectorError("CONTROLLER_NOT_AUTHORIZED", "The Matrix session was disconnected. Reconnect before retrying authorization.");
      connected.error = "";
      setState("CONTROLLER_BOOTSTRAPPING");
      try {
        const refreshed = await queryMatrixKeys(
          stored.userId,
          stored.deviceId,
          stored.homeserver,
          stored.accessToken,
          (input, init) => authenticatedFetch(stored, input, init),
        );
        if (!sameBytes(refreshed.deviceEd25519Key, connected.keys.deviceEd25519Key)) {
          throw new MatrixConnectorError("STALE_MATRIX_DEVICE", "The Matrix device key changed during verification. Sign in again to create a new device.");
        }
        connected.keys = refreshed;
        if (refreshed.verification !== "verified" || refreshed.selfSigningSignature === null) {
          throw new MatrixConnectorError("DEVICE_NOT_VERIFIED", "Matrix has not published the completed M → S → D verification proof yet. Wait briefly, then retry.");
        }
        await ensureMatrixController(locus, owner, controller, refreshed);
        if (!disposed) setState("READY");
      } catch (cause) {
        if (!disposed) {
          connected.error = cause instanceof Error ? cause.message : "Locus could not authorize this Matrix device.";
          setState("CONTROLLER_AUTHORIZATION_FAILED");
        }
        throw cause;
      }
    },
  };

  const notify = () => { for (const listener of listeners) listener(); };
  const setState = (state: MatrixConnectionState) => {
    connected.state = state;
    options.onState?.(state);
    notify();
  };
  unsubscribeSyncError = crypto.subscribeSyncError((message) => {
    if (disposed) return;
    connected.error = message;
    notify();
  });
  const verifyPublishedProof = async (): Promise<void> => {
    if (checkingProof || disposed || connected.keys.verification === "verified") return;
    checkingProof = true;
    try {
      for (let attempt = 0; attempt < 10 && !disposed; attempt += 1) {
        const refreshed = await queryMatrixKeys(
          stored.userId,
          stored.deviceId,
          stored.homeserver,
          stored.accessToken,
          (input, init) => authenticatedFetch(stored, input, init),
        );
        if (!sameBytes(refreshed.deviceEd25519Key, connected.keys.deviceEd25519Key)) {
          throw new MatrixConnectorError("STALE_MATRIX_DEVICE", "The Matrix device key changed during verification. Sign in again to create a new device.");
        }
        connected.keys = refreshed;
        if (refreshed.verification === "verified" && refreshed.selfSigningSignature !== null) {
          setState("VERIFIED");
          if (locus) {
            connected.error = "";
            setState("CONTROLLER_BOOTSTRAPPING");
            await ensureMatrixController(locus, owner, controller, refreshed);
            if (!disposed) setState("READY");
          }
          return;
        }
        if (attempt < 9) await new Promise((resolve) => window.setTimeout(resolve, 1_500));
      }
      throw new MatrixConnectorError("DEVICE_NOT_VERIFIED", "Element completed SAS verification, but Matrix has not published the M → S → D proof yet. Wait briefly, then retry.");
    } catch (cause) {
      if (!disposed) {
        connected.error = cause instanceof Error ? cause.message : "Could not confirm the Matrix cross-signing proof.";
        setState("CONTROLLER_AUTHORIZATION_FAILED");
      }
    } finally { checkingProof = false; }
  };
  unsubscribeCrypto = crypto.subscribeVerification((snapshot) => {
    if (disposed) return;
    connected.verification = snapshot;
    if (connected.state === "CONTROLLER_BOOTSTRAPPING" || connected.state === "CONTROLLER_AUTHORIZATION_FAILED") {
      notify();
      return;
    }
    connected.error = "";
    if (connected.keys.verification !== "verified") {
      if (!snapshot) setState("VERIFICATION_REQUIRED");
      else if (snapshot.phase === "sas-ready") setState("VERIFICATION_SAS_READY");
      else if (snapshot.phase === "confirming" || snapshot.phase === "done") setState("VERIFICATION_CONFIRMING");
      else if (snapshot.phase === "cancelled") setState("VERIFICATION_REQUIRED");
      else setState("VERIFICATION_REQUESTED");
      if (snapshot?.phase === "done") void verifyPublishedProof();
    } else notify();
    notify();
  });
  options.onState?.(initialState);
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
    const deviceId = matrixDeviceId(homeserver, userId);
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
    authType: "legacy",
  };
  return connectStoredMatrixSession(stored, options, false, true);
}

export async function connectMatrixTokenSession(stored: MatrixStoredSession, options: MatrixConnectionOptions = { locus: null }): Promise<MatrixConnected> {
  return connectStoredMatrixSession(stored, options, false, true);
}

export async function restoreMatrixSession(
  stored: MatrixStoredSession,
  options: MatrixConnectionOptions = { locus: null },
): Promise<MatrixConnected> {
  if (committedMatrixDeviceId(stored.homeserver, stored.userId) !== stored.deviceId) {
    await retireStaleMatrixDevice(stored);
    throw new MatrixConnectorError("STALE_MATRIX_DEVICE", "The saved Matrix session and committed device ID do not match. The old device was retired; sign in again to create a fresh Locus device.");
  }
  await ensureFreshMatrixToken(stored);
  try { return await connectStoredMatrixSession(stored, options, true, false); }
  catch (cause) {
    if (!(cause instanceof MatrixConnectorError) || cause.code !== "STALE_MATRIX_DEVICE") throw cause;
    await retireStaleMatrixDevice(stored);
    throw new MatrixConnectorError("STALE_MATRIX_DEVICE", "The saved Matrix device no longer matches its server keys. Its local crypto store was retired; sign in again to create a fresh Locus device.", { cause });
  }
}

export function readStoredMatrixSession(): MatrixStoredSession | null {
  const localValue = window.localStorage.getItem(MATRIX_SESSION_KEY);
  const sessionValue = window.sessionStorage.getItem(MATRIX_SESSION_KEY);
  for (const value of [localValue, sessionValue]) {
    if (!value) continue;
    try {
      const stored = JSON.parse(value) as Partial<MatrixStoredSession>;
      if (typeof stored.accessToken !== "string" || typeof stored.userId !== "string" || typeof stored.deviceId !== "string" || typeof stored.homeserver !== "string") continue;
      const restored: MatrixStoredSession = { ...(stored as MatrixStoredSession), authType: stored.authType === "oauth" ? "oauth" : "legacy" };
      if (value === sessionValue && value !== localValue) window.localStorage.setItem(MATRIX_SESSION_KEY, JSON.stringify(restored));
      return restored;
    } catch { /* Try the other storage location before reporting no session. */ }
  }
  return null;
}

export function clearStoredMatrixSession(): void {
  window.localStorage.removeItem(MATRIX_SESSION_KEY);
  window.sessionStorage.removeItem(MATRIX_SESSION_KEY);
}

async function retireStaleMatrixDevice(stored: MatrixStoredSession): Promise<void> {
  clearStoredMatrixSession();
  clearMatrixDeviceId(stored.homeserver, stored.userId, stored.deviceId);
  try { await destroyMatrixCryptoStore(stored.userId, stored.deviceId); } catch { /* The old key pair is no longer reused even if another tab blocks deletion. */ }
  try { await ensureFreshMatrixToken(stored, false); } catch { /* Still attempt logout and OAuth revocation with the saved credentials. */ }
  try { await revokeMatrixOAuthSession(stored); } catch { /* Local retirement is authoritative; remote revocation can be retried separately. */ }
}

export async function signOutMatrixSession(storedOverride?: MatrixStoredSession | null): Promise<void> {
  const stored = storedOverride ?? readStoredMatrixSession();
  clearStoredMatrixSession();
  if (!stored) {
    for (const key of Object.keys(window.localStorage)) if (key.startsWith("locus.matrix.device.v1.")) window.localStorage.removeItem(key);
    for (const key of Object.keys(window.sessionStorage)) if (key.startsWith("locus.matrix.device.v1.")) window.sessionStorage.removeItem(key);
    return;
  }
  clearMatrixDeviceId(stored.homeserver, stored.userId, stored.deviceId);
  let storeError: unknown;
  try { await destroyMatrixCryptoStore(stored.userId, stored.deviceId); }
  catch (cause) { storeError = cause; }
  try { await ensureFreshMatrixToken(stored, false); } catch { /* Continue to attempt server logout and token revocation. */ }
  let logoutError: unknown;
  try { await revokeMatrixOAuthSession(stored); }
  catch (cause) { logoutError = cause; }
  if (storeError || logoutError) {
    const detail = [storeError, logoutError].filter(Boolean).map((cause) => cause instanceof Error ? cause.message : "Matrix sign-out cleanup failed").join("; ");
    throw new MatrixConnectorError("OAUTH_FAILED", `Matrix was disconnected locally, but sign-out cleanup needs attention. ${detail}`);
  }
}

export async function revokeStoredMatrixSession(): Promise<void> {
  await signOutMatrixSession();
}
