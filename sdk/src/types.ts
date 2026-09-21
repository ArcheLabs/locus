import type {
  CodecValue,
  Ownership as JamOwnership,
  OwnershipSigner,
  SubmitActionResult,
  WaitForActionResult,
} from "@jamscript/client";

export type Ownership = JamOwnership;
export type AssetId = Uint8Array;
export type Amount = bigint;

export type LocusRecord = { [key: string]: LocusValue };
export type LocusValue = CodecValue;

export interface Asset {
  version: 2;
  issuer: Ownership;
  name: Uint8Array;
  symbol: Uint8Array;
  decimals: number;
  totalSupply: Amount;
}

export interface LocusQueryResult {
  value: LocusValue | null;
}

export interface OwnershipSession {
  signer: OwnershipSigner;
  /** Stable Locus identity/asset subject. */
  subject: Ownership;
}

/** The subset implemented by the published @jamscript/client package. */
export interface JamScriptLikeClient {
  submitOwnershipAction(
    actionName: string,
    input: Record<string, CodecValue>,
    signer: OwnershipSigner,
    options?: { ttl?: bigint; extrinsics?: Uint8Array[] },
  ): Promise<SubmitActionResult>;
  queryLatest(queryName: string, key?: CodecValue): Promise<LocusQueryResult>;
  waitForAction(
    transactionId: string,
    options?: { intervalMs?: number; timeoutMs?: number },
  ): Promise<WaitForActionResult>;
}

export type ActionReceipt = WaitForActionResult;
