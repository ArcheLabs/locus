export const MAX_MANAGED_POOL_RESERVE = (1n << 64n) - 1n;
const BASIS_POINTS = 10_000n;

function assertNonNegative(value: bigint, label: string): void {
  if (typeof value !== "bigint" || value < 0n) throw new RangeError(`${label} must be a non-negative bigint`);
}

function assertDecimals(decimals: number): void {
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 38) throw new RangeError("decimals must be between 0 and 38");
}

export function canonicalPair<T extends Uint8Array>(assetA: T, assetB: T): [T, T] {
  if (assetA.length !== assetB.length || assetA.length === 0) throw new RangeError("asset IDs must have the same non-zero length");
  let comparison = 0;
  for (let index = 0; index < assetA.length; index += 1) {
    if (assetA[index] !== assetB[index]) {
      comparison = assetA[index]! < assetB[index]! ? -1 : 1;
      break;
    }
  }
  if (comparison === 0) throw new RangeError("a pool must contain two different assets");
  return comparison < 0 ? [assetA, assetB] : [assetB, assetA];
}

export function proportionalOtherAmount(amount: bigint, reserveEdited: bigint, reserveOther: bigint): bigint {
  assertNonNegative(amount, "amount");
  assertNonNegative(reserveEdited, "edited reserve");
  assertNonNegative(reserveOther, "other reserve");
  if (reserveEdited === 0n || reserveOther === 0n) throw new RangeError("pool needs reseeding before proportional liquidity can be added");
  return amount * reserveOther / reserveEdited;
}

export function maximumProportionalDeposit(
  balanceA: bigint,
  balanceB: bigint,
  reserveA: bigint,
  reserveB: bigint,
  maxA = MAX_MANAGED_POOL_RESERVE,
  maxB = MAX_MANAGED_POOL_RESERVE,
): { amountA: bigint; amountB: bigint } {
  for (const [value, label] of [[balanceA, "balance A"], [balanceB, "balance B"], [reserveA, "reserve A"], [reserveB, "reserve B"], [maxA, "maximum A"], [maxB, "maximum B"]] as const) {
    assertNonNegative(value, label);
  }
  if (reserveA === 0n || reserveB === 0n) throw new RangeError("pool needs reseeding before proportional liquidity can be added");
  const availableA = balanceA < maxA ? balanceA : maxA;
  const availableB = balanceB < maxB ? balanceB : maxB;
  const amountA = availableA < availableB * reserveA / reserveB
    ? availableA
    : availableB * reserveA / reserveB;
  const amountB = amountA * reserveB / reserveA;
  return { amountA, amountB };
}

export function proportionalWithdrawal(
  reserveA: bigint,
  reserveB: bigint,
  percentageBps: number,
): { amountA: bigint; amountB: bigint; remainingA: bigint; remainingB: bigint } {
  assertNonNegative(reserveA, "reserve A");
  assertNonNegative(reserveB, "reserve B");
  if (!Number.isInteger(percentageBps) || percentageBps < 1 || percentageBps > 10_000) {
    throw new RangeError("withdrawal percentage must be from 1 to 10000 basis points");
  }
  const bps = BigInt(percentageBps);
  const amountA = reserveA * bps / BASIS_POINTS;
  const amountB = reserveB * bps / BASIS_POINTS;
  return { amountA, amountB, remainingA: reserveA - amountA, remainingB: reserveB - amountB };
}

export function parsePercentageBps(value: string): number {
  const match = /^(\d{1,3})(?:\.(\d{1,2}))?$/.exec(value.trim());
  if (!match) throw new Error("Enter a percentage with up to two decimal places.");
  const whole = Number(match[1]);
  const fraction = Number((match[2] ?? "").padEnd(2, "0"));
  const bps = whole * 100 + fraction;
  if (!Number.isSafeInteger(bps) || bps < 1 || bps > 10_000) throw new RangeError("Percentage must be greater than 0% and no more than 100%.");
  return bps;
}

export function poolPriceDisplay(reserveA: bigint, reserveB: bigint, decimalsA: number, decimalsB: number, precision = 8): string {
  assertNonNegative(reserveA, "reserve A");
  assertNonNegative(reserveB, "reserve B");
  assertDecimals(decimalsA);
  assertDecimals(decimalsB);
  if (!Number.isInteger(precision) || precision < 0 || precision > 18) throw new RangeError("precision must be between 0 and 18");
  if (reserveA === 0n || reserveB === 0n) return "—";
  const scale = 10n ** BigInt(precision);
  const numerator = reserveB * 10n ** BigInt(decimalsA) * scale;
  const denominator = reserveA * 10n ** BigInt(decimalsB);
  const scaled = numerator / denominator;
  const whole = scaled / scale;
  const fraction = (scaled % scale).toString().padStart(precision, "0").replace(/0+$/, "");
  return fraction ? `${whole}.${fraction}` : whole.toString();
}

export function priceRatioWithinOneBasisPoint(
  reserveA: bigint,
  reserveB: bigint,
  amountA: bigint,
  amountB: bigint,
): boolean {
  for (const [value, label] of [[reserveA, "reserve A"], [reserveB, "reserve B"], [amountA, "amount A"], [amountB, "amount B"]] as const) {
    assertNonNegative(value, label);
  }
  if (reserveA === 0n || reserveB === 0n || amountA === 0n || amountB === 0n) return false;
  const oldRatioCross = amountA * reserveB;
  const newRatioCross = amountB * reserveA;
  const difference = oldRatioCross > newRatioCross ? oldRatioCross - newRatioCross : newRatioCross - oldRatioCross;
  return difference * BASIS_POINTS <= oldRatioCross;
}

export function formatBasisPoints(bps: number): string {
  if (!Number.isInteger(bps) || bps < 0) throw new RangeError("basis points must be a non-negative integer");
  const whole = Math.floor(bps / 100);
  const fraction = String(bps % 100).padStart(2, "0");
  return `${whole}.${fraction}%`;
}
