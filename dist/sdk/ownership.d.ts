import { encodeOwnership, decodeOwnership, ownershipKey, OWNERSHIP_KIND, parseHex, toHex, type Ownership } from "@jamscript/client";
export { encodeOwnership, decodeOwnership, ownershipKey, OWNERSHIP_KIND, parseHex, toHex, };
export declare function evmOwnership(address: string): Ownership;
export declare function polkadotOwnership(address: string): Ownership;
export declare function matrixOwnership(masterEd25519PublicKey: Uint8Array): Ownership;
/** Decode a Solana base58 public key into the canonical ED25519 Ownership form. */
export declare function solanaOwnership(address: string): Ownership;
export declare function formatLocusId(owner: Ownership): string;
export declare function parseLocusId(value: string): Ownership;
