import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { evmOwnership, ownershipKey, toHex, MAX_POOL_RESERVE, SWAP_FEE_BPS } from "@archelabs/locus";
import {
  canonicalPair,
  formatBasisPoints,
  MAX_MANAGED_POOL_RESERVE,
  maximumProportionalDeposit,
  parsePercentageBps,
  poolPriceDisplay,
  priceRatioWithinOneBasisPoint,
  proportionalOtherAmount,
  proportionalWithdrawal,
} from "../web/src/locus/liquidity/liquidityMath.ts";
import {
  liquidityConfigPath,
  loadManagedLiquidityConfig,
  parseManagedLiquidityConfig,
} from "../web/src/locus/liquidity/liquidityConfig.ts";

const localCatalog = JSON.parse(await readFile(new URL("../web/public/catalogs/local.json", import.meta.url), "utf8"));
const catalogKeys = localCatalog.assets.map(({ key }) => key);
const managedPanelSource = await readFile(new URL("../web/src/locus/liquidity/ManagedLiquidityPanel.tsx", import.meta.url), "utf8");
const appSource = await readFile(new URL("../web/src/app.tsx", import.meta.url), "utf8");
const validConfig = {
  version: 1,
  network: "local",
  mode: "managed",
  managerKey: `0x${"ab".repeat(32)}`,
  pairs: [
    { assetA: "dot", assetB: "mini", enabled: true },
    { assetA: "mini", assetB: "usdt", enabled: true },
  ],
};

test("liquidity config path follows the active web base path", () => {
  assert.equal(liquidityConfigPath("local", "/"), "/liquidity/local.json");
  assert.equal(liquidityConfigPath("local", "/candidate/"), "/candidate/liquidity/local.json");
  assert.equal(liquidityConfigPath("local", "./"), "./liquidity/local.json");
});

test("managed liquidity config validates network, key, curated assets, and unordered pairs", () => {
  const parsed = parseManagedLiquidityConfig(validConfig, "local", catalogKeys);
  assert.equal(parsed.managerKey, validConfig.managerKey);
  assert.equal(parsed.pairs.length, 2);
  assert.throws(() => parseManagedLiquidityConfig(validConfig, "testnet", catalogKeys), /Invalid managed liquidity configuration/);
  assert.throws(() => parseManagedLiquidityConfig({ ...validConfig, managerKey: "0x1234" }, "local", catalogKeys), /Invalid managed liquidity configuration/);
  assert.throws(() => parseManagedLiquidityConfig({ ...validConfig, pairs: [{ assetA: "dot", assetB: "missing", enabled: true }] }, "local", catalogKeys), /unknown curated asset/);
  assert.throws(() => parseManagedLiquidityConfig({ ...validConfig, pairs: [{ assetA: "dot", assetB: "dot", enabled: true }] }, "local", catalogKeys), /two different assets/);
  assert.throws(() => parseManagedLiquidityConfig({ ...validConfig, pairs: [...validConfig.pairs, { assetA: "mini", assetB: "dot", enabled: true }] }, "local", catalogKeys), /duplicate pair/);
  assert.throws(() => parseManagedLiquidityConfig({ ...validConfig, pairs: [...validConfig.pairs, { assetA: "dot", assetB: "mini", enabled: false }] }, "local", catalogKeys), /duplicate pair/);
});

test("missing or invalid optional liquidity config does not throw or block its caller", async () => {
  const missing = await loadManagedLiquidityConfig("local", catalogKeys, "/candidate/", async (url) => {
    assert.equal(url, "/candidate/liquidity/local.json");
    return new Response("", { status: 404 });
  });
  const malformed = await loadManagedLiquidityConfig("local", catalogKeys, "/", async () => new Response("not json", { status: 200 }));
  assert.equal(missing, null);
  assert.equal(malformed, null);
});

test("proportional add uses exact integer amounts in both edited directions", () => {
  assert.equal(proportionalOtherAmount(10_000_000n, 1_000_000_000n, 500_000_000_000n), 5_000_000_000n);
  assert.equal(proportionalOtherAmount(5_000_000_000n, 500_000_000_000n, 1_000_000_000n), 10_000_000n);
  assert.throws(() => proportionalOtherAmount(1n, 0n, 1n), /reseed/);
});

test("maximum proportional deposit is limited by either balance and reserve headroom", () => {
  assert.deepEqual(maximumProportionalDeposit(100n, 10_000n, 10n, 1_000n), { amountA: 100n, amountB: 10_000n });
  assert.deepEqual(maximumProportionalDeposit(100n, 4_000n, 10n, 1_000n), { amountA: 40n, amountB: 4_000n });
  assert.deepEqual(maximumProportionalDeposit(100n, 10_000n, 10n, 1_000n, 25n, 9_999n), { amountA: 25n, amountB: 2_500n });
  assert.throws(() => maximumProportionalDeposit(1n, 1n, 0n, 1n), /reseed/);
  const nearLimit = MAX_MANAGED_POOL_RESERVE;
  assert.deepEqual(
    maximumProportionalDeposit(100n, 100n, nearLimit - 10n, nearLimit - 10n, 10n, 5n),
    { amountA: 5n, amountB: 5n },
  );
  assert.equal(MAX_MANAGED_POOL_RESERVE, (1n << 64n) - 1n);
  assert.equal(MAX_MANAGED_POOL_RESERVE, MAX_POOL_RESERVE);
});

