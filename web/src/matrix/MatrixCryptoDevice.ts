import {
  DeviceId,
  initAsync,
  KeysClaimRequest,
  KeysQueryRequest,
  KeysUploadRequest,
  OlmMachine,
  RequestType,
  SignatureUploadRequest,
  UserId,
} from "@matrix-org/matrix-sdk-crypto-wasm";
import { MatrixConnectorError } from "./MatrixErrors.js";

type MatrixHttp = (path: string, body: string) => Promise<string>;

let wasmReady: Promise<void> | null = null;
function ensureWasm(): Promise<void> {
  wasmReady ??= initAsync();
  return wasmReady;
}

function endpoint(type: RequestType): string {
  if (type === RequestType.KeysUpload) return "/_matrix/client/v3/keys/upload";
  if (type === RequestType.KeysQuery) return "/_matrix/client/v3/keys/query";
  if (type === RequestType.SignatureUpload) return "/_matrix/client/v3/keys/signatures/upload";
  if (type === RequestType.KeysClaim) return "/_matrix/client/v3/keys/claim";
  throw new MatrixConnectorError("UNSUPPORTED_MATRIX_CRYPTO_REQUEST", `Unsupported Matrix crypto request type ${type}`);
}

function isKnownRequest(value: unknown): value is KeysUploadRequest | KeysQueryRequest | SignatureUploadRequest | KeysClaimRequest {
  return value instanceof KeysUploadRequest || value instanceof KeysQueryRequest || value instanceof SignatureUploadRequest || value instanceof KeysClaimRequest;
}

export class MatrixCryptoDevice {
  private constructor(readonly machine: OlmMachine, readonly deviceId: string) {}

  static async initialize(userId: string, deviceId: string, http: MatrixHttp): Promise<MatrixCryptoDevice> {
    try {
      await ensureWasm();
      const machine = await OlmMachine.initialize(new UserId(userId), new DeviceId(deviceId), `locus-matrix-v1-${stableStoreSuffix(userId, deviceId)}`);
      const device = new MatrixCryptoDevice(machine, deviceId);
      await device.flush(http);
      return device;
    } catch (cause) {
      throw new MatrixConnectorError("DEVICE_KEYS_UPLOAD_FAILED", "Unable to initialize or upload Matrix device keys", { cause });
    }
  }

  private async flush(http: MatrixHttp): Promise<void> {
    for (const request of await this.machine.outgoingRequests()) {
      if (!isKnownRequest(request)) throw new MatrixConnectorError("UNSUPPORTED_MATRIX_CRYPTO_REQUEST", `Unsupported Matrix crypto request ${String(request)}`);
      const response = await http(endpoint(request.type), request.body);
      if (!request.id) throw new MatrixConnectorError("DEVICE_KEYS_UPLOAD_FAILED", "Matrix crypto request did not provide a request ID");
      await this.machine.markRequestAsSent(request.id, request.type, response);
    }
  }

  async flushRequests(http: MatrixHttp): Promise<void> {
    await this.flush(http);
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
    try { this.machine.close(); } finally { this.machine.free(); }
  }
}

function stableStoreSuffix(userId: string, deviceId: string): string {
  let hash = 2166136261;
  for (const byte of new TextEncoder().encode(`${userId}|${deviceId}`)) hash = Math.imul(hash ^ byte, 16777619);
  return (hash >>> 0).toString(16);
}
