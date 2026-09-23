import {
  DeviceId,
  DeviceLists,
  initAsync,
  KeysClaimRequest,
  KeysBackupRequest,
  KeysQueryRequest,
  KeysUploadRequest,
  OlmMachine,
  RoomMessageRequest,
  RequestType,
  SignatureUploadRequest,
  ToDeviceRequest,
  UserId,
} from "@matrix-org/matrix-sdk-crypto-wasm";
import { describeMatrixCause, matrixCryptoStageFailure, MatrixConnectorError } from "./MatrixErrors.ts";

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

function isKnownRequest(value: unknown): value is SupportedRequest {
  return value instanceof KeysUploadRequest || value instanceof KeysQueryRequest || value instanceof SignatureUploadRequest || value instanceof KeysClaimRequest || value instanceof ToDeviceRequest || value instanceof RoomMessageRequest || value instanceof KeysBackupRequest;
}

export class MatrixCryptoDevice {
  private syncAbort: AbortController | null = null;
  readonly machine: OlmMachine;
  readonly deviceId: string;

  private constructor(machine: OlmMachine, deviceId: string) {
    this.machine = machine;
    this.deviceId = deviceId;
  }

  static async initialize(userId: string, deviceId: string, http: MatrixHttp): Promise<MatrixCryptoDevice> {
    try { await ensureWasm(); }
    catch (cause) {
      throw matrixCryptoStageFailure("CRYPTO_WASM_INIT_FAILED", "Matrix crypto WASM could not be loaded.", cause);
    }

    const storeName = `locus-matrix-v1-${stableStoreSuffix(userId, deviceId)}`;
    let machine: OlmMachine;
    try { machine = await OlmMachine.initialize(new UserId(userId), new DeviceId(deviceId), storeName); }
    catch (cause) {
      throw matrixCryptoStageFailure("CRYPTO_STORE_INIT_FAILED", `Matrix crypto storage could not be opened (${storeName}).`, cause);
    }

    const device = new MatrixCryptoDevice(machine, deviceId);
    try { await device.flush(http); }
    catch (cause) {
      try { device.dispose(); } catch { /* Preserve the original device setup failure. */ }
      throw cause;
    }
    return device;
  }

  private async flush(http: MatrixHttp): Promise<void> {
    for (;;) {
      let requests;
      try { requests = await this.machine.outgoingRequests(); }
      catch (cause) {
        throw matrixCryptoStageFailure("CRYPTO_OUTGOING_REQUEST_FAILED", "Matrix crypto could not prepare outgoing device requests.", cause);
      }
      if (requests.length === 0) return;
      for (const request of requests) {
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
    }
  }

  async flushRequests(http: MatrixHttp): Promise<void> {
    await this.flush(http);
  }

  /**
   * Keep the standalone OlmMachine fed from Matrix `/sync` without starting
   * matrix-js-sdk's private Rust crypto integration on the same device.
   */
  startSync(homeserver: string, fetchImpl: MatrixFetch, http: MatrixHttp): void {
    if (this.syncAbort) return;
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
          await this.flush(http);
        } catch (error) {
          if (abort.signal.aborted) return;
          await new Promise((resolve) => window.setTimeout(resolve, 2_000));
        }
      }
    })();
  }

  async sign(message: Uint8Array): Promise<Uint8Array> {
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
    return this.machine.userId.toString();
  }

  dispose(): void {
    this.syncAbort?.abort();
    this.syncAbort = null;
    try { this.machine.close(); } finally { this.machine.free(); }
  }
}

function stableStoreSuffix(userId: string, deviceId: string): string {
  let hash = 2166136261;
  for (const byte of new TextEncoder().encode(`${userId}|${deviceId}`)) hash = Math.imul(hash ^ byte, 16777619);
  return (hash >>> 0).toString(16);
}
