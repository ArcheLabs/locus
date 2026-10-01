import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { SWAP_FEE_BPS, toHex } from "@archelabs/locus";
import { formatBasisPoints, poolPriceDisplay, proportionalAmount } from "../web/src/locus/liquidity/liquidityMath.ts";
import { liquidityConfigPath, loadPermissionlessLiquidityConfig, parsePermissionlessLiquidityConfig } from "../web/src/locus/liquidity/liquidityConfig.ts";
import { directPoolForPair, poolListQueryKey } from "../web/src/locus/pools/poolQueries.ts";

const catalog = JSON.parse(await readFile(new URL("../web/public/catalogs/local.json", import.meta.url), "utf8"));
const assetKeys = catalog.assets.map((asset) => asset.key);
const appSource = await readFile(new URL("../web/src/app.tsx", import.meta.url), "utf8");
const pageSource = await readFile(new URL("../web/src/locus/liquidity/LiquidityPage.tsx", import.meta.url), "utf8");
const swapSource = await readFile(new URL("../web/src/locus/swap/SwapPage.tsx", import.meta.url), "utf8");
const validConfig = { version: 2, network: "local", mode: "permissionless", featuredPairs: [{ assetA: "dot", assetB: "mini" }, { assetA: "mini", assetB: "usdt" }] };

test("liquidity config follows candidate base path", () => {
  assert.equal(liquidityConfigPath("local", "/"), "/liquidity/local.json");
  assert.equal(liquidityConfigPath("local", "/candidate/"), "/candidate/liquidity/local.json");
});

test("featured liquidity pairs are display-only and strictly validated", () => {
  const parsed = parsePermissionlessLiquidityConfig(validConfig, "local", assetKeys);
  assert.deepEqual(parsed.featuredPairs, validConfig.featuredPairs);
  assert.throws(() => parsePermissionlessLiquidityConfig(validConfig, "testnet", assetKeys), /Invalid permissionless/);
  assert.throws(() => parsePermissionlessLiquidityConfig({ ...validConfig, mode: "managed" }, "local", assetKeys), /Invalid permissionless/);
  assert.throws(() => parsePermissionlessLiquidityConfig({ ...validConfig, featuredPairs: [{ assetA: "dot", assetB: "unknown" }] }, "local", assetKeys), /unknown asset/);
  assert.throws(() => parsePermissionlessLiquidityConfig({ ...validConfig, featuredPairs: [{ assetA: "dot", assetB: "dot" }] }, "local", assetKeys), /different assets/);
  assert.throws(() => parsePermissionlessLiquidityConfig({ ...validConfig, featuredPairs: [...validConfig.featuredPairs, { assetA: "mini", assetB: "dot" }] }, "local", assetKeys), /Duplicate featured/);
});

test("missing or invalid optional featured config never disables permissionless liquidity", async () => {
  assert.equal(await loadPermissionlessLiquidityConfig("local", assetKeys, "/candidate/", async (url) => {
    assert.equal(url, "/candidate/liquidity/local.json");
    return new Response("", { status: 404 });
  }), null);
  assert.equal(await loadPermissionlessLiquidityConfig("local", assetKeys, "/", async () => new Response("{}", { status: 200 })), null);
});

test("display price uses exact base units and fee source remains SDK constant", () => {
  assert.equal(poolPriceDisplay(1_000_000_000_000_000n, 500_000_000_000n, 10, 6), "5");
  assert.equal(poolPriceDisplay(10_000_000_000_000n, 1_000_000_000_000n, 6, 6), "0.1");
  assert.equal(poolPriceDisplay(0n, 10n, 6, 6), "—");
  assert.equal(formatBasisPoints(SWAP_FEE_BPS), "0.30%");
  assert.equal(SWAP_FEE_BPS, 30);
});

