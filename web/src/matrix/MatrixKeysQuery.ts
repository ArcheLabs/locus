import { matrixOwnership } from "../../../sdk/src/ownership.ts";
import type { Ownership } from "../../../sdk/src/types.ts";
import { encodeMatrixControlClaimProofV1, type MatrixControlClaimProofV1 } from "@jamscript/client";
import { describeMatrixCause, MatrixConnectorError } from "./MatrixErrors.ts";

type MatrixSignedKey = {
  keys?: Record<string, string>;
  signatures?: Record<string, Record<string, string>>;
  algorithms?: string[];
};

type KeysQueryResponse = {
  master_keys?: Record<string, MatrixSignedKey>;
  self_signing_keys?: Record<string, MatrixSignedKey>;
  device_keys?: Record<string, Record<string, MatrixSignedKey>>;
};

export type MatrixDeviceKeyParity =
  | { status: "missing-device" }
  | { status: "missing-ed25519" }
  | { status: "missing-curve25519" }
  | { status: "mismatch"; serverEd25519: string; serverCurve25519: string }
  | { status: "match" };

export type MatrixDiscoveredKeys = {
  userId: string;
  masterPublicKey: Uint8Array;
  selfSigningPublicKey: Uint8Array;
  masterSignature: Uint8Array;
  deviceId: string;
  deviceCurve25519Key: Uint8Array;
  deviceEd25519Key: Uint8Array;
  selfSigningSignature: Uint8Array | null;
  algorithms: string[];
  proof: MatrixControlClaimProofV1 | null;
  encodedProof: Uint8Array | null;
  verification: "verified" | "pending";
};

function decodeBase64(value: string, label: string): Uint8Array {
  if (typeof value !== "string" || value.length === 0) throw new MatrixConnectorError("CROSS_SIGNING_UNAVAILABLE", `Matrix ${label} is missing`);
  try {
    const normalized = value.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
    return Uint8Array.from(atob(normalized), (character) => character.charCodeAt(0));
  } catch (cause) {
    throw new MatrixConnectorError("CROSS_SIGNING_UNAVAILABLE", `Matrix ${label} is not valid base64`, { cause });
  }
}

function fixedBase64(value: string, length: number, label: string): Uint8Array {
  const decoded = decodeBase64(value, label);
  if (decoded.length !== length) throw new MatrixConnectorError("CROSS_SIGNING_UNAVAILABLE", `Matrix ${label} must be ${length} bytes`);
  return decoded;
}

function firstKey(keys: MatrixSignedKey | undefined, prefix: string, label: string): [string, string] {
  const entries = Object.entries(keys?.keys ?? {}).filter(([key]) => key.startsWith(prefix));
  if (entries.length === 0) throw new MatrixConnectorError("CROSS_SIGNING_UNAVAILABLE", `Matrix ${label} is missing`);
  if (entries.length !== 1) throw new MatrixConnectorError("CROSS_SIGNING_UNAVAILABLE", `Matrix ${label} is ambiguous`);
  return entries[0];
}

function signedBy(keys: MatrixSignedKey | undefined, userId: string, keyId: string, label: string, code: "CROSS_SIGNING_UNAVAILABLE" | "DEVICE_NOT_VERIFIED" = "CROSS_SIGNING_UNAVAILABLE"): Uint8Array {
  const value = keys?.signatures?.[userId]?.[keyId];
  if (!value) throw new MatrixConnectorError(code, `Matrix ${label} is missing`);
  return fixedBase64(value, 64, label);
}

function validUserId(value: string): void {
  if (!/^@[^\s:]+:[^\s:]+$/.test(value)) throw new MatrixConnectorError("CROSS_SIGNING_UNAVAILABLE", "Invalid Matrix User ID");
}

