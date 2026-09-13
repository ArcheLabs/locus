import type { AssetId, IdentityId } from "./types.js";

function randomId(label: string): Uint8Array {
  const cryptoApi = globalThis.crypto;
  if (!cryptoApi || typeof cryptoApi.getRandomValues !== "function") {
    throw new Error(`${label} requires a Web Crypto secure random source`);
  }

  const result = new Uint8Array(32);
  cryptoApi.getRandomValues(result);
  if (result.every((byte) => byte === 0)) {
    throw new Error(`${label} unexpectedly generated an all-zero identifier`);
  }
  return result;
}

export function randomIdentityId(): IdentityId {
  return randomId("randomIdentityId");
}

export function randomAssetId(): AssetId {
  return randomId("randomAssetId");
}

export function isZeroId(value: Uint8Array): boolean {
  return value.length === 32 && value.every((byte) => byte === 0);
}

export function assertId(value: Uint8Array, label: string): void {
  if (!(value instanceof Uint8Array) || value.length !== 32 || isZeroId(value)) {
    throw new Error(`${label} must be a non-zero 32-byte identifier`);
  }
}
