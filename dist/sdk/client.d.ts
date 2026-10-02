import { type Ownership, type SubmitActionResult } from "@jamscript/client";
import type { Amount, Asset, AssetId, JamScriptLikeClient, LocusValue, ExactInQuote, OwnershipSession, LiquidityPosition, AddLiquidityQuote, RemoveLiquidityQuote, PreparedOwnershipAction, OwnershipPreparationPhase, SignedOwnershipAction, Pool } from "./types.js";
export declare const MAX_POOL_RESERVE: bigint;
export declare const SWAP_FEE_BPS: 30;
export type ControllerStatus = "absent" | "active" | "revoked";
export declare function canonicalPoolKey(assetA: AssetId, assetB: AssetId): {
    asset0: AssetId;
    asset1: AssetId;
};
export declare function quoteExactIn(reserveIn: Amount, reserveOut: Amount, amountIn: Amount): ExactInQuote;
export declare function minimumAmountOut(amountOut: Amount, slippageBps: number): Amount;
export declare class LocusClient {
    readonly jamClient: JamScriptLikeClient;
    readonly session?: (OwnershipSession | null) | undefined;
    constructor(jamClient: JamScriptLikeClient, session?: (OwnershipSession | null) | undefined);
    withSession(session: OwnershipSession | null): LocusClient;
    private requireSession;
    private submit;
    private queryValue;
    waitForAction(transactionId: string, options?: {
        intervalMs?: number;
        timeoutMs?: number;
    }): Promise<import("@jamscript/client").WaitForActionResult>;
    waitForActionByHash(transactionId: string, actionHash: string, options?: {
        intervalMs?: number;
        timeoutMs?: number;
    }): Promise<import("@jamscript/client").WaitForActionResult>;
    /** Complete all deployment/state reads before the caller opens a wallet. */
    prepareOwnershipAction(actionName: string, input: Record<string, LocusValue>, options?: {
        onProgress?: (phase: OwnershipPreparationPhase) => void;
    }): Promise<PreparedOwnershipAction>;
    /** Starts the wallet request synchronously when called from a user gesture. */
    signPreparedOwnershipAction(prepared: PreparedOwnershipAction): Promise<SignedOwnershipAction>;
    abandonPreparedOwnershipAction(prepared: PreparedOwnershipAction): void;
    submitSignedOwnershipAction(signed: SignedOwnershipAction): Promise<SubmitActionResult>;
    transactionStatus(transactionId: string): Promise<import("@jamscript/client").TransactionStatusResult>;
    finalizedContext(): Promise<import("@jamscript/client").FinalizedContext>;
    bestContext(): Promise<import("./types.js").BestContext>;
    createAsset(assetId: AssetId, name: string | Uint8Array, symbol: string | Uint8Array, decimals: number, initialSupply: Amount, initialHolder?: Ownership): Promise<SubmitActionResult>;
    prepareCreateAsset(assetId: AssetId, name: string | Uint8Array, symbol: string | Uint8Array, decimals: number, initialSupply: Amount, initialHolder?: Ownership, onProgress?: (phase: OwnershipPreparationPhase) => void): Promise<PreparedOwnershipAction>;
    private createAssetInput;
    transfer(assetId: AssetId, to: Ownership, amount: Amount): Promise<SubmitActionResult>;
    approve(assetId: AssetId, spender: Ownership, amount: Amount): Promise<SubmitActionResult>;
    transferFrom(assetId: AssetId, from: Ownership, to: Ownership, amount: Amount): Promise<SubmitActionResult>;
    mint(assetId: AssetId, to: Ownership, amount: Amount): Promise<SubmitActionResult>;
    burn(assetId: AssetId, amount: Amount): Promise<SubmitActionResult>;
    authorizeMatrixController(proof: Uint8Array): Promise<SubmitActionResult>;
    addController(controller: Ownership): Promise<SubmitActionResult>;
    revokeController(controller: Ownership): Promise<SubmitActionResult>;
    getControllerStatus(subject: Ownership, controller: Ownership): Promise<ControllerStatus>;
    isControllerActive(subject: Ownership, controller: Ownership): Promise<boolean>;
    getAsset(assetId: AssetId): Promise<Asset | null>;
    balanceOf(assetId: AssetId, owner: Ownership): Promise<Amount>;
    allowance(assetId: AssetId, owner: Ownership, spender: Ownership): Promise<Amount>;
    listAssets(): Promise<AssetId[]>;
    getPool(assetA: AssetId, assetB: AssetId): Promise<Pool | null>;
    listPools(options?: {
        offset?: bigint;
        limit?: number;
    }): Promise<Pool[]>;
    pool(assetA: AssetId, assetB: AssetId): BoundPool;
    createPool(assetA: AssetId, assetB: AssetId, amountA: Amount, amountB: Amount): Promise<SubmitActionResult>;
    addPoolLiquidity(assetA: AssetId, assetB: AssetId, maxAmountA: Amount, maxAmountB: Amount, minShares: Amount): Promise<SubmitActionResult>;
    removePoolLiquidity(assetA: AssetId, assetB: AssetId, shares: Amount, minAmountA: Amount, minAmountB: Amount): Promise<SubmitActionResult>;
    liquiditySharesOf(assetA: AssetId, assetB: AssetId, owner: Ownership): Promise<Amount>;
    liquidityPositionCount(owner: Ownership): Promise<Amount>;
    quoteAddLiquidity(assetA: AssetId, assetB: AssetId, maxAmountA: Amount, maxAmountB: Amount): Promise<AddLiquidityQuote>;
    quoteRemoveLiquidity(assetA: AssetId, assetB: AssetId, owner: Ownership, shares: Amount): Promise<RemoveLiquidityQuote>;
    listLiquidityPositions(owner: Ownership, options?: {
        offset?: bigint;
        limit?: number;
    }): Promise<LiquidityPosition[]>;
    swapExactIn(assetIn: AssetId, assetOut: AssetId, amountIn: Amount, minAmountOut: Amount): Promise<SubmitActionResult>;
    quoteExactIn(assetIn: AssetId, assetOut: AssetId, amountIn: Amount): Promise<ExactInQuote>;
    quoteAddLiquidityForPool(asset0: AssetId, asset1: AssetId, maxAmount0: Amount, maxAmount1: Amount): Promise<AddLiquidityQuote>;
    quoteRemoveLiquidityForPool(asset0: AssetId, asset1: AssetId, owner: Ownership, shares: Amount): Promise<RemoveLiquidityQuote>;
    asset(assetId: AssetId): BoundAsset;
}
export declare class BoundPool {
    private readonly client;
    readonly asset0: AssetId;
    readonly asset1: AssetId;
    constructor(client: LocusClient, asset0: AssetId, asset1: AssetId);
    get(): Promise<Pool | null>;
    quoteExactIn(assetIn: AssetId, amountIn: Amount): Promise<ExactInQuote>;
    swapExactIn(assetIn: AssetId, amountIn: Amount, minAmountOut: Amount): Promise<SubmitActionResult>;
    addLiquidity(maxAmount0: Amount, maxAmount1: Amount, minShares: Amount): Promise<SubmitActionResult>;
    removeLiquidity(shares: Amount, minAmount0: Amount, minAmount1: Amount): Promise<SubmitActionResult>;
    sharesOf(owner: Ownership): Promise<Amount>;
    quoteAddLiquidity(maxAmount0: Amount, maxAmount1: Amount): Promise<AddLiquidityQuote>;
    quoteRemoveLiquidity(owner: Ownership, shares: Amount): Promise<RemoveLiquidityQuote>;
}
export declare class BoundAsset {
    private readonly client;
    readonly assetId: AssetId;
    constructor(client: LocusClient, assetId: AssetId);
    private metadata;
    name(): Promise<string>;
    symbol(): Promise<string>;
    decimals(): Promise<number>;
    issuer(): Promise<Ownership>;
    totalSupply(): Promise<Amount>;
    balanceOf(owner: Ownership): Promise<Amount>;
    transfer(to: Ownership, amount: Amount): Promise<SubmitActionResult>;
    approve(spender: Ownership, amount: Amount): Promise<SubmitActionResult>;
    allowance(owner: Ownership, spender: Ownership): Promise<Amount>;
    transferFrom(from: Ownership, to: Ownership, amount: Amount): Promise<SubmitActionResult>;
    mint(to: Ownership, amount: Amount): Promise<SubmitActionResult>;
    burn(amount: Amount): Promise<SubmitActionResult>;
}
