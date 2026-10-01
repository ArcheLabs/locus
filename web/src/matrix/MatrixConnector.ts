import { createClient, type MatrixClient } from "matrix-js-sdk";
import { MatrixDeviceController, ownershipKey } from "@jamscript/client";
import { matrixOwnership, type LocusClient } from "@archelabs/locus";
import type { LocusWebSession } from "../session/types.js";
import type { AccountAuthorizationState, LocusAuthorizationScope, SessionAccessSnapshot, SessionAccessController } from "../session/types.js";
import { describeMatrixCause, matrixControllerReceiptFailure, MatrixConnectorError } from "./MatrixErrors.js";
import { destroyMatrixCryptoStore, MatrixCryptoDevice, type MatrixVerificationSnapshot } from "./MatrixCryptoDevice.js";
import { queryMatrixDeviceKeyParity, queryMatrixKeys, type MatrixDiscoveredKeys } from "./MatrixKeysQuery.js";
import { createMatrixDeviceTrustMonitor, type MatrixDeviceTrustSnapshot } from "./MatrixDeviceTrust.js";
import { classifyMatrixProofFailure, missingMatrixProof, retryMatrixProofPreparation } from "./MatrixProofRetry.js";
import { clearMatrixDeviceId, commitMatrixSessionAfterCryptoSetup, committedMatrixDeviceId, refreshMatrixOAuthToken, revokeMatrixOAuthSession, type MatrixOAuthSession } from "./MatrixOAuth.js";
import { authenticateMatrixPassword } from "./MatrixPasswordLogin.js";

export type MatrixStoredSession = MatrixOAuthSession;

export type MatrixConnectionState =
  | "AUTHENTICATED"
  | "DEVICE_KEYS_READY"
  | "TRUST_CHECKING"
  | "TRUST_UNKNOWN"
  | "VERIFICATION_REQUIRED"
  | "VERIFICATION_REQUESTED"
  | "VERIFICATION_SAS_READY"
  | "VERIFICATION_CONFIRMING"
  | "CONNECTED"
  | "RELOGIN_REQUIRED"
  ;

export type MatrixConnectionOptions = {
  locus: LocusClient | null;
  onState?: (state: MatrixConnectionState) => void;
  signal?: AbortSignal;
};

const MATRIX_SESSION_KEY = "locus.matrix.session.v1";
const MATRIX_AUTHORIZATION_PENDING_KEY = "locus.matrix-controller-authorization.v2";
let matrixConnectionAttemptSequence = 0;

class MatrixControllerAuthorizationWaitTimeout extends Error {
  constructor(readonly transactionId: string, readonly lastStatus?: Awaited<ReturnType<LocusClient["transactionStatus"]>>) {
    super(`timed out waiting for Matrix controller authorization ${transactionId}${lastStatus ? ` (last status: ${lastStatus.status})` : ""}`);
    this.name = "MatrixControllerAuthorizationWaitTimeout";
  }
}

type PendingMatrixControllerAuthorization = {
  version: 3;
  transactionId: string;
  actionHash: string;
  subjectKey: string;
  controllerKey: string;
  deviceId: string;
  scopeKey: string;
  networkId: string;
  networkDomain: string;
  serviceId: number;
  submittedSlot: number;
  validUntil: number;
  submittedAt: number;
};

type MatrixAuthorizationIntent = {
  subjectKey: string;
  controllerKey: string;
  deviceId: string;
  scopeKey: string;
  networkId: string;
  networkDomain: string;
  serviceId: number;
  createdAt: number;
};

type PendingMatrixControllerAuthorizationStore = {
  version: 3;
  pending: PendingMatrixControllerAuthorization[];
  intents: MatrixAuthorizationIntent[];
  legacy: Omit<PendingMatrixControllerAuthorization, "version" | "scopeKey" | "networkId" | "networkDomain" | "serviceId">[];
};