async function matrixJson<T>(homeserver: string, accessToken: string | undefined, path: string, body: unknown, fetchImpl: typeof fetch = fetch): Promise<T> {
  let response: Response;
  try {
    response = await fetchImpl(`${homeserver.replace(/\/$/, "")}${path}`, {
      method: "POST",
      headers: { ...(accessToken ? { authorization: `Bearer ${accessToken}` } : {}), "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch (cause) {
    throw new MatrixConnectorError("HOMESERVER_UNAVAILABLE", `Unable to reach Matrix homeserver ${homeserver}`, { cause });
  }
  const text = await response.text();
  let parsed: unknown;
  try { parsed = text ? JSON.parse(text) : {}; } catch (cause) {
    throw new MatrixConnectorError("HOMESERVER_UNAVAILABLE", "Matrix homeserver returned invalid JSON", { cause });
  }
  if (!response.ok) {
    const payload = parsed && typeof parsed === "object" ? parsed as { errcode?: unknown; error?: unknown } : {};
    const errcode = typeof payload.errcode === "string" ? payload.errcode : "";
    const error = typeof payload.error === "string" ? describeMatrixCause(payload.error) : "";
    const detail = [errcode, error].filter(Boolean).join(": ");
    throw new MatrixConnectorError("HOMESERVER_UNAVAILABLE", `Matrix keys query failed with HTTP ${response.status}${detail ? ` (${detail})` : ""}.`);
  }
  return parsed as T;
}

function normalizedKey(value: string): string {
  return value.replace(/-/g, "+").replace(/_/g, "/").replace(/=+$/, "");
}

/** Compare the local OlmMachine identity key pair with this exact server device. */
export async function queryMatrixDeviceKeyParity(
  userId: string,
  deviceId: string,
  homeserver: string,
  accessToken: string,
  local: { ed25519: string; curve25519: string },
  fetchImpl: typeof fetch = fetch,
): Promise<MatrixDeviceKeyParity> {
  validUserId(userId);
  const response = await matrixJson<KeysQueryResponse>(
    homeserver,
    accessToken,
    "/_matrix/client/v3/keys/query",
    { device_keys: { [userId]: [deviceId] } },
    fetchImpl,
  );
  const device = response.device_keys?.[userId]?.[deviceId];
  if (!device) return { status: "missing-device" };
  const serverEd25519 = device.keys?.[`ed25519:${deviceId}`];
  if (!serverEd25519) return { status: "missing-ed25519" };
  const serverCurve25519 = device.keys?.[`curve25519:${deviceId}`];
  if (!serverCurve25519) return { status: "missing-curve25519" };
  if (normalizedKey(serverEd25519) !== normalizedKey(local.ed25519)
    || normalizedKey(serverCurve25519) !== normalizedKey(local.curve25519)) {
    return { status: "mismatch", serverEd25519, serverCurve25519 };
  }
  return { status: "match" };
}

/** Query M→S→D public evidence. The homeserver `verified` flag is intentionally ignored. */
export async function queryMatrixKeys(userId: string, deviceId: string, homeserver: string, accessToken: string, fetchImpl: typeof fetch = fetch): Promise<MatrixDiscoveredKeys> {
  validUserId(userId);
  const response = await matrixJson<KeysQueryResponse>(homeserver, accessToken, "/_matrix/client/v3/keys/query", { device_keys: { [userId]: [] } }, fetchImpl);
  const master = response.master_keys?.[userId];
  const selfSigning = response.self_signing_keys?.[userId];
  const device = response.device_keys?.[userId]?.[deviceId];
  const [masterKeyId, masterKeyBase64] = firstKey(master, "ed25519:", "cross-signing master key");
  const [selfKeyId, selfKeyBase64] = firstKey(selfSigning, "ed25519:", "self-signing key");
  const [deviceEdKeyId, deviceEdKeyBase64] = firstKey(device, "ed25519:", "device ed25519 key");
  const [deviceCurveKeyId, deviceCurveKeyBase64] = firstKey(device, "curve25519:", "device curve25519 key");
  if (deviceEdKeyId !== `ed25519:${deviceId}` || deviceCurveKeyId !== `curve25519:${deviceId}`) throw new MatrixConnectorError("CROSS_SIGNING_UNAVAILABLE", "Matrix device key IDs do not match the logged-in device");
  const masterPublicKey = fixedBase64(masterKeyBase64, 32, "master public key");
  const selfSigningPublicKey = fixedBase64(selfKeyBase64, 32, "self-signing public key");
  const masterSignature = signedBy(selfSigning, userId, masterKeyId, "master to self-signing signature");
  const deviceCurve25519Key = fixedBase64(deviceCurveKeyBase64, 32, "device curve25519 key");
  const deviceEd25519Key = fixedBase64(deviceEdKeyBase64, 32, "device ed25519 key");
  const selfSigningSignature = (() => {
    try { return signedBy(device, userId, selfKeyId, "self-signing to device signature", "DEVICE_NOT_VERIFIED"); }
    catch (error) {
      if (error instanceof MatrixConnectorError && error.code === "DEVICE_NOT_VERIFIED") return null;
      throw error;
    }
  })();
  const proof: MatrixControlClaimProofV1 | null = selfSigningSignature ? {
    userId,
    selfSigningPublicKey,
    masterSignature,
    deviceId,
    algorithms: device?.algorithms ?? [],
    deviceCurve25519Key,
    deviceEd25519Key,
    selfSigningSignature,
  } : null;
  return {
    userId,
    masterPublicKey,
    selfSigningPublicKey,
    masterSignature,
    deviceId,
    deviceCurve25519Key,
    deviceEd25519Key,
    selfSigningSignature,
    algorithms: device?.algorithms ?? [],
    proof,
    encodedProof: proof ? encodeMatrixControlClaimProofV1(proof) : null,
    verification: proof ? "verified" : "pending",
  };
}

const recipientCache = new Map<string, { expiresAt: number; ownership: Ownership }>();

/** Resolve a Matrix ID to its stable master Ownership, never to a device key. */
export async function resolveMatrixMasterOwnership(userId: string, homeserver: string, accessToken?: string): Promise<Ownership> {
  const key = `${homeserver.replace(/\/$/, "")}|${userId}`;
  const cached = recipientCache.get(key);
  if (cached && cached.expiresAt > Date.now()) return { ...cached.ownership, public: cached.ownership.public.slice() };
  const response = await matrixJson<KeysQueryResponse>(homeserver, accessToken, "/_matrix/client/v3/keys/query", { device_keys: { [userId]: [] } });
  const [, value] = firstKey(response.master_keys?.[userId], "ed25519:", "cross-signing master key");
  const publicKey = fixedBase64(value, 32, "master public key");
  const ownership = matrixOwnership(publicKey);
  recipientCache.set(key, { expiresAt: Date.now() + 5 * 60_000, ownership });
  return { ...ownership, public: ownership.public.slice() };
}

export function clearMatrixRecipientCache(): void { recipientCache.clear(); }
