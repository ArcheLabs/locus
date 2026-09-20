import {
  encodeOwnership,
  decodeOwnership,
  ownershipKey,
  OWNERSHIP_KIND,
  parseHex,
  toHex,
  type Ownership,
} from "@jamscript/client";
import { decodeAddress } from "@polkadot/util-crypto";

export {
  encodeOwnership,
  decodeOwnership,
  ownershipKey,
  OWNERSHIP_KIND,
  parseHex,
  toHex,
};

export function evmOwnership(address: string): Ownership {
  const normalized = address.trim();
  return {
    version: 1,
    kind: OWNERSHIP_KIND.SECP256K1_KECCAK20,
    public: parseHex(normalized, 20),
  };
}

export function polkadotOwnership(address: string): Ownership {
  const publicKey = decodeAddress(address.trim());
  if (publicKey.length !== 32) throw new Error("Polkadot address must decode to AccountId32");
  return {
    version: 1,
    kind: OWNERSHIP_KIND.MULTICRYPTO_ACCOUNT32,
    public: publicKey,
  };
}

export function matrixOwnership(masterEd25519PublicKey: Uint8Array): Ownership {
  if (masterEd25519PublicKey.length !== 32) throw new Error("Matrix master key must be 32 bytes");
  return {
    version: 1,
    kind: OWNERSHIP_KIND.ED25519_KEY,
    public: masterEd25519PublicKey.slice(),
  };
}

const BASE58_ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

/** Decode a Solana base58 public key into the canonical ED25519 Ownership form. */
export function solanaOwnership(address: string): Ownership {
  const normalized = address.trim();
  if (!normalized) throw new Error("Solana address is empty");
  const bytes: number[] = [];
  for (const character of normalized) {
    const value = BASE58_ALPHABET.indexOf(character);
    if (value < 0) throw new Error("Solana address is not valid base58");
    let carry = value;
    for (let index = 0; index < bytes.length; index += 1) {
      const next = bytes[index] * 58 + carry;
      bytes[index] = next & 0xff;
      carry = next >> 8;
    }
    while (carry > 0) {
      bytes.push(carry & 0xff);
      carry >>= 8;
    }
  }
  for (let index = 0; index < normalized.length && normalized[index] === "1"; index += 1) bytes.push(0);
  bytes.reverse();
  if (bytes.length !== 32) throw new Error("Solana address must decode to 32 bytes");
  return {
    version: 1,
    kind: OWNERSHIP_KIND.ED25519_KEY,
    public: Uint8Array.from(bytes),
  };
}

function base64Url(value: Uint8Array): string {
  let binary = "";
  for (const byte of value) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

export function formatLocusId(owner: Ownership): string {
  return `locus:${base64Url(encodeOwnership(owner))}`;
}

export function parseLocusId(value: string): Ownership {
  const normalized = value.trim();
  if (!normalized.toLowerCase().startsWith("locus:")) throw new Error("Locus ID must start with locus:");
  const encoded = normalized.slice("locus:".length).replace(/-/g, "+").replace(/_/g, "/");
  if (!encoded || !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)) throw new Error("Locus ID is not valid base64url");
  const padded = encoded.padEnd(Math.ceil(encoded.length / 4) * 4, "=");
  const binary = atob(padded);
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  return decodeOwnership(bytes);
}
