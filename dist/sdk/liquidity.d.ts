import type { AddLiquidityQuote, Amount, RemoveLiquidityQuote } from "./types.js";
export declare function ceilDiv(value: Amount, denominator: Amount): Amount;
export declare function integerSqrt(value: Amount): Amount;
export declare function quoteInitialLiquidity(amount0: Amount, amount1: Amount): AddLiquidityQuote;
export declare function quoteAddLiquidity(reserve0: Amount, reserve1: Amount, totalShares: Amount, maxAmount0: Amount, maxAmount1: Amount): AddLiquidityQuote;
export declare function quoteRemoveLiquidity(reserve0: Amount, reserve1: Amount, totalShares: Amount, ownerShares: Amount, sharesBurned: Amount): RemoveLiquidityQuote;
export declare function minimumLiquidityAmount(expected: Amount, slippageBps: number): Amount;
export declare function formatLiquiditySharePercentage(shares: Amount, totalShares: Amount): string;
