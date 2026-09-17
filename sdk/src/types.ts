export type IdentityId = Uint8Array;
export type AssetId = Uint8Array;
export type Amount = bigint;

export type LocusRecord = { [key: string]: LocusValue };
export type LocusValue = Uint8Array | bigint | number | boolean | LocusRecord;

export interface IdentityOwnerV1 {
  version: number;
  scheme: number;
  payload: Uint8Array;
}

export interface IdentityV1 {
  version: number;
  owner: IdentityOwnerV1;
}

export interface AssetV1 {
  version: number;
  issuer: IdentityId;
  name: Uint8Array;
  symbol: Uint8Array;
  decimals: number;
  totalSupply: Amount;
}

export interface LocusQueryResult {
  value: LocusValue | null;
}

/**
 * Deliberately small boundary around JamScript's client. Signing, wallet
 * nonces, ABI encoding, managed-state proofs, and Work submission remain
 * owned by the injected JamScript client/adapter.
 */
export interface JamScriptLikeClient {
  submitAction(
    actionName: string,
    input: Record<string, LocusValue>,
  ): Promise<unknown>;
  queryLatest(queryName: string, key?: LocusValue): Promise<LocusQueryResult>;
  waitForAction(transactionId: string, options?: Record<string, LocusValue>): Promise<unknown>;
}

export interface LocusActionReceipt {
  [key: string]: unknown;
}