function matrixOwnershipKeyHex(owner: ReturnType<typeof matrixOwnership>): string {
  return Array.from(ownershipKey(owner), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function matrixReloginMessage(cause: unknown): string {
  if (!(cause instanceof MatrixConnectorError)) return "当前 Matrix 登录状态不可用，请重新登录。";
  switch (cause.code) {
    case "MATRIX_SESSION_INVALID": return "Matrix 登录已过期，请重新登录。";
    case "MATRIX_IDENTITY_CHANGED": return "Matrix 主密钥已更改，请重新登录。";
    case "MATRIX_DEVICE_REVOKED": return "此 Matrix 设备已被移除或撤销，请重新登录。";
    case "OWNERSHIP_PROOF_INVALID": return "Matrix 设备授权证明无效，请重新登录。";
    case "CONTROLLER_REVOKED": return "此 Matrix 设备已断开授权，请重新登录。";
    default: return "当前 Matrix 登录状态不可用，请重新登录。";
  }
}

type LegacyMatrixAuthorization = Omit<PendingMatrixControllerAuthorization, "version" | "scopeKey" | "networkId" | "networkDomain" | "serviceId">;

function readPendingMatrixControllerAuthorizations(): PendingMatrixControllerAuthorizationStore {
  const value = window.localStorage.getItem(MATRIX_AUTHORIZATION_PENDING_KEY);
  if (!value) return { version: 3, pending: [], intents: [], legacy: [] };
  let parsed: { version?: unknown; pending?: unknown; intents?: unknown; legacy?: unknown };
  try { parsed = JSON.parse(value) as typeof parsed; }
  catch (cause) { throw new MatrixConnectorError("CONTROLLER_NOT_AUTHORIZED", "Saved Matrix authorization recovery data is malformed; it was kept for inspection.", { cause }); }
  const validLegacy = (item: LegacyMatrixAuthorization) => typeof item.transactionId === "string" && typeof item.actionHash === "string"
    && typeof item.subjectKey === "string" && typeof item.controllerKey === "string" && typeof item.deviceId === "string"
    && Number.isSafeInteger(item.submittedSlot) && Number.isSafeInteger(item.validUntil) && Number.isFinite(item.submittedAt);
  if (parsed.version === 2 && Array.isArray(parsed.pending) && parsed.pending.every((item) => item && typeof item === "object" && validLegacy(item as LegacyMatrixAuthorization))) {
    return { version: 3, pending: [], intents: [], legacy: parsed.pending as LegacyMatrixAuthorization[] };
  }
  if (parsed.version !== 3 || !Array.isArray(parsed.pending) || !Array.isArray(parsed.legacy)
    || parsed.pending.some((item) => !item || typeof item !== "object" || (item as PendingMatrixControllerAuthorization).version !== 3
      || !validLegacy(item as LegacyMatrixAuthorization) || typeof (item as PendingMatrixControllerAuthorization).scopeKey !== "string"
      || typeof (item as PendingMatrixControllerAuthorization).networkId !== "string" || typeof (item as PendingMatrixControllerAuthorization).networkDomain !== "string"
      || !Number.isSafeInteger((item as PendingMatrixControllerAuthorization).serviceId))
    || parsed.legacy.some((item) => !item || typeof item !== "object" || !validLegacy(item as LegacyMatrixAuthorization))
    || (parsed.intents !== undefined && (!Array.isArray(parsed.intents) || parsed.intents.some((item) => !item || typeof item !== "object"
      || typeof (item as MatrixAuthorizationIntent).subjectKey !== "string" || typeof (item as MatrixAuthorizationIntent).controllerKey !== "string"
      || typeof (item as MatrixAuthorizationIntent).deviceId !== "string" || typeof (item as MatrixAuthorizationIntent).scopeKey !== "string"
      || typeof (item as MatrixAuthorizationIntent).networkId !== "string" || typeof (item as MatrixAuthorizationIntent).networkDomain !== "string"
      || !Number.isSafeInteger((item as MatrixAuthorizationIntent).serviceId) || !Number.isFinite((item as MatrixAuthorizationIntent).createdAt))))) {
    throw new MatrixConnectorError("CONTROLLER_NOT_AUTHORIZED", "Saved Matrix authorization recovery data is invalid; it was kept for inspection.");
  }
  return { version: 3, pending: parsed.pending as PendingMatrixControllerAuthorization[], intents: (parsed.intents ?? []) as MatrixAuthorizationIntent[], legacy: parsed.legacy as LegacyMatrixAuthorization[] };
}

function savePendingMatrixControllerAuthorization(record: PendingMatrixControllerAuthorization): void {
  const saved = readPendingMatrixControllerAuthorizations();
  const identity = `${record.scopeKey}:${record.subjectKey}:${record.controllerKey}:${record.deviceId}`;
  const filtered = saved.pending.filter((item) => `${item.scopeKey}:${item.subjectKey}:${item.controllerKey}:${item.deviceId}` !== identity);
  const intents = saved.intents.filter((item) => `${item.scopeKey}:${item.subjectKey}:${item.controllerKey}:${item.deviceId}` !== identity);
  filtered.push(record);
  window.localStorage.setItem(MATRIX_AUTHORIZATION_PENDING_KEY, JSON.stringify({ version: 3, pending: filtered, intents, legacy: saved.legacy } satisfies PendingMatrixControllerAuthorizationStore));
}

function saveMatrixAuthorizationIntent(intent: MatrixAuthorizationIntent): void {
  const saved = readPendingMatrixControllerAuthorizations();
  const identity = `${intent.scopeKey}:${intent.subjectKey}:${intent.controllerKey}:${intent.deviceId}`;
  const intents = saved.intents.filter((item) => `${item.scopeKey}:${item.subjectKey}:${item.controllerKey}:${item.deviceId}` !== identity);
  intents.push(intent);
  window.localStorage.setItem(MATRIX_AUTHORIZATION_PENDING_KEY, JSON.stringify({ version: 3, pending: saved.pending, intents, legacy: saved.legacy } satisfies PendingMatrixControllerAuthorizationStore));
}

function removePendingMatrixControllerAuthorization(record: Pick<PendingMatrixControllerAuthorization, "subjectKey" | "controllerKey" | "deviceId" | "scopeKey">): void {
  const saved = readPendingMatrixControllerAuthorizations();
  const identity = `${record.scopeKey}:${record.subjectKey}:${record.controllerKey}:${record.deviceId}`;
  const filtered = saved.pending.filter((item) => `${item.scopeKey}:${item.subjectKey}:${item.controllerKey}:${item.deviceId}` !== identity);
  const intents = saved.intents.filter((item) => `${item.scopeKey}:${item.subjectKey}:${item.controllerKey}:${item.deviceId}` !== identity);
  if (filtered.length === 0 && intents.length === 0 && saved.legacy.length === 0) window.localStorage.removeItem(MATRIX_AUTHORIZATION_PENDING_KEY);
  else window.localStorage.setItem(MATRIX_AUTHORIZATION_PENDING_KEY, JSON.stringify({ version: 3, pending: filtered, intents, legacy: saved.legacy } satisfies PendingMatrixControllerAuthorizationStore));
}

function pendingMatrixControllerAuthorizationFor(
  records: PendingMatrixControllerAuthorization[],
  subjectKey: string,
  controllerKey: string,
  deviceId: string,
  scopeKey: string,
): PendingMatrixControllerAuthorization | undefined {
  return records.find((item) => item.subjectKey === subjectKey && item.controllerKey === controllerKey && item.deviceId === deviceId && item.scopeKey === scopeKey);
}

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
  if (!stored.refreshToken) throw new MatrixConnectorError("MATRIX_SESSION_INVALID", "The Matrix session has expired. Sign in again.");
  if (stored.authType === "oauth") {
    try { await refreshMatrixOAuthToken(stored, persist); }
    catch (cause) {
      if (cause instanceof MatrixConnectorError && cause.code === "MATRIX_SESSION_INVALID") throw cause;
      throw new MatrixConnectorError("TOKEN_REFRESH_FAILED", "Matrix OAuth token refresh failed. Sign in again if the session has expired.", { cause });
    }
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
  let payload: MatrixTokenResponse & { errcode?: string; error?: string; retry_after_ms?: number } = {};
  try { payload = await response.json() as typeof payload; } catch (cause) {
    throw new MatrixConnectorError("TOKEN_REFRESH_FAILED", "Matrix token refresh returned invalid JSON", { cause });
  }
  if (!response.ok || typeof payload.access_token !== "string") {
    if (response.status === 401 || payload.errcode === "M_UNKNOWN_TOKEN" || payload.errcode === "M_MISSING_TOKEN") {
      throw new MatrixConnectorError("MATRIX_SESSION_INVALID", "The Matrix session is no longer valid. Sign in again.");
    }
    if (response.status === 429) {
      throw new MatrixConnectorError("TOKEN_REFRESH_FAILED", "Matrix token refresh was rate limited. Retry after the server's delay.", {
        retryAfterMs: typeof payload.retry_after_ms === "number" ? payload.retry_after_ms : undefined,
      });
    }
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
  if (response.status === 401) throw new MatrixConnectorError("MATRIX_SESSION_INVALID", "The Matrix session is no longer valid. Sign in again.");
  if (response.status === 403) {
    const payload = await response.clone().json().catch(() => ({})) as { errcode?: unknown };
    if (payload.errcode === "M_UNKNOWN_TOKEN" || payload.errcode === "M_MISSING_TOKEN") {
      throw new MatrixConnectorError("MATRIX_SESSION_INVALID", "The Matrix session is no longer valid. Sign in again.");
    }
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
  scope: LocusAuthorizationScope,
  subject: ReturnType<typeof matrixOwnership>,
  controller: MatrixDeviceController,
  loadKeys: () => Promise<MatrixDiscoveredKeys>,
  deviceId: string,
  onProgress: (state: AccountAuthorizationState) => void,
  isSessionActive: () => boolean,
): Promise<boolean> {
  const locus = scope.locus;
  const scoped = locus.withSession({ signer: controller, subject });
  const controllerOwnership = await controller.getController();
  const subjectKey = matrixOwnershipKeyHex(subject);
  const controllerKey = matrixOwnershipKeyHex(controllerOwnership);
  const pendingIdentity = { subjectKey, controllerKey, deviceId, scopeKey: scope.key };
  const status = await scoped.getControllerStatus(subject, controllerOwnership);
  if (status === "revoked") {
    removePendingMatrixControllerAuthorization(pendingIdentity);
    throw new MatrixConnectorError(
      "CONTROLLER_REVOKED",
      "This Locus Matrix controller was previously revoked. Sign in as a new Matrix device or use another active controller.",
    );
  }
  if (status === "active") {
    removePendingMatrixControllerAuthorization(pendingIdentity);
    return true;
  }
  const settlePending = async (pending: PendingMatrixControllerAuthorization): Promise<"ready" | "expired" | "unknown"> => {
    const deadline = Date.now() + 180_000;
    let lastStatus: Awaited<ReturnType<typeof locus.transactionStatus>> | undefined;
    const inspectChainAuthorization = async (): Promise<"ready" | "not-ready"> => {
      const state = await scoped.getControllerStatus(subject, controllerOwnership);
      if (state === "active") {
        removePendingMatrixControllerAuthorization(pendingIdentity);
        return "ready";
      }
      if (state === "revoked") {
        removePendingMatrixControllerAuthorization(pendingIdentity);
        throw new MatrixConnectorError(
          "CONTROLLER_REVOKED",
          "This Locus Matrix controller was previously revoked. Sign in as a new Matrix device or use another active controller.",
        );
      }
      return "not-ready";
    };
    const expiredBeforeDispatch = async (): Promise<boolean> => {
      const context = await locus.finalizedContext();
      if (context.slot <= pending.validUntil) return false;
      const chainState = await inspectChainAuthorization();
      if (chainState === "ready") return false;
      removePendingMatrixControllerAuthorization(pendingIdentity);
      return true;
    };

    while (Date.now() < deadline) {
      if (!isSessionActive()) return "unknown";
      try {
        const status = await locus.transactionStatus(pending.transactionId);
        lastStatus = status;
        if (status.status === "failed") {
          removePendingMatrixControllerAuthorization(pendingIdentity);
          throw new MatrixConnectorError("CONTROLLER_NOT_AUTHORIZED", `Locus could not dispatch the Matrix controller authorization: ${status.error ?? "transaction failed"}. Retry after checking the connection.`);
        }
        if (status.status === "queued") {
          onProgress("QUEUED");
          if (!status.packageHash && status.actionIndex === null && await expiredBeforeDispatch()) return "expired";
        } else {
          onProgress("CONFIRMING");
        }
        if (status.status === "imported") {
          const receipt = status.actionIndex === null ? undefined : status.actionReceipts?.[status.actionIndex];
          if (receipt && receipt.actionHash.toLowerCase() !== pending.actionHash.toLowerCase()) {
            removePendingMatrixControllerAuthorization(pendingIdentity);
            throw new MatrixConnectorError("CONTROLLER_NOT_AUTHORIZED", "The finalized transaction receipt did not match the saved Matrix authorization action.");
          }
          if (receipt && receipt.status !== "applied") {
            removePendingMatrixControllerAuthorization(pendingIdentity);
            throw matrixControllerReceiptFailure(receipt.errorCode);
          }
          if (receipt?.status === "applied" && await inspectChainAuthorization() === "ready") return "ready";
        }
      } catch (cause) {
        const code = cause && typeof cause === "object" ? (cause as { code?: unknown }).code : undefined;
        const message = cause instanceof Error ? cause.message.toLowerCase() : "";
        const notFound = code === -32013 || message.includes("transaction not found") || message.includes("work not found");
        if (cause instanceof MatrixConnectorError) throw cause;
        if (!notFound) onProgress("STATUS_UNKNOWN");
        if (notFound && await inspectChainAuthorization() === "ready") return "ready";
        if (notFound && await expiredBeforeDispatch()) return "expired";
      }
      if (Date.now() >= deadline) break;
      await new Promise<void>((resolve) => {
        let settled = false;
        const finish = () => {
          if (settled) return;
          settled = true;
          window.clearTimeout(timer);
          window.clearInterval(cancellationPoll);
          document.removeEventListener("visibilitychange", onVisibilityChange);
          resolve();
        };
        const onVisibilityChange = () => { if (document.visibilityState === "visible") finish(); };
        const timer = window.setTimeout(finish, document.visibilityState === "hidden" ? 15_000 : 2_000);
        const cancellationPoll = window.setInterval(() => { if (!isSessionActive()) finish(); }, 1_000);
        document.addEventListener("visibilitychange", onVisibilityChange);
      });
    }
    onProgress("STATUS_UNKNOWN");
    throw new MatrixControllerAuthorizationWaitTimeout(pending.transactionId, lastStatus);
  };

  const saved = readPendingMatrixControllerAuthorizations();
  if (saved.legacy.some((item) => item.subjectKey === subjectKey && item.controllerKey === controllerKey && item.deviceId === deviceId)) {
    throw new MatrixConnectorError("CONTROLLER_RECOVERY_AMBIGUOUS", "An older authorization request has no network or Service scope. It was preserved and will not be submitted again automatically.");
  }
  if (saved.intents.some((item) => item.subjectKey === subjectKey && item.controllerKey === controllerKey && item.deviceId === deviceId && item.scopeKey === scope.key)) {
    throw new MatrixConnectorError("CONTROLLER_SUBMISSION_UNKNOWN", "A previous authorization submission has no transaction reference. Its recovery marker was preserved; Locus will not submit a duplicate request.");
  }
  const pendingRecord = pendingMatrixControllerAuthorizationFor(saved.pending, subjectKey, controllerKey, deviceId, scope.key);
  if (pendingRecord) {
    onProgress("CONFIRMING");
    try {
      const outcome = await settlePending(pendingRecord);
      if (outcome === "ready") return true;
      // Only a transaction confirmed absent from the chain and past its signed
      // validity slot can be replaced with one fresh submission.
    } catch (cause) {
      if (cause instanceof MatrixControllerAuthorizationWaitTimeout) return false;
      throw cause;
    }
  }

  if (!isSessionActive()) return false;
  const keys = await loadKeys();
  if (!isSessionActive()) return false;
  const proof = keys.encodedProof;
  if (!proof) throw missingMatrixProof();
  const beforeSubmit = await locus.finalizedContext();
  // Persist an ambiguity marker before calling the Service. If the request
  // succeeds but the response or transaction ID is lost, a later retry must
  // query chain state and must never blindly submit a duplicate.
  saveMatrixAuthorizationIntent({
    subjectKey,
    controllerKey,
    deviceId,
    scopeKey: scope.key,
    networkId: scope.networkId,
    networkDomain: scope.networkDomain,
    serviceId: scope.serviceId,
    createdAt: Date.now(),
  });
  onProgress("SUBMITTING");
  let submitted: Awaited<ReturnType<typeof scoped.authorizeMatrixController>>;
  try {
    submitted = await scoped.authorizeMatrixController(proof);
  } catch (cause) {
    throw new MatrixConnectorError("CONTROLLER_SUBMISSION_UNKNOWN", "The authorization request may have been accepted. Its recovery marker was kept, and no duplicate request will be sent automatically.", { cause });
  }
  const submittedWithValidity = submitted as typeof submitted & { submittedSlot?: number; validUntil?: number };
  const submittedSlot = submittedWithValidity.submittedSlot ?? beforeSubmit.slot;
  const pending: PendingMatrixControllerAuthorization = {
    version: 3,
    transactionId: submitted.transactionId,
    actionHash: submitted.actionHash,
    subjectKey,
    controllerKey,
    deviceId,
    scopeKey: scope.key,
    networkId: scope.networkId,
    networkDomain: scope.networkDomain,
    serviceId: scope.serviceId,
    submittedSlot,
    validUntil: submittedWithValidity.validUntil ?? submittedSlot + 64,
    submittedAt: Date.now(),
  };
  try {
    savePendingMatrixControllerAuthorization(pending);
  } catch (cause) {
    throw new MatrixConnectorError("CONTROLLER_SUBMISSION_UNKNOWN", "The authorization was submitted, but its transaction reference could not be saved. The recovery marker was kept to prevent a duplicate request.", { cause });
  }
  try {
    const outcome = await settlePending(pending);
    return outcome === "ready";
  } catch (cause) {
    if (cause instanceof MatrixControllerAuthorizationWaitTimeout) return false;
    throw cause;
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
  freshDevice: boolean;
  subscribe: (listener: () => void) => () => void;
  requestOwnUserVerification: () => Promise<void>;
  startVerification: () => Promise<void>;
  confirmVerification: (matches: boolean) => Promise<void>;
  cancelVerification: () => Promise<void>;
  refreshDeviceTrust: () => Promise<MatrixDeviceTrustSnapshot>;
  retryControllerAuthorization: () => Promise<void>;
};

function sameBytes(left: Uint8Array, right: Uint8Array): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
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
      device.setExpectedTrustKeys(keys.masterPublicKey, keys.deviceEd25519Key);
      options.onState?.("DEVICE_KEYS_READY");
      // Start SDK sync before the trust monitor's first read. Trust must be
      // based on SDK state after the initial sync has been applied.
      device.startSync(homeserver, authFetch, cryptoHttp);
      return { device, keys };
    });
    cryptoSetupCommitted = true;
    throwIfAborted(options.signal);
    const controller = new MatrixDeviceController(keys.deviceEd25519Key, { sign: (message) => device.sign(message) });
    return await makeConnected(stored, client, device, keys, controller, options.locus, options, freshDevice);
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
  _locus: LocusClient | null,
  options: MatrixConnectionOptions,
  freshDevice: boolean,
): Promise<MatrixConnected> {
  const owner = matrixOwnership(keys.masterPublicKey);
  const currentController = await controller.getController();
  const listeners = new Set<() => void>();
  const securityListeners = new Set<(message: string) => void>();
  const accessListeners = new Set<(snapshot: SessionAccessSnapshot) => void>();
  const authorizationByScope = new Map<string, SessionAccessSnapshot>();
  const authorizationTasks = new Map<string, Promise<void>>();
  let disposed = false;
  let adopted = false;
  let trustMonitor: ReturnType<typeof createMatrixDeviceTrustMonitor> | null = null;
  let currentScope: LocusAuthorizationScope | null = null;
  let identityState: SessionAccessSnapshot["identity"] = "STATUS_UNKNOWN";
  let identityError = "";
  let unsubscribeVerification: () => void = () => {};
  let unsubscribeSyncError: () => void = () => {};
  let trustSnapshot: MatrixDeviceTrustSnapshot = { state: "UNKNOWN", reason: "initializing" };
  let lastTrustUnknownReason: string | null = null;
  let trustRevision = 0;
  const attemptId = `matrix-session-${++matrixConnectionAttemptSequence}`;
  let identityConnectedAt: number | null = null;
  const logStage = (stage: string, fields: Record<string, unknown> = {}) => {
    console.info("[Locus Matrix] session stage", { correlation: attemptId, stage, ...fields });
  };
  const initialVerification = crypto.currentVerification;
  const initialState: MatrixConnectionState = "TRUST_CHECKING";
  const securityMessage = "当前 Matrix 登录状态不可用，请重新登录。";
  let connected: MatrixConnected;

  const accessSnapshot = (): SessionAccessSnapshot => {
    const scoped = currentScope ? authorizationByScope.get(currentScope.key) : undefined;
    return {
      identity: identityState,
      authorization: currentScope ? scoped?.authorization ?? "NOT_STARTED" : "NOT_STARTED",
      scopeKey: currentScope?.key,
      sessionGeneration: attemptId,
      error: identityError || scoped?.error || undefined,
    };
  };
  const notifyAccess = () => {
    const snapshot = accessSnapshot();
    for (const listener of accessListeners) listener(snapshot);
  };
  const setAuthorization = (scopeKey: string, authorization: AccountAuthorizationState, error = "") => {
    authorizationByScope.set(scopeKey, { identity: identityState, authorization, error: error || undefined });
    if (currentScope?.key === scopeKey) notifyAccess();
  };
  const accessController: SessionAccessController = {
    getSnapshot: accessSnapshot,
    subscribe: (listener) => { accessListeners.add(listener); listener(accessSnapshot()); return () => { accessListeners.delete(listener); }; },
    adopt: () => {
      adopted = true;
      if (currentScope && identityState === "CONNECTED") void runAuthorization(currentScope);
    },
    setScope: (scope) => {
      if (disposed) return;
      const scopeChanged = currentScope?.key !== scope?.key || currentScope?.locus !== scope?.locus;
      currentScope = scope;
      notifyAccess();
      if (scope && adopted && identityState === "CONNECTED") void runAuthorization(scope, scopeChanged);
    },
    retry: async () => {
      if (disposed || !adopted) return;
      const trust = await connected.refreshDeviceTrust();
      if (trust.state !== "VERIFIED" || !currentScope) return;
      await runAuthorization(currentScope, true);
    },
    deactivate: () => {
      adopted = false;
      accessListeners.clear();
    },
  };

  const session: LocusWebSession = {
    kind: "matrix",
    owner,
    controller: currentController,
    ownershipSession: { signer: controller, subject: owner },
    label: `Matrix ${stored.userId}`,
    address: stored.userId,
    connectionId: `${stored.homeserver}|${stored.userId}|${stored.deviceId}`,
    access: accessController,
    matrix: {
      userId: stored.userId,
      deviceId: stored.deviceId,
      homeserver: stored.homeserver,
      subscribeSecurity: (listener) => {
        securityListeners.add(listener);
        if (connected?.state === "RELOGIN_REQUIRED") listener(connected.error || securityMessage);
        return () => { securityListeners.delete(listener); };
      },
    },
    cleanup: () => {
      if (disposed) return;
      disposed = true;
      adopted = false;
      trustMonitor?.dispose();
      unsubscribeVerification();
      unsubscribeSyncError();
      securityListeners.clear();
      crypto.dispose();
      client.stopClient();
      accessController.deactivate();
    },
  };
  connected = {
    session,
    client,
    crypto,
    keys,
    stored,
    state: initialState,
    verification: initialVerification,
    error: "",
    freshDevice,
    subscribe: (listener) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
    requestOwnUserVerification: async () => {
      await crypto.requestOwnUserVerification(authenticatedHttp(stored.homeserver, stored));
    },
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
    refreshDeviceTrust: async () => trustMonitor
      ? trustMonitor.refreshNow()
      : crypto.refreshDeviceTrust(authenticatedHttp(stored.homeserver, stored)),
    retryControllerAuthorization: async () => { await accessController.retry(); },
  };

  const notify = () => { for (const listener of listeners) listener(); };
  const setState = (state: MatrixConnectionState) => {
    if (disposed) return;
    connected.state = state;
    options.onState?.(state);
    notify();
  };
  const requireRelogin = (message = securityMessage) => {
    if (disposed || connected.state === "RELOGIN_REQUIRED") return;
    logStage("identity_reauth_required");
    connected.error = message;
    identityState = "REAUTH_REQUIRED";
    identityError = message;
    notifyAccess();
    setState("RELOGIN_REQUIRED");
    trustMonitor?.dispose();
    unsubscribeVerification();
    unsubscribeSyncError();
    crypto.dispose();
    client.stopClient();
    for (const listener of securityListeners) listener(message);
  };
  const mapVerificationState = (snapshot: MatrixVerificationSnapshot | null): MatrixConnectionState => {
    if (!snapshot || snapshot.phase === "cancelled") return "VERIFICATION_REQUIRED";
    if (snapshot.phase === "sas-ready") return "VERIFICATION_SAS_READY";
    if (snapshot.phase === "confirming" || snapshot.phase === "done") return "VERIFICATION_CONFIRMING";
    return "VERIFICATION_REQUESTED";
  };
  const hasActiveVerificationRequest = (snapshot: MatrixVerificationSnapshot | null): boolean => Boolean(snapshot
    && ["requested", "unsupported", "sas-waiting", "sas-ready", "confirming", "done"].includes(snapshot.phase));

  async function readAndApplyTrust(): Promise<MatrixDeviceTrustSnapshot> {
    if (disposed) return { state: "UNKNOWN", reason: "attempt-disposed" };
    const revisionAtStart = trustRevision;
    const snapshot = await crypto.refreshDeviceTrust(authenticatedHttp(stored.homeserver, stored));
    if (disposed) return { state: "UNKNOWN", reason: "attempt-disposed" };
    if (revisionAtStart !== trustRevision) return trustSnapshot;
    applyTrustSnapshot(snapshot);
    return snapshot;
  }
  function applyTrustSnapshot(snapshot: MatrixDeviceTrustSnapshot): void {
    if (disposed) return;
    trustSnapshot = snapshot;
    if (snapshot.state === "SESSION_INVALID" || snapshot.state === "IDENTITY_CHANGED" || snapshot.state === "DEVICE_REVOKED") {
      if (snapshot.state === "SESSION_INVALID") logStage("session_invalid");
      const message = snapshot.state === "SESSION_INVALID" ? "Matrix 登录已过期，请重新登录。"
        : snapshot.state === "IDENTITY_CHANGED" ? "Matrix 主密钥已更改，请重新登录。"
          : "此 Matrix 设备已被移除或撤销，请重新登录。";
      requireRelogin(message);
      return;
    }
    if (snapshot.state === "UNKNOWN") {
      const reason = snapshot.reason ?? "unknown";
      if (reason !== lastTrustUnknownReason) {
        console.warn("[Locus Matrix] Device trust is unknown", reason);
        lastTrustUnknownReason = reason;
      }
      if (connected.state === "CONNECTED") {
        identityState = "STATUS_UNKNOWN";
        identityError = "Matrix 设备状态暂时无法读取。";
        notifyAccess();
        notify();
        return;
      }
      identityState = "STATUS_UNKNOWN";
      identityError = "";
      connected.error = reason === "crypto-device-data-unavailable"
        ? "Matrix 尚未返回当前设备的签名密钥，正在等待更新。"
        : reason === "current-identity-or-device-key-unavailable"
          ? "Matrix 尚未返回账号的交叉签名信息，正在等待更新。"
          : "暂时无法确认设备状态，请稍候。";
      notifyAccess();
      if (reason === "initial-sync-pending") setState("TRUST_CHECKING");
      else if (hasActiveVerificationRequest(connected.verification)) setState(mapVerificationState(connected.verification));
      else setState("TRUST_UNKNOWN");
      return;
    }
    lastTrustUnknownReason = null;
    if (snapshot.state === "UNVERIFIED") {
      if (connected.state === "CONNECTED") {
        requireRelogin("当前 Matrix 设备信任状态已失效，请重新登录并确认设备。");
        return;
      }
      identityState = "STATUS_UNKNOWN";
      identityError = "";
      notifyAccess();
      connected.error = "";
      setState(mapVerificationState(connected.verification));
      return;
    }
    connected.error = "";
    if (identityState !== "CONNECTED") {
      identityConnectedAt = Date.now();
      logStage("identity_connected");
    }
    identityState = "CONNECTED";
    identityError = "";
    notifyAccess();
    if (connected.state !== "CONNECTED") setState("CONNECTED");
    else notify();
    if (adopted && currentScope) {
      const authorization = authorizationByScope.get(currentScope.key)?.authorization;
      void runAuthorization(currentScope, authorization === "READY");
    }
  }

  async function runAuthorization(scope: LocusAuthorizationScope, forceRetry = false): Promise<void> {
    if (disposed || !adopted || identityState !== "CONNECTED" || trustSnapshot.state !== "VERIFIED") return;
    const prior = authorizationTasks.get(scope.key);
    if (prior) return prior;
    const priorSnapshot = authorizationByScope.get(scope.key);
    if (!forceRetry && priorSnapshot && ["READY", "REJECTED", "REVOKED"].includes(priorSnapshot.authorization)) return;
    const isSessionActive = () => !disposed && adopted;
    const task = Promise.resolve().then(async () => {
      const startedAt = identityConnectedAt ?? Date.now();
      logStage("authorization_preparing");
      setAuthorization(scope.key, "PREPARING", "");
      try {
        const loadKeys = async () => {
          try {
            return await retryMatrixProofPreparation(async () => {
              const discovered = await queryMatrixKeys(stored.userId, stored.deviceId, stored.homeserver, stored.accessToken,
                (input, init) => authenticatedFetch(stored, input, init));
              if (!sameBytes(discovered.masterPublicKey, keys.masterPublicKey)) throw new MatrixConnectorError("MATRIX_IDENTITY_CHANGED", "The Matrix cross-signing identity changed during sign-in.");
              if (!sameBytes(discovered.deviceEd25519Key, keys.deviceEd25519Key)) throw new MatrixConnectorError("MATRIX_DEVICE_REVOKED", "The Matrix device key changed during sign-in.");
              if (!discovered.encodedProof) throw missingMatrixProof();
              connected.keys = discovered;
              return discovered;
            });
          } catch (cause) {
            if (classifyMatrixProofFailure(cause) === "PENDING") logStage("proof_pending");
            throw cause;
          }
        };
        if (!isSessionActive() || trustSnapshot.state !== "VERIFIED") return;
        const ready = await ensureMatrixController(scope, owner, controller, loadKeys, stored.deviceId,
          (state) => {
            setAuthorization(scope.key, state);
            logStage(`authorization_${state.toLowerCase()}`);
          }, isSessionActive);
        if (!isSessionActive()) return;
        if (!ready) {
          setAuthorization(scope.key, "STATUS_UNKNOWN", "授权结果暂时无法确认，原请求已保留；可检查状态。");
          return;
        }
        const revisionBeforeFinalTrust = trustRevision;
        const finalTrust = await connected.refreshDeviceTrust();
        if (!isSessionActive()) return;
        if (revisionBeforeFinalTrust !== trustRevision) {
          logStage("authorization_status_unknown");
          setAuthorization(scope.key, "STATUS_UNKNOWN", "设备状态正在刷新，请稍候。");
          void trustMonitor?.refreshNow();
          return;
        }
        trustSnapshot = finalTrust;
        if (finalTrust.state !== "VERIFIED") {
          applyTrustSnapshot(finalTrust);
          logStage("authorization_status_unknown");
          setAuthorization(scope.key, "STATUS_UNKNOWN", "设备状态正在刷新，请稍候。");
          return;
        }
        setAuthorization(scope.key, "READY", "");
        logStage("authorization_ready", { durationMs: Date.now() - startedAt });
  } catch (cause) {
        if (!isSessionActive()) return;
        if (cause instanceof MatrixConnectorError && cause.code === "CONTROLLER_REVOKED") {
          logStage("authorization_revoked");
          setAuthorization(scope.key, "REVOKED", "此设备的账户授权已撤销。");
          return;
        }
        const failureClass = classifyMatrixProofFailure(cause);
        if (failureClass === "INVALID" || failureClass === "SESSION_INVALID" || failureClass === "RELOGIN_REQUIRED") {
          if (cause instanceof MatrixConnectorError && cause.code === "MATRIX_SESSION_INVALID") logStage("session_invalid");
          else if (failureClass === "INVALID") logStage("authorization_rejected");
          requireRelogin(matrixReloginMessage(cause));
          setAuthorization(scope.key, "REJECTED", "身份状态需要重新确认。");
          return;
        }
        if (cause instanceof MatrixConnectorError && cause.code === "CONTROLLER_RECOVERY_AMBIGUOUS") {
          logStage("authorization_status_unknown");
          setAuthorization(scope.key, "STATUS_UNKNOWN", "有一条旧授权记录，暂时无法确认所属网络；为避免重复提交，账户暂不可用。");
          return;
        }
        if (cause instanceof MatrixConnectorError && cause.code === "CONTROLLER_SUBMISSION_UNKNOWN") {
          logStage("authorization_status_unknown");
          setAuthorization(scope.key, "STATUS_UNKNOWN", "授权结果暂时无法确认。重新检查会查询已有状态，不会重复提交。");
          return;
        }
        const definitive = cause instanceof MatrixConnectorError && cause.code === "CONTROLLER_NOT_AUTHORIZED";
        logStage(definitive ? "authorization_rejected" : "authorization_retry_required");
        setAuthorization(scope.key, definitive ? "REJECTED" : "RETRY_REQUIRED", "账户授权暂未完成，请检查连接后重试。");
      }
    });
    authorizationTasks.set(scope.key, task);
    try { await task; }
    finally {
      if (authorizationTasks.get(scope.key) === task) authorizationTasks.delete(scope.key);
      const latestScope = currentScope;
      if (latestScope?.key === scope.key && latestScope.locus !== scope.locus && adopted && identityState === "CONNECTED") {
        window.setTimeout(() => { if (currentScope?.key === latestScope.key && currentScope.locus === latestScope.locus) void runAuthorization(latestScope, true); }, 0);
      }
    }
  }

  unsubscribeSyncError = crypto.subscribeSyncError((cause) => {
    if (disposed) return;
    if (cause instanceof MatrixConnectorError && cause.code === "MATRIX_SESSION_INVALID") {
      logStage("session_invalid");
      requireRelogin();
      return;
    }
    if (connected.state === "CONNECTED") {
      identityState = "STATUS_UNKNOWN";
      identityError = "Matrix 设备状态暂时无法读取。";
      notifyAccess();
      notify();
      return;
    }
    connected.error = "暂时无法确认设备状态，请重试。";
    if (hasActiveVerificationRequest(connected.verification) || trustSnapshot.state === "UNVERIFIED") notify();
    else setState("TRUST_UNKNOWN");
  });
  unsubscribeVerification = crypto.subscribeVerification((snapshot) => {
    if (disposed) return;
    trustRevision += 1;
    connected.verification = snapshot;
    if (connected.state === "CONNECTED" || connected.state === "RELOGIN_REQUIRED") {
      notify();
      return;
    }
    if (snapshot?.phase === "done") {
      connected.error = "";
      setState("VERIFICATION_CONFIRMING");
    } else if (trustSnapshot.state === "UNVERIFIED" || hasActiveVerificationRequest(snapshot)) {
      setState(mapVerificationState(snapshot));
    } else if (trustSnapshot.state === "UNKNOWN" && (snapshot === null || snapshot.phase === "cancelled")) {
      connected.error = "暂时无法确认设备状态，请重试。";
      setState("TRUST_UNKNOWN");
    } else notify();
    if (snapshot?.phase === "done" || snapshot?.phase === "cancelled") void trustMonitor?.refreshNow();
  });
  options.onState?.(initialState);
  trustMonitor = createMatrixDeviceTrustMonitor(readAndApplyTrust, {
    onResume: () => {
      crypto.resumeSync();
      void crypto.refreshCurrentVerification(authenticatedHttp(stored.homeserver, stored)).catch(() => {});
    },
    subscribeToChanges: (listener) => crypto.subscribeTrustChanges(() => {
      trustRevision += 1;
      listener();
    }),
  });
  return connected;
}

export async function connectMatrixPasswordSession(
  homeserver: string,
  userId: string,
  password: string,
  options: MatrixConnectionOptions = { locus: null },
): Promise<MatrixConnected> {
  const stored = await authenticateMatrixPassword(homeserver, userId, password);
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
