export const MAX_POOL_RESERVE = (1n << 64n) - 1n;

export function parseHumanAmount(value, decimals, label = "amount") {
  if (typeof value !== "string" || !Number.isInteger(decimals) || decimals < 0 || decimals > 38) {
    throw new Error(`${label} has invalid human amount or asset decimals`);
  }
  const match = /^(0|[1-9][0-9]*)(?:\.([0-9]+))?$/.exec(value);
  if (!match) throw new Error(`${label} must be a plain non-negative decimal string`);
  const fraction = match[2] ?? "";
  if (fraction.length > decimals) throw new Error(`${label} has more fractional digits than the asset supports`);
  const raw = BigInt(match[1]) * (10n ** BigInt(decimals))
    + BigInt((fraction + "0".repeat(decimals)).slice(0, decimals) || "0");
  if (raw <= 0n || raw > MAX_POOL_RESERVE) throw new Error(`${label} is outside the supported pool reserve range`);
  return raw;
}

export function validateLiquidityManifest(configuration) {
  if (configuration?.version !== 1 || configuration.network !== "local" || configuration.demoOnly !== true || configuration.amountUnit !== "human" || !Array.isArray(configuration.pools) || configuration.pools.length !== 5) {
    throw new Error("Local liquidity manifest must define exactly five demo-only pools in human units");
  }
  const expected = [
    { base: "DOT", baseAmount: "100000", quoteAmount: "500000" },
    { base: "MINI", baseAmount: "10000000", quoteAmount: "1000000" },
    { base: "AAPL", baseAmount: "10000", quoteAmount: "1000000" },
    { base: "NVDA", baseAmount: "10000", quoteAmount: "1000000" },
    { base: "TSLA", baseAmount: "10000", quoteAmount: "1000000" },
  ];
  for (let index = 0; index < expected.length; index += 1) {
    const entry = configuration.pools[index];
    const approved = expected[index];
    if (entry?.base !== approved.base || entry.quote !== "USDT"
        || entry.baseAmount !== approved.baseAmount || entry.quoteAmount !== approved.quoteAmount) {
      throw new Error("Local liquidity manifest differs from the approved five demo pool ratios");
    }
  }
  return configuration.pools;
}
