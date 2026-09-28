import type { AddLiquidityQuote, Amount, RemoveLiquidityQuote } from "./types.js";

const MAX_POOL_RESERVE = (1n << 64n) - 1n;
const MAX_U128 = (1n << 128n) - 1n;
const BPS = 10_000n;

function assertU128(value: bigint, label: string): void {
  if (typeof value !== "bigint" || value < 0n || value > MAX_U128) throw new RangeError(`${label} must be a u128 bigint`);
}

function checkedMul(left: bigint, right: bigint, label: string): bigint {
  if (left !== 0n && right > MAX_U128 / left) throw new RangeError(`${label} overflows u128`);
  return left * right;
}

export function ceilDiv(value: Amount, denominator: Amount): Amount {
  assertU128(value, "value");
  assertU128(denominator, "denominator");
  if (denominator === 0n) throw new RangeError("denominator must be greater than zero");
  return value === 0n ? 0n : 1n + (value - 1n) / denominator;
}

export function integerSqrt(value: Amount): Amount {
  assertU128(value, "value");
  if (value < 2n) return value;
  let low = 1n;
  let high = MAX_POOL_RESERVE;
  let result = 1n;
  while (low <= high) {
    const middle = low + (high - low) / 2n;
    if (middle <= value / middle) {
      result = middle;
      low = middle + 1n;
    } else {
      high = middle - 1n;
    }
  }
  return result;
}

export function quoteInitialLiquidity(amount0: Amount, amount1: Amount): AddLiquidityQuote {
  for (const [value, label] of [[amount0, "amount0"], [amount1, "amount1"]] as const) {
    assertU128(value, label);
    if (value === 0n || value > MAX_POOL_RESERVE) throw new RangeError(`${label} is outside the pool reserve limit`);
  }
  const sharesMinted = integerSqrt(checkedMul(amount0, amount1, "initial liquidity product"));
  if (sharesMinted === 0n) throw new RangeError("deposit is too small to mint liquidity shares");
  return { maxAmount0: amount0, maxAmount1: amount1, amount0Used: amount0, amount1Used: amount1, sharesMinted };
}

export function quoteAddLiquidity(
  reserve0: Amount,
  reserve1: Amount,
  totalShares: Amount,
  maxAmount0: Amount,
  maxAmount1: Amount,
): AddLiquidityQuote {
  for (const [value, label] of [[reserve0, "reserve0"], [reserve1, "reserve1"], [totalShares, "totalShares"], [maxAmount0, "maxAmount0"], [maxAmount1, "maxAmount1"]] as const) assertU128(value, label);
  if (reserve0 > MAX_POOL_RESERVE || reserve1 > MAX_POOL_RESERVE || maxAmount0 > MAX_POOL_RESERVE || maxAmount1 > MAX_POOL_RESERVE) {
    throw new RangeError("pool reserve limit exceeded");
  }
  if (maxAmount0 === 0n || maxAmount1 === 0n) throw new RangeError("liquidity amounts must be greater than zero");
  if (totalShares === 0n) {
    if (reserve0 !== 0n || reserve1 !== 0n) throw new RangeError("pool state invariant violated");
    return quoteInitialLiquidity(maxAmount0, maxAmount1);
  }
  if (reserve0 === 0n || reserve1 === 0n) throw new RangeError("pool state invariant violated");
  const shares0 = checkedMul(maxAmount0, totalShares, "share quote") / reserve0;
  const shares1 = checkedMul(maxAmount1, totalShares, "share quote") / reserve1;
  const sharesMinted = shares0 < shares1 ? shares0 : shares1;
  if (sharesMinted === 0n) throw new RangeError("deposit is too small to mint a liquidity share");
  const amount0Used = ceilDiv(checkedMul(sharesMinted, reserve0, "deposit amount"), totalShares);
  const amount1Used = ceilDiv(checkedMul(sharesMinted, reserve1, "deposit amount"), totalShares);
  if (amount0Used > maxAmount0 || amount1Used > maxAmount1) throw new Error("liquidity quote exceeded maximum amounts");
  if (reserve0 + amount0Used > MAX_POOL_RESERVE || reserve1 + amount1Used > MAX_POOL_RESERVE) throw new RangeError("pool reserve limit exceeded");
  return { maxAmount0, maxAmount1, amount0Used, amount1Used, sharesMinted };
}

export function quoteRemoveLiquidity(
  reserve0: Amount,
  reserve1: Amount,
  totalShares: Amount,
  ownerShares: Amount,
  sharesBurned: Amount,
): RemoveLiquidityQuote {
  for (const [value, label] of [[reserve0, "reserve0"], [reserve1, "reserve1"], [totalShares, "totalShares"], [ownerShares, "ownerShares"], [sharesBurned, "sharesBurned"]] as const) assertU128(value, label);
  if (sharesBurned === 0n) throw new RangeError("shares must be greater than zero");
  if (sharesBurned > ownerShares || sharesBurned > totalShares) throw new RangeError("insufficient liquidity shares");
  if (totalShares === 0n || reserve0 === 0n || reserve1 === 0n) throw new RangeError("pool state invariant violated");
  const lastLp = sharesBurned === totalShares;
  const amount0 = lastLp ? reserve0 : checkedMul(sharesBurned, reserve0, "withdrawal amount") / totalShares;
  const amount1 = lastLp ? reserve1 : checkedMul(sharesBurned, reserve1, "withdrawal amount") / totalShares;
  return { sharesBurned, amount0, amount1 };
}

export function minimumLiquidityAmount(expected: Amount, slippageBps: number): Amount {
  assertU128(expected, "expected");
  if (!Number.isInteger(slippageBps) || slippageBps < 0 || slippageBps >= 10_000) throw new RangeError("slippageBps must be an integer from 0 to 9999");
  return expected * BigInt(10_000 - slippageBps) / BPS;
}

export function formatLiquiditySharePercentage(shares: Amount, totalShares: Amount): string {
  assertU128(shares, "shares");
  assertU128(totalShares, "totalShares");
  if (totalShares === 0n) return "0%";
  if (shares > totalShares) throw new RangeError("shares cannot exceed totalShares");
  const hundredths = shares * 10_000n / totalShares;
  if (hundredths === 0n && shares > 0n) return "<0.01%";
  const whole = hundredths / 100n;
  const fraction = String(hundredths % 100n).padStart(2, "0");
  return `${whole}.${fraction}%`;
}