test("existing-pool deposit input keeps the reserve ratio with bigint unit conversion", () => {
  assert.equal(proportionalAmount(10_000_000n, 1_000_000_000n, 5_000_000_000n), 50_000_000n);
  assert.equal(proportionalAmount(1n, 3n, 10n), 3n);
  assert.equal(proportionalAmount(0n, 3n, 10n), 0n);
  assert.throws(() => proportionalAmount(1n, 0n, 10n), /reserve in/);
  assert.match(pageSource, /function updateAmountA/);
  assert.match(pageSource, /setAmountB\(value\.trim\(\) \? formatUnits\(proportionalAmount/);
  assert.match(pageSource, /function updateAmountB/);
  assert.match(pageSource, /setAmountA\(value\.trim\(\) \? formatUnits\(proportionalAmount/);
});

test("Liquidity is visible to all users and positions/pools come from Service queries", () => {
  assert.match(appSource, /\["assets", "send", "swap", "liquidity", "activity"\]/);
  assert.match(appSource, /\(page === "liquidity" \|\| page === "liquidity-new"\) && <LiquidityPage/);
  assert.match(appSource, /queryFn: \(\) => network\.locus!\.listPools\(\)/);
  assert.match(pageSource, /locus\.listLiquidityPositions\(sessionOwner, \{ offset: 0n, limit: 50 \}\)/);
  assert.match(pageSource, /locus\.liquidityPositionCount\(sessionOwner\)/);
  assert.match(pageSource, /Load more positions/);
  assert.match(pageSource, /actionName = "createPool"/);
  assert.match(pageSource, /initialShares: quote\.sharesMinted/);
  assert.match(pageSource, /actionName = "addPoolLiquidity"/);
  assert.match(pageSource, /amountAUsed: usedA/);
  assert.match(pageSource, /amountBUsed: usedB/);
  assert.match(pageSource, /sharesMinted: quote\.sharesMinted/);
  assert.match(pageSource, /initialShares: currentPool\.totalShares === 0n \? quote\.sharesMinted : 0n/);
  assert.match(pageSource, /actionName = "removePoolLiquidity"/);
  assert.match(pageSource, /amountAOut: quote\.amount0/);
  assert.match(pageSource, /amountBOut: quote\.amount1/);
  assert.match(pageSource, /locus\.listPools\(\{ offset: BigInt\(pools\.length \+ additionalPools\.length\), limit: 50 \}\)/);
  assert.match(pageSource, /Load more pools/);
  assert.match(pageSource, /locus\.getPool\(assetA\.assetId, assetB\.assetId\)/);
  assert.doesNotMatch(pageSource, /Featured pairs|featuredPairs/);
  assert.match(pageSource, /role="tablist"/);
  assert.match(pageSource, /aria-selected=\{tab === "positions"\}/);
  assert.match(pageSource, /onNewPosition\(asset0\.assetIdHex, asset1\.assetIdHex\)/);
  assert.match(pageSource, /onClick=\{\(\) => \{ if \(asset0 && asset1\) onNewPosition\(asset0\.assetIdHex, asset1\.assetIdHex\); \}\}>Add<\/ActionButton>/);
  assert.match(pageSource, /role="alert"/);
  assert.doesNotMatch(appSource + pageSource, /isLiquidityManager|managerKey|POOL_MANAGER_REQUIRED|Connect Treasury/);
});

test("pending liquidity transactions are persisted and do not trigger automatic resubmission", () => {
  assert.match(pageSource, /locus\.liquidity\.pending\.v2/);
  assert.match(pageSource, /actionLabel: "Check status"/);
  assert.match(pageSource, /transaction is saved\. Check its status before signing another liquidity action/);
  assert.match(pageSource, /clearFinalizedFailure\(/);
});

test("Swap continues to use only on-chain pool state and never fabricates a quote", () => {
  const asset0 = new Uint8Array([1, 2]);
  const asset1 = new Uint8Array([3, 4]);
  const pool = { asset0, asset1, reserve0: 10n, reserve1: 20n, totalShares: 4n };
  assert.equal(directPoolForPair([pool], toHex(asset0), toHex(asset1)), pool);
  assert.equal(directPoolForPair([pool], toHex(asset1), toHex(asset0)), pool);
  assert.equal(directPoolForPair([pool], toHex(asset0), toHex(asset0)), null);
  assert.deepEqual(poolListQueryKey("local", 153994977), ["locus", "pools", "local", 153994977]);
  assert.match(swapSource, /directPoolForPair\(pools, assetIn\.assetIdHex, assetOut\.assetIdHex\)/);
  assert.match(swapSource, /This pair is not available for swapping yet/);
});
