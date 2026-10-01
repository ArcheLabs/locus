import type { CodecValue, Ownership as JamOwnership, OwnershipSigner, PreparedOwnershipAction, OwnershipPreparationPhase, SignedOwnershipAction, SubmitActionResult, TransactionStatusResult, FinalizedContext, WaitForActionResult } from "@jamscript/client";
export type { PreparedOwnershipAction, SignedOwnershipAction, OwnershipPreparationPhase };
export type Ownership = JamOwnership;
export type AssetId = Uint8Array;
export type Amount = bigint;
export type LocusRecord = {
    [key: string]: LocusValue;
};
export type LocusValue = CodecValue;
export interface Asset {
    version: 2;
    issuer: Ownership;
    name: Uint8Array;
    symbol: Uint8Array;
    decimals: number;
    totalSupply: Amount;
}
export interface Pool {
    version: 2;
    asset0: AssetId;
    asset1: AssetId;
    reserve0: Amount;
    reserve1: Amount;
    totalShares: Amount;
}
export interface LiquidityPosition {
    pool: Pool;
    shares: Amount;
    amount0: Amount;
    amount1: Amount;
}
export interface AddLiquidityQuote {
    maxAmount0: Amount;
    maxAmount1: Amount;
    amount0Used: Amount;
    amount1Used: Amount;
    sharesMinted: Amount;
}
export interface RemoveLiquidityQuote {
    sharesBurned: Amount;
    amount0: Amount;
    amount1: Amount;
}
export interface ExactInQuote {
    amountIn: Amount;
    amountOut: Amount;
    minimumAmountOut: Amount;
    feeAmount: Amount;
    feeBps: 30;
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
    submitOwnershipAction(actionName: string, input: Record<string, CodecValue>, signer: OwnershipSigner, options?: {
        ttl?: bigint;
        extrinsics?: Uint8Array[];
    }): Promise<SubmitActionResult>;
    queryLatest(queryName: string, key?: CodecValue): Promise<LocusQueryResult>;
    waitForAction(transactionId: string, optionsOrActionHash?: {
        intervalMs?: number;
        timeoutMs?: number;
    } | string, legacyOptions?: {
        intervalMs?: number;
        timeoutMs?: number;
    }): Promise<WaitForActionResult>;
    prepareOwnershipAction?(actionName: string, input: Record<string, CodecValue>, signer: OwnershipSigner, options?: {
        actAs?: JamOwnership;
        ttl?: bigint;
        extrinsics?: Uint8Array[];
        onProgress?: (phase: OwnershipPreparationPhase) => void;
    }): Promise<PreparedOwnershipAction>;
    signPreparedOwnershipAction?(prepared: PreparedOwnershipAction): Promise<SignedOwnershipAction>;
    abandonPreparedOwnershipAction?(prepared: PreparedOwnershipAction): void;
    submitSignedOwnershipAction?(signed: SignedOwnershipAction): Promise<SubmitActionResult>;
    transactionStatus?(transactionId: string): Promise<TransactionStatusResult>;
    finalizedContext?(): Promise<FinalizedContext>;
}
export type ActionReceipt = WaitForActionResult;
