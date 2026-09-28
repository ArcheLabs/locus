function assertNonNegative(value: bigint, label: string): void {
  if (typeof value !== "bigint" || value < 0n) throw new RangeError(`${label} must be a non-negative bigint`);
}

function assertDecimals(decimals: number): void {
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 38) throw new RangeError("decimals must be between 0 and 38");
}

export function poolPriceDisplay(reserveA: bigint, reserveB: bigint, decimalsA: number, decimalsB: number, precision = 8): string {
  assertNonNegative(reserveA, "reserve A");
  assertNonNegative(reserveB, "reserve B");
  assertDecimals(decimalsA); assertDecimals(decimalsB);
  if (!Number.isInteger(precision) || precision < 0 || precision > 18) throw new RangeError("precision must be between 0 and 18");
  if (reserveA === 0n || reserveB === 0n) return "—";
  const scale = 10n ** BigInt(precision);
  const scaled = reserveB * 10n ** BigInt(decimalsA) * scale / (reserveA * 10n ** BigInt(decimalsB));
  const whole = scaled / scale;
  const fraction = (scaled % scale).toString().padStart(precision, "0").replace(/0+$/, "");
  return fraction ? `${whole}.${fraction}` : whole.toString();
}

export function formatBasisPoints(bps: number): string {
  if (!Number.isInteger(bps) || bps < 0) throw new RangeError("basis points must be a non-negative integer");
  return `${Math.floor(bps / 100)}.${String(bps % 100).padStart(2, "0")}%`;
}

export function proportionalAmount(amountIn: bigint, reserveIn: bigint, reserveOut: bigint): bigint {
  assertNonNegative(amountIn, "amount in");
  assertNonNegative(reserveIn, "reserve in");
  assertNonNegative(reserveOut, "reserve out");
  if (reserveIn === 0n) throw new RangeError("reserve in must be greater than zero");
  return amountIn * reserveOut / reserveIn;
}