test("withdrawal is proportional at 25, 50, and 100 percent", () => {
  assert.deepEqual(proportionalWithdrawal(100n, 50_000n, 2_500), { amountA: 25n, amountB: 12_500n, remainingA: 75n, remainingB: 37_500n });
  assert.deepEqual(proportionalWithdrawal(100n, 50_000n, 5_000), { amountA: 50n, amountB: 25_000n, remainingA: 50n, remainingB: 25_000n });
  assert.deepEqual(proportionalWithdrawal(100n, 50_000n, 10_000), { amountA: 100n, amountB: 50_000n, remainingA: 0n, remainingB: 0n });
  assert.throws(() => proportionalWithdrawal(1n, 1n, 0), /1 to 10000/);
});

test("custom percentages parse to basis points without floating point", () => {
  assert.equal(parsePercentageBps("25"), 2_500);
  assert.equal(parsePercentageBps("12.34"), 1_234);
  assert.equal(parsePercentageBps("100"), 10_000);
  assert.throws(() => parsePercentageBps("0"), /greater than 0/);
  assert.throws(() => parsePercentageBps("100.01"), /no more than 100%/);
  assert.equal(formatBasisPoints(30), "0.30%");
});

test("canonical pairs compare asset ID bytes, not catalog key order", () => {
  const [asset0, asset1] = canonicalPair(new Uint8Array([9]), new Uint8Array([1]));
  assert.deepEqual([...asset0], [1]);
  assert.deepEqual([...asset1], [9]);
  assert.throws(() => canonicalPair(new Uint8Array([1]), new Uint8Array([1])), /different assets/);
});

test("pool price formatting accounts for different decimals using bigint", () => {
  assert.equal(poolPriceDisplay(1_000_000_000_000_000n, 500_000_000_000n, 10, 6), "5");
  assert.equal(poolPriceDisplay(10_000_000_000_000n, 1_000_000_000_000n, 6, 6), "0.1");
  assert.equal(poolPriceDisplay(1n, 10_000_000_000n, 0, 18), "0.00000001");
  assert.equal(poolPriceDisplay(0n, 10n, 6, 6), "—");
});

test("proportional add ratio guard permits rounding but rejects price-changing deposits", () => {
  assert.equal(priceRatioWithinOneBasisPoint(1_000n, 50_000n, 10n, 500n), true);
  assert.equal(priceRatioWithinOneBasisPoint(1_000n, 50_000n, 10n, 400n), false);
});

test("the local managed liquidity config contains only crypto pairs and canonical Treasury key", async () => {
  const value = JSON.parse(await readFile(new URL("../web/public/liquidity/local.json", import.meta.url), "utf8"));
  const config = parseManagedLiquidityConfig(value, "local", catalogKeys);
  const treasury = evmOwnership("0x78B02E176e587E163661fBe70232CCDDEb11759e");
  assert.equal(config.managerKey, toHex(ownershipKey(treasury)).toLowerCase());
  assert.deepEqual(config.pairs.map(({ assetA, assetB }) => [assetA, assetB]), [["dot", "mini"], ["mini", "usdt"]]);
  assert.equal(config.pairs.some(({ assetA, assetB }) => [assetA, assetB].some((key) => ["aapl", "nvda", "tsla"].includes(key))), false);
});

test("manager tools require the configured Ownership and on-chain pool manager", () => {
  assert.match(appSource, /currentOwnerKey === managedLiquidityConfig\.managerKey/);
  assert.match(appSource, /isLiquidityManager && <div className="swap-product-tabs"/);
  assert.match(appSource, /isLiquidityManager && activeView === "liquidity"/);
  assert.match(appSource, /locus\.listPools\(\)/);
  assert.match(managedPanelSource, /ownerKey\(pool\.manager\) === config\.managerKey/);
  assert.match(managedPanelSource, /This pair already exists, but its on-chain manager does not match/);
  assert.match(managedPanelSource, /canManage && !pair\.pool/);
  assert.match(managedPanelSource, /canManage && pair\.pool/);
});

test("managed liquidity review protects ratio, drain, transaction, and fee semantics", () => {
  assert.match(managedPanelSource, /priceRatioWithinOneBasisPoint/);
  assert.match(managedPanelSource, /Pool price after/);
  assert.match(managedPanelSource, /Removing 100% of reserves makes this pool unavailable/);
  assert.match(managedPanelSource, /Drain managed pool\?/);
  assert.match(managedPanelSource, /Check transaction status/);
  assert.match(managedPanelSource, /Do not repeat this action/);
  assert.match(managedPanelSource, /formatBasisPoints\(SWAP_FEE_BPS\)/);
  assert.equal(SWAP_FEE_BPS, 30);
});

test("Swap continues to enumerate chain pools and does not fabricate quotes", () => {
  assert.match(appSource, /locus\.listPools\(\)/);
  assert.match(appSource, /No liquidity is available yet/);
  assert.match(appSource, /No quote is available until the pool is seeded/);
  assert.match(appSource, /formatBasisPoints\(SWAP_FEE_BPS\)/);
});
