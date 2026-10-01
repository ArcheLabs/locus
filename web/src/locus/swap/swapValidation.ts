export function parseSlippageBps(value: string): number | null {
  const match = /^(\d+)(?:\.(\d{1,2}))?$/.exec(value.trim());
  if (!match) return null;
  const bps = BigInt(match[1]!) * 100n + BigInt((match[2] ?? "").padEnd(2, "0") || "0");
  return bps >= 1n && bps <= 5_000n ? Number(bps) : null;
}

/** Only a completed, successful pair lookup can establish that swapping is unsupported. */
export function isPairConfirmedUnsupported(input: {
  networkMode: boolean;
  hasInput: boolean;
  hasOutput: boolean;
  sameAsset: boolean;
  loading: boolean;
  error: boolean;
  hasPool: boolean;
  hasReserves: boolean;
}): boolean {
  return input.networkMode && input.hasInput && input.hasOutput && !input.sameAsset
    && !input.loading && !input.error && (!input.hasPool || !input.hasReserves);
}
