export declare const LOCUS_ERROR_CODES: {
    readonly NO_OWNERSHIP_SESSION: 1001;
    readonly ASSET_NOT_FOUND: 2001;
    readonly ASSET_ALREADY_EXISTS: 2002;
    readonly INVALID_ASSET_ID: 2003;
    readonly INVALID_ASSET_NAME: 2004;
    readonly INVALID_ASSET_SYMBOL: 2005;
    readonly INVALID_DECIMALS: 2006;
    readonly NOT_ASSET_ISSUER: 2007;
    readonly INSUFFICIENT_BALANCE: 3002;
    readonly AMOUNT_OVERFLOW: 3003;
    readonly INSUFFICIENT_ALLOWANCE: 4002;
    readonly CONTROLLER_NOT_AUTHORIZED: 5001;
    readonly CONTROLLER_ALREADY_ACTIVE: 5002;
    readonly CONTROLLER_REVOKED: 5003;
    readonly MATRIX_PROOF_INVALID: 5005;
    readonly CONTROLLER_NOT_ACTIVE: 5006;
    readonly POOL_NOT_FOUND: 6001;
    readonly POOL_ALREADY_EXISTS: 6002;
    readonly INVALID_POOL_PAIR: 6003;
    readonly INVALID_SWAP_AMOUNT: 6004;
    readonly INSUFFICIENT_POOL_LIQUIDITY: 6005;
    readonly SLIPPAGE_EXCEEDED: 6006;
    readonly RESERVED_POOL_MANAGER_REQUIRED_V1: 6007;
    readonly POOL_RESERVE_LIMIT: 6008;
    readonly INVALID_LIQUIDITY_AMOUNT: 6009;
    readonly INSUFFICIENT_LIQUIDITY_SHARES: 6010;
    readonly LIQUIDITY_SLIPPAGE_EXCEEDED: 6011;
    readonly STATE_INVARIANT_VIOLATION: 9001;
};
export type LocusErrorCode = (typeof LOCUS_ERROR_CODES)[keyof typeof LOCUS_ERROR_CODES];
export declare class LocusError extends Error {
    readonly code: number | undefined;
    readonly locusName: string | undefined;
    constructor(message: string, code?: number, cause?: unknown);
}
export declare function normalizeLocusError(error: unknown): LocusError | null;
export declare function locusError(code: LocusErrorCode, message?: string): LocusError;
