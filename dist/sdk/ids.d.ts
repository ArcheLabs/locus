import type { AssetId } from "./types.js";
export declare function randomAssetId(): AssetId;
export declare function isZeroId(value: Uint8Array): boolean;
export declare function assertId(value: Uint8Array, label: string): void;
