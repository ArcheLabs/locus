import type {
  CodecValue,
  Ownership as JamOwnership,
  OwnershipSigner,
  PreparedOwnershipAction,
  OwnershipPreparationPhase as JamOwnershipPreparationPhase,
  SignedOwnershipAction,
  SubmitActionResult,
  TransactionStatusResult as JamTransactionStatusResult,
  FinalizedContext,
  WaitForActionResult,
  TransactionTrackingOptions,
  TransactionLifecycleUpdate,
  SignedActionTrackingInfo,
  PreparedActionTrackingInfo,
  BackendCapabilitiesV1,
} from "@jamscript/client";

export type { PreparedOwnershipAction, SignedOwnershipAction };
export type { TransactionTrackingOptions, TransactionLifecycleUpdate, SignedActionTrackingInfo, PreparedActionTrackingInfo };
export type OwnershipPreparationPhase = JamOwnershipPreparationPhase | "READING_BEST_CONTEXT" | "READING_FINALIZED_CONTEXT";

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
  context?: FinalizedContext & { contextType?: "best" | "finalized" };
  stateRoot?: string;
}

export type LocusTransactionStatusResult = Omit<JamTransactionStatusResult, "status"> & {
  status: JamTransactionStatusResult["status"] | "reorged";
  bestChainStatus?: "included" | "not_included" | "unknown";
  bestContext?: FinalizedContext & { contextType: "best" };
  finalized?: boolean;
};

export interface OwnershipSession {
  signer: OwnershipSigner;
  /** Stable Locus identity/asset subject. */
  subject: Ownership;
}

/** The subset implemented by the published @jamscript/client package. */
export interface JamScriptLikeClient {
  assertTransactionLifecycleSupport(): Promise<BackendCapabilitiesV1>;
  transactionScope(): { genesisHash: string; networkDomain: string; serviceId: number; serviceKey: string; codeHash: string };
  submitOwnershipAction(
    actionName: string,
    input: Record<string, CodecValue>,
    signer: OwnershipSigner,
    options?: {
      ttl?: bigint;
      extrinsics?: Uint8Array[];
      onPrepared?: (info: PreparedActionTrackingInfo) => void | Promise<void>;
      onSigned?: (info: SignedActionTrackingInfo) => void | Promise<void>;
    },
  ): Promise<SubmitActionResult>;
  queryLatest(queryName: string, key?: CodecValue): Promise<LocusQueryResult>;
  queryBest(queryName: string, key?: CodecValue): Promise<LocusQueryResult>;
  queryFinalized(queryName: string, key?: CodecValue): Promise<LocusQueryResult>;
  waitForAction(
    transactionId: string,
    optionsOrActionHash?: TransactionTrackingOptions | string,
    legacyOptions?: TransactionTrackingOptions,
  ): Promise<WaitForActionResult>;
  waitForBest(transactionId: string, options?: TransactionTrackingOptions): Promise<LocusTransactionStatusResult>;
  waitForFinalized(transactionId: string, options?: TransactionTrackingOptions): Promise<WaitForActionResult>;
  watchTransaction(transactionId: string, options?: TransactionTrackingOptions): Promise<WaitForActionResult>;
  prepareOwnershipAction(
    actionName: string,
    input: Record<string, CodecValue>,
    signer: OwnershipSigner,
    options?: { actAs?: JamOwnership; ttl?: bigint; extrinsics?: Uint8Array[]; onProgress?: (phase: OwnershipPreparationPhase) => void },
  ): Promise<PreparedOwnershipAction>;
  signPreparedOwnershipAction(prepared: PreparedOwnershipAction): Promise<SignedOwnershipAction>;
  abandonPreparedOwnershipAction(prepared: PreparedOwnershipAction): void;
  abandonSignedOwnershipAction(signed: SignedOwnershipAction): void;
  submitSignedOwnershipAction(signed: SignedOwnershipAction, options?: { onSigned?: (info: SignedActionTrackingInfo) => void | Promise<void> }): Promise<SubmitActionResult>;
  transactionStatus(transactionId: string): Promise<LocusTransactionStatusResult>;
  finalizedContext(): Promise<FinalizedContext>;
  bestContext(): Promise<FinalizedContext & { contextType: "best" }>;
}

export type LocusActionSubmissionOptions = {
  onPrepared?: (info: PreparedActionTrackingInfo) => void | Promise<void>;
  onSigned?: (info: SignedActionTrackingInfo) => void | Promise<void>;
};

export type ActionReceipt = WaitForActionResult;
