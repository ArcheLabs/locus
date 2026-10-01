import {
  DeviceId,
  Device,
  DeviceLists,
  initAsync,
  KeysClaimRequest,
  KeysBackupRequest,
  KeysQueryRequest,
  KeysUploadRequest,
  OlmMachine,
  OwnUserIdentity,
  Qr,
  RoomMessageRequest,
  RequestType,
  Sas,
  SignatureUploadRequest,
  ToDeviceRequest,
  UserId,
  VerificationMethod,
  VerificationRequest,
  VerificationRequestPhase,
} from "@matrix-org/matrix-sdk-crypto-wasm";
import { describeMatrixCause, matrixCryptoStageFailure, MatrixConnectorError } from "./MatrixErrors.ts";
import { evaluateMatrixDeviceTrust, type MatrixDeviceTrustSnapshot } from "./MatrixDeviceTrust.ts";

type MatrixHttp = (path: string, body: string, method?: "POST" | "PUT") => Promise<string>;
type MatrixFetch = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

let wasmReady: Promise<void> | null = null;
type WasmRequestDiagnostic = { url?: string; status?: number; contentType?: string; bytes?: number; fetchError?: string };

function ensureWasm(): Promise<void> {
  if (wasmReady) return wasmReady;

  const diagnostic: WasmRequestDiagnostic = {};
  const originalFetch = globalThis.fetch;
  let observedResponse = Promise.resolve();
  const observeFetch: typeof fetch = (input, init) => {
    const requestUrl = input instanceof Request ? input.url : String(input);
    if (!/matrix_sdk_crypto_wasm_bg\.wasm(?:$|[?#])/i.test(requestUrl)) return originalFetch.call(globalThis, input, init);
    diagnostic.url = requestUrl;
    const response = originalFetch.call(globalThis, input, init);
    observedResponse = response.then(async (result) => {
      diagnostic.status = result.status;
      diagnostic.contentType = result.headers.get("content-type") ?? "(missing)";
      try { diagnostic.bytes = (await result.clone().arrayBuffer()).byteLength; }
      catch (cause) { diagnostic.fetchError = describeMatrixCause(cause); }
    }, (cause) => { diagnostic.fetchError = describeMatrixCause(cause); });
    return response;
  };

  // initAsync starts fetch synchronously; restore the global before yielding so
  // unrelated application requests are never intercepted.
  globalThis.fetch = observeFetch;
  try { wasmReady = initAsync(); }
  catch (cause) { wasmReady = Promise.reject(cause); }
  finally { globalThis.fetch = originalFetch; }

  wasmReady = wasmReady.catch(async (cause) => {
    await observedResponse;
    wasmReady = null;
    const request = diagnostic.url
      ? ` Request ${diagnostic.url}${diagnostic.status === undefined ? "" : ` returned HTTP ${diagnostic.status}`}${diagnostic.contentType ? ` (${diagnostic.contentType})` : ""}${diagnostic.bytes === undefined ? "" : `, ${diagnostic.bytes} bytes`}${diagnostic.fetchError ? `; ${diagnostic.fetchError}` : ""}.`
      : " No Matrix crypto WASM request was observed. Reload the page before retrying initialization.";
    throw matrixCryptoStageFailure("CRYPTO_WASM_INIT_FAILED", `Matrix crypto WASM could not be loaded.${request}`, cause);
  });
  return wasmReady;
}

function requestEndpoint(request: KeysUploadRequest | KeysQueryRequest | SignatureUploadRequest | KeysClaimRequest | ToDeviceRequest | RoomMessageRequest | KeysBackupRequest): { path: string; method: "POST" | "PUT" } {
  const type = request.type;
  if (type === RequestType.KeysUpload) return { path: "/_matrix/client/v3/keys/upload", method: "POST" };
  if (type === RequestType.KeysQuery) return { path: "/_matrix/client/v3/keys/query", method: "POST" };
  if (type === RequestType.SignatureUpload) return { path: "/_matrix/client/v3/keys/signatures/upload", method: "POST" };
  if (type === RequestType.KeysClaim) return { path: "/_matrix/client/v3/keys/claim", method: "POST" };
  if (request instanceof ToDeviceRequest) {
    return { path: `/_matrix/client/v3/sendToDevice/${encodeURIComponent(request.event_type)}/${encodeURIComponent(request.txn_id)}`, method: "PUT" };
  }
  if (request instanceof RoomMessageRequest) {
    return { path: `/_matrix/client/v3/rooms/${encodeURIComponent(request.room_id)}/send/${encodeURIComponent(request.event_type)}/${encodeURIComponent(request.txn_id)}`, method: "PUT" };
  }
  if (request instanceof KeysBackupRequest) {
    return { path: `/_matrix/client/v3/room_keys/keys/${encodeURIComponent(request.version)}`, method: "PUT" };
  }
  throw new MatrixConnectorError("UNSUPPORTED_MATRIX_CRYPTO_REQUEST", `Unsupported Matrix crypto request type ${type}`);
}

type SupportedRequest = KeysUploadRequest | KeysQueryRequest | SignatureUploadRequest | KeysClaimRequest | ToDeviceRequest | RoomMessageRequest | KeysBackupRequest;
type VerificationOutgoingRequest = ToDeviceRequest | RoomMessageRequest;

export type MatrixVerificationSnapshot = {
  flowId: string;
  otherDeviceId: string;
  startedByLocus: boolean;
  phase: "requested" | "unsupported" | "sas-waiting" | "sas-ready" | "confirming" | "done" | "cancelled";
  emojis: { symbol: string; description: string }[];
};

function isKnownRequest(value: unknown): value is SupportedRequest {
  return value instanceof KeysUploadRequest || value instanceof KeysQueryRequest || value instanceof SignatureUploadRequest || value instanceof KeysClaimRequest || value instanceof ToDeviceRequest || value instanceof RoomMessageRequest || value instanceof KeysBackupRequest;
}

export class MatrixCryptoDevice {
  private syncAbort: AbortController | null = null;
  private disposed = false;
  private verificationSnapshot: MatrixVerificationSnapshot | null = null;
  private readonly verificationListeners = new Set<(snapshot: MatrixVerificationSnapshot | null) => void>();
  private readonly trustListeners = new Set<() => void>();
  private readonly syncErrorListeners = new Set<(cause: unknown) => void>();
  private readonly pendingVerificationRequests: VerificationOutgoingRequest[] = [];
  private readonly acceptedFlows = new Set<string>();
  private readonly startedSasFlows = new Set<string>();
  private activeFlowId: string | null = null;
  private ownVerificationInFlight: Promise<void> | null = null;
  private initialSyncComplete = false;
  private initialSyncFailure: MatrixDeviceTrustSnapshot | null = null;
  private expectedMasterKey: string | null = null;
  private expectedDeviceKey: string | null = null;
  readonly machine: OlmMachine;
  readonly deviceId: string;

  private constructor(machine: OlmMachine, deviceId: string) {
    this.machine = machine;
    this.deviceId = deviceId;
  }

  static async initialize(userId: string, deviceId: string): Promise<MatrixCryptoDevice> {
    try { await ensureWasm(); }
    catch (cause) {
      throw matrixCryptoStageFailure("CRYPTO_WASM_INIT_FAILED", "Matrix crypto WASM could not be loaded.", cause);
    }

    const storeName = matrixCryptoStoreName(userId, deviceId);
    let machine: OlmMachine;
    const matrixUserId = new UserId(userId);
    const matrixDeviceId = new DeviceId(deviceId);
    try { machine = await OlmMachine.initialize(matrixUserId, matrixDeviceId, storeName); }
    catch (cause) {
      throw matrixCryptoStageFailure("CRYPTO_STORE_INIT_FAILED", `Matrix crypto storage could not be opened (${storeName}).`, cause);
    } finally {
      matrixUserId.free();
      matrixDeviceId.free();
    }

    // Restores compare local/server keys before any upload can revive a deleted
    // remote device. The caller flushes only after this parity check.
    return new MatrixCryptoDevice(machine, deviceId);
  }

  get localIdentityKeys(): { ed25519: string; curve25519: string } {
    const identity = this.machine.identityKeys;
    try {
      const ed25519 = identity.ed25519;
      const curve25519 = identity.curve25519;
      try { return { ed25519: ed25519.toBase64(), curve25519: curve25519.toBase64() }; }
      finally { ed25519.free(); curve25519.free(); }
    } finally { identity.free(); }
  }

  get currentVerification(): MatrixVerificationSnapshot | null { return this.verificationSnapshot; }

  subscribeVerification(listener: (snapshot: MatrixVerificationSnapshot | null) => void): () => void {
    this.verificationListeners.add(listener);
    listener(this.verificationSnapshot);
    return () => { this.verificationListeners.delete(listener); };
  }

  subscribeSyncError(listener: (cause: unknown) => void): () => void {
    this.syncErrorListeners.add(listener);
    return () => { this.syncErrorListeners.delete(listener); };
  }

  subscribeTrustChanges(listener: () => void): () => void {
    this.trustListeners.add(listener);
    return () => { this.trustListeners.delete(listener); };
  }

  setExpectedTrustKeys(masterPublicKey: Uint8Array, deviceEd25519Key: Uint8Array): void {
    this.expectedMasterKey = bytesToMatrixBase64(masterPublicKey);
    this.expectedDeviceKey = bytesToMatrixBase64(deviceEd25519Key);
  }

  /** Refresh SDK-owned trust state from a new signed keys/query response. */
  async refreshDeviceTrust(http: MatrixHttp): Promise<MatrixDeviceTrustSnapshot> {
    if (this.disposed) return { state: "UNKNOWN", reason: "crypto-device-disposed" };
    if (this.initialSyncFailure) return this.initialSyncFailure;
    if (!this.initialSyncComplete) return { state: "UNKNOWN", reason: "initial-sync-pending" };
    try {
      const user = new UserId(this.userId);
      let request: KeysQueryRequest;
      try { request = this.machine.queryKeysForUsers([user]); }
      catch (cause) {
        user.free();
        throw cause;
      }
      try { await this.sendRequest(request, http); }
      finally { request.free(); }
      return await this.readDeviceTrustFromStore();
    } catch (cause) {
      if (cause instanceof MatrixConnectorError && cause.code === "MATRIX_SESSION_INVALID") {
        return { state: "SESSION_INVALID", reason: "matrix-session-expired" };
      }
      return { state: "UNKNOWN", reason: "matrix-trust-refresh-failed" };
    }
  }

  private async readDeviceTrustFromStore(): Promise<MatrixDeviceTrustSnapshot> {
    if (!this.expectedMasterKey || !this.expectedDeviceKey) return { state: "UNKNOWN", reason: "trust-context-not-bound" };
    let identity: OwnUserIdentity | undefined;
    let device: Device | undefined;
    try {
      const userForIdentity = new UserId(this.userId);
      try { identity = await this.machine.getIdentity(userForIdentity) as OwnUserIdentity | undefined; }
      finally { userForIdentity.free(); }

      const userForDevice = new UserId(this.userId);
      const deviceId = new DeviceId(this.deviceId);
      try { device = await this.machine.getDevice(userForDevice, deviceId); }
      finally { userForDevice.free(); deviceId.free(); }

      if (!(identity instanceof OwnUserIdentity) || !device) {
        return evaluateMatrixDeviceTrust({
          identityAvailable: identity instanceof OwnUserIdentity,
          deviceAvailable: Boolean(device),
          identityChanged: false,
          deviceRevoked: false,
          masterKeyAvailable: false,
          deviceKeyAvailable: false,
          masterKeyMatches: false,
          deviceKeyMatches: false,
          identityVerified: false,
          identityTrustsOwnDevice: false,
          deviceCrossSignedByOwner: false,
          deviceCrossSigningTrusted: false,
        });
      }

      const ed25519 = device.ed25519Key;
      let currentDeviceKey: string | null = null;
      try { currentDeviceKey = ed25519?.toBase64() ?? null; }
      finally { ed25519?.free(); }
      const currentMasterKey = identity.masterKey;
      const identityTrustsOwnDevice = await identity.trustsOurOwnDevice();
      return evaluateMatrixDeviceTrust({
        identityAvailable: true,
        deviceAvailable: true,
        identityChanged: identity.hasVerificationViolation(),
        deviceRevoked: device.isDeleted(),
        masterKeyAvailable: typeof currentMasterKey === "string" && currentMasterKey.length > 0,
        deviceKeyAvailable: currentDeviceKey !== null,
        masterKeyMatches: typeof currentMasterKey === "string" && sameMatrixBase64(currentMasterKey, this.expectedMasterKey),
        deviceKeyMatches: currentDeviceKey !== null && sameMatrixBase64(currentDeviceKey, this.expectedDeviceKey),
        identityVerified: identity.isVerified(),
        identityTrustsOwnDevice,
        deviceCrossSignedByOwner: device.isCrossSignedByOwner(),
        deviceCrossSigningTrusted: device.isCrossSigningTrusted(),
      });
    } finally {
      identity?.free();
      device?.free();
    }
  }

  private async assertCurrentDeviceTrusted(): Promise<void> {
    const trust = await this.readDeviceTrustFromStore();
    if (trust.state === "VERIFIED") return;
    if (trust.state === "IDENTITY_CHANGED") throw new MatrixConnectorError("MATRIX_IDENTITY_CHANGED", "The Matrix cross-signing identity changed. Sign in again.");
    if (trust.state === "DEVICE_REVOKED") throw new MatrixConnectorError("MATRIX_DEVICE_REVOKED", "This Matrix device is no longer trusted. Sign in again.");
    throw new MatrixConnectorError("DEVICE_NOT_VERIFIED", "The current Matrix device is not trusted by its cross-signing identity.");
  }

  private publishVerification(snapshot: MatrixVerificationSnapshot | null): void {
    this.verificationSnapshot = snapshot;
    for (const listener of this.verificationListeners) listener(snapshot);
  }

  private async sendRequest(request: SupportedRequest, http: MatrixHttp): Promise<void> {
    if (!isKnownRequest(request)) throw new MatrixConnectorError("UNSUPPORTED_MATRIX_CRYPTO_REQUEST", `Unsupported Matrix crypto request ${String(request)}`);
    const endpoint = requestEndpoint(request);
    let response: string;
    try { response = await http(endpoint.path, request.body, endpoint.method); }
    catch (cause) {
      if (cause instanceof MatrixConnectorError) throw cause;
      throw new MatrixConnectorError("DEVICE_KEYS_UPLOAD_FAILED", `Matrix device request ${request.type} to ${endpoint.path} failed. ${describeMatrixCause(cause)}`, { cause });
    }
    if (!request.id) throw new MatrixConnectorError("CRYPTO_REQUEST_ACK_FAILED", `Matrix crypto request ${request.type} did not provide a request ID`);
    try { await this.machine.markRequestAsSent(request.id, request.type, response); }
    catch (cause) {
      throw matrixCryptoStageFailure("CRYPTO_REQUEST_ACK_FAILED", `Matrix crypto could not accept the homeserver response for request ${request.type}.`, cause);
    }
  }

  private queueVerificationRequest(request: VerificationOutgoingRequest | undefined): void {
    if (request) this.pendingVerificationRequests.push(request);
  }

  private async flushVerificationRequests(http: MatrixHttp): Promise<void> {
    while (this.pendingVerificationRequests.length > 0) {
      const request = this.pendingVerificationRequests[0];
      await this.sendRequest(request, http);
      this.pendingVerificationRequests.shift();
      request.free();
    }
  }

  private async flush(http: MatrixHttp): Promise<void> {
    await this.flushVerificationRequests(http);
    for (;;) {
      let requests;
      try { requests = await this.machine.outgoingRequests(); }
      catch (cause) {
        throw matrixCryptoStageFailure("CRYPTO_OUTGOING_REQUEST_FAILED", "Matrix crypto could not prepare outgoing device requests.", cause);
      }
      if (requests.length === 0) return;
      for (const request of requests) {
        try { await this.sendRequest(request, http); }
        finally { request.free(); }
      }
    }
  }

  async flushRequests(http: MatrixHttp): Promise<void> {
    await this.flush(http);
  }

  private requestForFlow(flowId: string): VerificationRequest | undefined {
    const user = new UserId(this.userId);
    try { return this.machine.getVerificationRequest(user, flowId); }
    finally { user.free(); }
  }

  private otherDeviceId(request: VerificationRequest): string {
    const deviceId = request.otherDeviceId;
    if (!deviceId) return "Unknown device";
    try { return deviceId.toString(); }
    finally { deviceId.free(); }
  }

  private sameUserRequest(request: VerificationRequest): boolean {
    const otherUser = request.otherUserId;
    try {
      return otherUser.toString() === this.userId
        && request.isSelfVerification()
        && this.otherDeviceId(request) !== this.deviceId
        && this.otherDeviceId(request) !== "Unknown device";
    }
    finally { otherUser.free(); }
  }

  private async readVerificationSnapshot(request: VerificationRequest, http: MatrixHttp): Promise<MatrixVerificationSnapshot> {
    const flowId = request.flowId;
    const otherDeviceId = this.otherDeviceId(request);
    const startedByLocus = request.weStarted();
    const base = { flowId, otherDeviceId, startedByLocus, emojis: [] as { symbol: string; description: string }[] };
    if (request.isCancelled() || request.timedOut() || request.phase() === VerificationRequestPhase.Cancelled) return { ...base, phase: "cancelled" };
    if (request.isDone() || request.phase() === VerificationRequestPhase.Done) return { ...base, phase: "done" };

    const verification = request.getVerification();
    if (verification instanceof Sas) {
      try {
        if (verification.isCancelled()) return { ...base, phase: "cancelled" };
        if (verification.haveWeConfirmed()) return { ...base, phase: "confirming" };
        const emojiObjects = verification.canBePresented() && verification.supportsEmoji() ? verification.emoji() : undefined;
        if (emojiObjects) {
          try {
            const emojis = emojiObjects.map((emoji) => ({ symbol: emoji.symbol, description: emoji.description }));
            return { ...base, phase: "sas-ready", emojis };
          } finally { for (const emoji of emojiObjects) emoji.free(); }
        }
        return { ...base, phase: "sas-waiting" };
      } finally { verification.free(); }
    }
    if (verification instanceof Qr) {
      verification.free();
      return { ...base, phase: "unsupported" };
    }

    if ((this.acceptedFlows.has(flowId) || startedByLocus) && request.phase() === VerificationRequestPhase.Ready && !this.startedSasFlows.has(flowId)) {
      const theirMethods = request.theirSupportedMethods;
      if (theirMethods && !theirMethods.includes(VerificationMethod.SasV1)) return { ...base, phase: "unsupported" };
      const result = await request.startSas();
      if (result) {
        const [sas, outgoing] = result;
        this.startedSasFlows.add(flowId);
        this.queueVerificationRequest(outgoing);
        sas.free();
        await this.flush(http);
        return this.readVerificationSnapshot(request, http);
      }
    }
    return { ...base, phase: this.acceptedFlows.has(flowId) ? "sas-waiting" : "requested" };
  }

  /**
   * Start an interactive verification from this newly signed-in device to the
   * user's existing Matrix devices. This is the rust-crypto equivalent of
   * requestOwnUserVerification(); Element can then accept the request.
   */
  requestOwnUserVerification(http: MatrixHttp): Promise<void> {
    if (this.ownVerificationInFlight) return this.ownVerificationInFlight;
    const request = this.startOwnUserVerification(http);
    this.ownVerificationInFlight = request;
    void request.finally(() => {
      if (this.ownVerificationInFlight === request) this.ownVerificationInFlight = null;
    }).catch(() => {});
    return request;
  }

  private async startOwnUserVerification(http: MatrixHttp): Promise<void> {
    if (this.disposed) throw new MatrixConnectorError("MATRIX_VERIFICATION_FAILED", "The Matrix crypto device is no longer active.");

    const user = new UserId(this.userId);
    let requests: VerificationRequest[] = [];
    try { requests = this.machine.getVerificationRequests(user); }
    finally { user.free(); }
    try {
      const existing = requests.find((request) => this.sameUserRequest(request) && request.weStarted() && !request.isCancelled() && !request.isDone())
        ?? requests.find((request) => this.sameUserRequest(request) && !request.isCancelled() && !request.isDone());
      if (existing) {
        this.activeFlowId = existing.flowId;
        this.publishVerification(await this.readVerificationSnapshot(existing, http));
        await this.flush(http);
        return;
      }
    } finally { for (const request of requests) request.free(); }

    const queryUser = new UserId(this.userId);
    let identity: OwnUserIdentity | undefined;
    try {
      const keyQuery = this.machine.queryKeysForUsers([queryUser]);
      try { await this.sendRequest(keyQuery, http); }
      finally { keyQuery.free(); }
    } catch (cause) {
      if (cause instanceof MatrixConnectorError) throw cause;
      throw matrixCryptoStageFailure("MATRIX_VERIFICATION_FAILED", "Matrix cross-signing keys could not be queried before starting own-device verification.", cause);
    }

    // queryKeysForUsers consumes/invalidates its UserId wrapper, so fetch the
    // identity with a fresh wrapper after the query response is applied.
    const identityUser = new UserId(this.userId);
    try {
      const result = await this.machine.getIdentity(identityUser);
      if (!(result instanceof OwnUserIdentity)) {
        result?.free();
        throw new MatrixConnectorError("MATRIX_VERIFICATION_FAILED", "This Matrix account has no usable cross-signing identity. Complete Matrix cross-signing setup in Element, then retry.");
      }
      identity = result;
    } finally { identityUser.free(); }

    try {
      const [request, outgoing] = await identity.requestVerification([VerificationMethod.SasV1]);
      try {
        this.activeFlowId = request.flowId;
        this.publishVerification(await this.readVerificationSnapshot(request, http));
        this.queueVerificationRequest(outgoing);
        await this.flush(http);
        await this.refreshVerificationRequests(http);
      } finally { request.free(); }
    } catch (cause) {
      if (cause instanceof MatrixConnectorError) throw cause;
      throw matrixCryptoStageFailure("MATRIX_VERIFICATION_FAILED", "Locus could not send an own-device verification request to this Matrix account.", cause);
  } finally { identity.free(); }
  }

  /** Inspect own-device requests after every /sync response. */
  private async refreshVerificationRequests(http: MatrixHttp): Promise<void> {
    const user = new UserId(this.userId);
    let requests: VerificationRequest[];
    try { requests = this.machine.getVerificationRequests(user); }
    finally { user.free(); }
    try {
      const own = requests.filter((request) => this.sameUserRequest(request));
      const active = own.find((request) => request.flowId === this.activeFlowId && !request.isCancelled() && !request.isDone());
      const candidate = active
        ?? own.find((request) => request.weStarted() && !request.isCancelled() && !request.isDone())
        ?? own.find((request) => !request.isCancelled() && !request.isDone())
        ?? own[own.length - 1];
      if (!candidate) {
        if (this.verificationSnapshot?.phase === "done") {
          this.publishVerification(this.verificationSnapshot);
          return;
        }
        if (this.verificationSnapshot && !["done", "cancelled"].includes(this.verificationSnapshot.phase)) {
          this.activeFlowId = null;
          this.publishVerification(null);
        }
        return;
      }
      this.activeFlowId = candidate.flowId;
      this.publishVerification(await this.readVerificationSnapshot(candidate, http));
    } catch (cause) {
      throw matrixCryptoStageFailure("MATRIX_VERIFICATION_FAILED", "Matrix verification request could not be processed.", cause);
    } finally { for (const request of requests) request.free(); }
  }

  async startVerification(flowId: string, http: MatrixHttp): Promise<void> {
    const request = this.requestForFlow(flowId);
    if (!request) throw new MatrixConnectorError("MATRIX_VERIFICATION_FAILED", "This Matrix verification request is no longer available. Ask Element to start it again.");
    try {
      if (!this.sameUserRequest(request)) throw new MatrixConnectorError("MATRIX_VERIFICATION_FAILED", "Only a verification request for your own Matrix account can authorize this device.");
      if (request.weStarted()) throw new MatrixConnectorError("MATRIX_VERIFICATION_FAILED", "Locus already sent this verification request. Accept it on your other Matrix device.");
      const theirMethods = request.theirSupportedMethods;
      if (theirMethods && !theirMethods.includes(VerificationMethod.SasV1)) {
        throw new MatrixConnectorError("UNSUPPORTED_MATRIX_CRYPTO_REQUEST", "This request uses QR verification, which Locus does not currently display or scan. Ask Element to use SAS verification.");
      }
      this.activeFlowId = flowId;
      this.acceptedFlows.add(flowId);
      this.queueVerificationRequest(request.acceptWithMethods([VerificationMethod.SasV1]));
      await this.flush(http);
      await this.refreshVerificationRequests(http);
    } finally { request.free(); }
  }

  async confirmVerification(flowId: string, matches: boolean, http: MatrixHttp): Promise<void> {
    const request = this.requestForFlow(flowId);
    if (!request) throw new MatrixConnectorError("MATRIX_VERIFICATION_FAILED", "This Matrix verification request is no longer available.");
    try {
      const verification = request.getVerification();
      if (!(verification instanceof Sas)) {
        verification?.free();
        throw new MatrixConnectorError("MATRIX_VERIFICATION_FAILED", "The SAS emoji are not ready yet. Wait for both devices to accept verification.");
      }
      try {
        if (!verification.canBePresented() || !verification.supportsEmoji()) throw new MatrixConnectorError("MATRIX_VERIFICATION_FAILED", "This verification does not have an emoji SAS to compare.");
        if (matches) {
          const outgoing = await verification.confirm();
          for (const item of outgoing) this.queueVerificationRequest(item);
          await this.flush(http);
          this.publishVerification({ flowId, otherDeviceId: this.otherDeviceId(request), startedByLocus: request.weStarted(), phase: "confirming", emojis: [] });
        } else {
          this.queueVerificationRequest(verification.cancelWithCode("m.mismatched_sas"));
          await this.flush(http);
          this.publishVerification({ flowId, otherDeviceId: this.otherDeviceId(request), startedByLocus: request.weStarted(), phase: "cancelled", emojis: [] });
        }
        await this.refreshVerificationRequests(http);
      } finally { verification.free(); }
    } finally { request.free(); }
  }

  async cancelVerification(flowId: string, http: MatrixHttp): Promise<void> {
    const request = this.requestForFlow(flowId);
    if (!request) return;
    try {
      const verification = request.getVerification();
      if (verification instanceof Sas) {
        try { this.queueVerificationRequest(verification.cancel()); }
        finally { verification.free(); }
      } else {
        verification?.free();
        this.queueVerificationRequest(request.cancel());
      }
      await this.flush(http);
      this.publishVerification({ flowId, otherDeviceId: this.otherDeviceId(request), startedByLocus: request.weStarted(), phase: "cancelled", emojis: [] });
    } finally { request.free(); }
  }

  /**
   * Keep the standalone OlmMachine fed from Matrix `/sync` without starting
   * matrix-js-sdk's private Rust crypto integration on the same device.
   */
  startSync(homeserver: string, fetchImpl: MatrixFetch, http: MatrixHttp): void {
    if (this.disposed || this.syncAbort) return;
    const abort = new AbortController();
    this.syncAbort = abort;
    void (async () => {
      let since: string | undefined;
      while (!abort.signal.aborted) {
        const query = new URLSearchParams({ timeout: "30000" });
        if (since) query.set("since", since);
        let response: Response;
        try {
          response = await fetchImpl(`${homeserver.replace(/\/$/, "")}/_matrix/client/v3/sync?${query.toString()}`, { signal: abort.signal });
          const payload = await response.json() as {
            next_batch?: string;
            to_device?: { events?: unknown[] };
            device_lists?: { changed?: string[]; left?: string[] };
            device_one_time_keys_count?: Record<string, number>;
          };
          if (!response.ok || typeof payload.next_batch !== "string") throw new Error(`Matrix sync failed with HTTP ${response.status}`);
          const lists = new DeviceLists(
            (payload.device_lists?.changed ?? []).map((value) => new UserId(value)),
            (payload.device_lists?.left ?? []).map((value) => new UserId(value)),
          );
          try {
          await this.machine.receiveSyncChanges(
              JSON.stringify(payload.to_device?.events ?? []),
              lists,
              new Map(Object.entries(payload.device_one_time_keys_count ?? {})),
            );
          } finally {
            lists.free();
          }
          since = payload.next_batch;
          await this.refreshVerificationRequests(http);
          await this.flush(http);
          this.initialSyncComplete = true;
          for (const listener of this.trustListeners) listener();
        } catch (error) {
          if (abort.signal.aborted) return;
          if (error instanceof MatrixConnectorError && error.code === "MATRIX_SESSION_INVALID") {
            this.initialSyncFailure = { state: "SESSION_INVALID", reason: "matrix-session-expired" };
            for (const listener of this.trustListeners) listener();
            return;
          }
          for (const listener of this.syncErrorListeners) listener(error);
          await new Promise((resolve) => window.setTimeout(resolve, 2_000));
        }
      }
    })();
  }

  async sign(message: Uint8Array): Promise<Uint8Array> {
    await this.assertCurrentDeviceTrusted();
    let text: string;
    try {
      text = new TextDecoder("utf-8", { fatal: true }).decode(message);
    } catch (cause) {
      throw new MatrixConnectorError("DEVICE_NOT_VERIFIED", "JamScript action is not valid UTF-8", { cause });
    }
    const roundTrip = new TextEncoder().encode(text);
    if (roundTrip.length !== message.length || roundTrip.some((value, index) => value !== message[index]) || !text.startsWith("JAMSCRIPT_ACTION_V2:")) {
      throw new MatrixConnectorError("DEVICE_NOT_VERIFIED", "Matrix device signing only accepts canonical JamScript action messages");
    }
    const signatures = await this.machine.sign(text);
    const parsed = JSON.parse(signatures.asJSON()) as Record<string, Record<string, unknown>>;
    const signature = parsed[Object.keys(parsed).find((key) => key === this.userId) ?? ""]?.[`ed25519:${this.deviceId}`];
    if (typeof signature !== "string") throw new MatrixConnectorError("DEVICE_NOT_VERIFIED", "Matrix OlmMachine did not return a device signature");
    const normalized = signature.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(signature.length / 4) * 4, "=");
    const bytes = Uint8Array.from(atob(normalized), (character) => character.charCodeAt(0));
    if (bytes.length !== 64) throw new MatrixConnectorError("DEVICE_NOT_VERIFIED", "Matrix device signature must be 64 bytes");
    return bytes;
  }

  private get userId(): string {
    const userId = this.machine.userId;
    try { return userId.toString(); }
    finally { userId.free(); }
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.syncAbort?.abort();
    this.syncAbort = null;
    this.verificationListeners.clear();
    this.trustListeners.clear();
    this.syncErrorListeners.clear();
    for (const request of this.pendingVerificationRequests) request.free();
    this.pendingVerificationRequests.length = 0;
    this.verificationSnapshot = null;
    try { this.machine.close(); } finally { this.machine.free(); }
  }
}

export function matrixCryptoStoreName(userId: string, deviceId: string): string {
  return `locus-matrix-v1-${stableStoreSuffix(userId, deviceId)}`;
}

/** Delete the IndexedDB crypto store after its OlmMachine has been closed. */
export async function destroyMatrixCryptoStore(userId: string, deviceId: string): Promise<void> {
  if (typeof indexedDB === "undefined") return;
  const request = indexedDB.deleteDatabase(matrixCryptoStoreName(userId, deviceId));
  await new Promise<void>((resolve, reject) => {
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error ?? new Error("Could not delete the Matrix crypto store."));
    request.onblocked = () => reject(new Error("The Matrix crypto store is still open in another tab. Close other Locus tabs and try signing out again."));
  });
}

function stableStoreSuffix(userId: string, deviceId: string): string {
  let hash = 2166136261;
  for (const byte of new TextEncoder().encode(`${userId}|${deviceId}`)) hash = Math.imul(hash ^ byte, 16777619);
  return (hash >>> 0).toString(16);
}

function bytesToMatrixBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function sameMatrixBase64(left: string, right: string): boolean {
  const normalize = (value: string) => value.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  return normalize(left) === normalize(right);
}
