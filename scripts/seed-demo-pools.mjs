import fs from "node:fs/promises";
import path from "node:path";
import { CURATED_ASSETS, DEMO_POOL_CONFIG_PATH, curatedTreasuryOwnership } from "./curated/config.mjs";
import { catalogIdentityKey, createCuratedRuntime, submitAndRequireApplied } from "./curated/runtime.mjs";
import { validateLiquidityManifest, parseHumanAmount } from "./curated/liquidity.mjs";
import { toHex } from "../dist/sdk/index.js";

const root = path.resolve(new URL("..", import.meta.url).pathname);
const { descriptor, locus, protocolClient, subject } = await createCuratedRuntime("LOCUS_CURATED_TREASURY_SIGNER_MODULE", { requireTreasurySigner: true });
if (catalogIdentityKey(subject) !== catalogIdentityKey(curatedTreasuryOwnership)) {
  throw new Error("Pool seeding requires the fixed curated treasury Ownership as the direct subject");
}

const configuration = JSON.parse(await fs.readFile(DEMO_POOL_CONFIG_PATH, "utf8"));
const configuredPools = validateLiquidityManifest(configuration);
const catalogPath = path.resolve(process.env.LOCUS_CURATED_CATALOG ?? path.join(root, "web/public/catalogs/local.json"));
const catalog = JSON.parse(await fs.readFile(catalogPath, "utf8"));
if (catalog.network !== "local" || catalog.genesisHash !== descriptor.genesisHash || catalog.serviceId !== descriptor.serviceId) {
  throw new Error("Curated catalog is not bound to the selected Local genesis and Service ID");
}
if (!Array.isArray(catalog.assets) || catalog.assets.length !== CURATED_ASSETS.length
    || new Set(catalog.assets.map((entry) => entry.key)).size !== CURATED_ASSETS.length) {
  throw new Error("Curated catalog must contain exactly one entry for each approved asset");
}

const assetBySymbol = new Map(CURATED_ASSETS.map((asset) => [asset.symbol, asset]));
const verifiedAssets = new Map();
for (const expected of CURATED_ASSETS) {
  const catalogEntry = catalog.assets.find((entry) => entry.key === expected.key);
  const expectedId = toHex(expected.assetId).toLowerCase();
  if (!catalogEntry || catalogEntry.assetId.toLowerCase() !== expectedId
      || catalogEntry.name !== expected.name || catalogEntry.symbol !== expected.symbol
      || catalogEntry.decimals !== expected.decimals) {
    throw new Error(`${expected.symbol} catalog entry does not match the curated asset definition`);
  }
  const asset = await locus.getAsset(expected.assetId);
  if (!asset || asset.version !== 2 || asset.decimals !== expected.decimals
      || Buffer.from(asset.name).toString("utf8") !== expected.name
      || Buffer.from(asset.symbol).toString("utf8") !== expected.symbol
      || asset.totalSupply !== expected.initialSupply
      || catalogIdentityKey(asset.issuer) !== catalogEntry.issuerKey.toLowerCase()) {
    throw new Error(`${expected.symbol} on-chain metadata or issuer differs from the bound catalog`);
  }
  verifiedAssets.set(expected.symbol, { ...expected, catalogEntry });
}

function canonicalPairKey(assetA, assetB) {
  return [toHex(assetA).toLowerCase(), toHex(assetB).toLowerCase()].sort().join(":");
}

const plans = configuredPools.map((configured) => {
  const base = assetBySymbol.get(configured.base);
  const quote = assetBySymbol.get(configured.quote);
  if (!base || !quote || configured.quote !== "USDT" || configured.base === "USDT") {
    throw new Error("Liquidity manifest contains an unsupported curated pair");
  }
  const baseAmount = parseHumanAmount(configured.baseAmount, base.decimals, `${configured.base} amount`);
  const quoteAmount = parseHumanAmount(configured.quoteAmount, quote.decimals, `${configured.quote} amount`);
  const baseIs0 = toHex(base.assetId).toLowerCase() < toHex(quote.assetId).toLowerCase();
  return {
    configured,
    base,
    quote,
    baseAmount,
    quoteAmount,
    targetReserve0: baseIs0 ? baseAmount : quoteAmount,
    targetReserve1: baseIs0 ? quoteAmount : baseAmount,
    pairKey: canonicalPairKey(base.assetId, quote.assetId),
  };
});

const allowedPairs = new Map(plans.map((plan) => [plan.pairKey, plan]));
const currentPools = await locus.listPools();
const existingByPair = new Map();
for (const pool of currentPools) {
  const pairKey = canonicalPairKey(pool.asset0, pool.asset1);
  const plan = allowedPairs.get(pairKey);
  if (!plan || existingByPair.has(pairKey)) throw new Error("Unexpected or duplicate pool exists; refusing to seed Local liquidity");
  if (catalogIdentityKey(pool.manager) !== catalogIdentityKey(curatedTreasuryOwnership)) {
    throw new Error(`${plan.configured.base}/${plan.configured.quote} already exists with a different manager`);
  }
  if (pool.reserve0 !== plan.targetReserve0 || pool.reserve1 !== plan.targetReserve1) {
    throw new Error(`${plan.configured.base}/${plan.configured.quote} reserves or manager differ from the approved seed manifest; refusing to add or replace liquidity`);
  }
  existingByPair.set(pairKey, pool);
}
if (currentPools.length !== existingByPair.size || currentPools.length > plans.length) {
  throw new Error("Pool count includes an unapproved pair; refusing to seed");
}

const existingReserveByAsset = new Map(CURATED_ASSETS.map((asset) => [asset.symbol, 0n]));
for (const pool of currentPools) {
  const plan = allowedPairs.get(canonicalPairKey(pool.asset0, pool.asset1));
  existingReserveByAsset.set(plan.base.symbol, existingReserveByAsset.get(plan.base.symbol) + plan.baseAmount);
  existingReserveByAsset.set(plan.quote.symbol, existingReserveByAsset.get(plan.quote.symbol) + plan.quoteAmount);
}
const allPoolsExist = existingByPair.size === plans.length;
let supplyInvariantVerified = false;
if (!allPoolsExist) {
  for (const asset of CURATED_ASSETS) {
    const balance = await locus.balanceOf(asset.assetId, curatedTreasuryOwnership);
    const expectedBalance = asset.initialSupply - existingReserveByAsset.get(asset.symbol);
    if (balance !== expectedBalance) {
      throw new Error(`${asset.symbol} treasury balance does not match initial supply less the already-verified pools; no liquidity was added`);
    }
  }
}
if (currentPools.length === 0) console.log("PRESEED_BALANCES=PASS");

for (const plan of plans) {
  if (existingByPair.has(plan.pairKey)) {
    console.log(`${plan.configured.base}_${plan.configured.quote}_POOL=SKIP_ALREADY_SEEDED`);
    continue;
  }
  const baseBalance = await locus.balanceOf(plan.base.assetId, curatedTreasuryOwnership);
  const quoteBalance = await locus.balanceOf(plan.quote.assetId, curatedTreasuryOwnership);
  if (baseBalance < plan.baseAmount || quoteBalance < plan.quoteAmount) {
    throw new Error(`${plan.configured.base}/${plan.configured.quote} Treasury balance is insufficient; refusing to submit`);
  }
  const submitted = await locus.createPool(plan.base.assetId, plan.quote.assetId, plan.baseAmount, plan.quoteAmount);
  await submitAndRequireApplied(protocolClient, submitted, `create ${plan.configured.base}/${plan.configured.quote} pool`);

  const created = await locus.getPool(plan.base.assetId, plan.quote.assetId);
  const reverseLookup = await locus.getPool(plan.quote.assetId, plan.base.assetId);
  if (!created || catalogIdentityKey(created.manager) !== catalogIdentityKey(curatedTreasuryOwnership)
      || created.reserve0 !== plan.targetReserve0 || created.reserve1 !== plan.targetReserve1
      || !reverseLookup || reverseLookup.reserve0 !== created.reserve0 || reverseLookup.reserve1 !== created.reserve1
      || catalogIdentityKey(reverseLookup.manager) !== catalogIdentityKey(created.manager)) {
    throw new Error(`${plan.configured.base}/${plan.configured.quote} finalized pool verification failed`);
  }
  existingByPair.set(plan.pairKey, created);
  if ((await locus.listPools()).length !== existingByPair.size) throw new Error("Finalized pool count did not increase by exactly one");
  existingReserveByAsset.set(plan.base.symbol, existingReserveByAsset.get(plan.base.symbol) + plan.baseAmount);
  existingReserveByAsset.set(plan.quote.symbol, existingReserveByAsset.get(plan.quote.symbol) + plan.quoteAmount);

  for (const asset of CURATED_ASSETS) {
    const balance = await locus.balanceOf(asset.assetId, curatedTreasuryOwnership);
    const expectedBalance = asset.initialSupply - existingReserveByAsset.get(asset.symbol);
    if (balance !== expectedBalance || balance + existingReserveByAsset.get(asset.symbol) !== asset.initialSupply) {
      throw new Error(`${asset.symbol} post-seed Treasury/supply conservation check failed`);
    }
    console.log(`${asset.symbol}_TREASURY_BALANCE=${balance}`);
  }
  supplyInvariantVerified = true;
  console.log(`${plan.configured.base}_${plan.configured.quote}_POOL=SEEDED_FINALIZED`);
}

const finalPools = await locus.listPools();
if (finalPools.length !== 5 || existingByPair.size !== 5) throw new Error(`Expected exactly five approved pools, found ${finalPools.length}`);
for (const plan of plans) {
  const pool = await locus.getPool(plan.base.assetId, plan.quote.assetId);
  const reverseLookup = await locus.getPool(plan.quote.assetId, plan.base.assetId);
  if (!pool || catalogIdentityKey(pool.manager) !== catalogIdentityKey(curatedTreasuryOwnership)
      || pool.reserve0 !== plan.targetReserve0 || pool.reserve1 !== plan.targetReserve1
      || !reverseLookup || reverseLookup.reserve0 !== pool.reserve0 || reverseLookup.reserve1 !== pool.reserve1
      || catalogIdentityKey(reverseLookup.manager) !== catalogIdentityKey(pool.manager)) {
    throw new Error(`${plan.configured.base}/${plan.configured.quote} final pool verification failed`);
  }
}

if (allPoolsExist) {
  supplyInvariantVerified = true;
  for (const asset of CURATED_ASSETS) {
    const treasuryBalance = await locus.balanceOf(asset.assetId, curatedTreasuryOwnership);
    const accounted = treasuryBalance + existingReserveByAsset.get(asset.symbol);
    if (accounted !== asset.initialSupply) supplyInvariantVerified = false;
  }
}

const quoteProbes = [
  ["DOT", "USDT", "1"],
  ["DOT", "USDT", "100"],
  ["MINI", "USDT", "1000"],
  ["AAPL", "USDT", "1"],
  ["NVDA", "USDT", "1"],
  ["TSLA", "USDT", "1"],
];
const treasuryBeforeQuotes = new Map();
const poolBeforeQuotes = new Map();
for (const asset of CURATED_ASSETS) treasuryBeforeQuotes.set(asset.symbol, await locus.balanceOf(asset.assetId, curatedTreasuryOwnership));
for (const plan of plans) poolBeforeQuotes.set(plan.pairKey, await locus.getPool(plan.base.assetId, plan.quote.assetId));
for (const [symbolIn, symbolOut, humanAmount] of quoteProbes) {
  const input = verifiedAssets.get(symbolIn);
  const output = verifiedAssets.get(symbolOut);
  const amountIn = parseHumanAmount(humanAmount, input.decimals, `${symbolIn} quote probe`);
  const quote = await locus.quoteExactIn(input.assetId, output.assetId, amountIn);
  const pool = await locus.getPool(input.assetId, output.assetId);
  const outputReserve = pool && Buffer.from(pool.asset0).equals(Buffer.from(output.assetId)) ? pool.reserve0 : pool?.reserve1;
  if (!pool || quote.amountOut <= 0n || quote.amountOut >= outputReserve
      || quote.feeBps !== 30 || quote.feeAmount <= 0n) {
    throw new Error(`${symbolIn}/${symbolOut} pure quote probe failed`);
  }
  console.log(`${symbolIn}_${symbolOut}_QUOTE_${humanAmount}=${quote.amountOut}`);
}
for (const asset of CURATED_ASSETS) {
  if (await locus.balanceOf(asset.assetId, curatedTreasuryOwnership) !== treasuryBeforeQuotes.get(asset.symbol)) {
    throw new Error(`Quote query unexpectedly changed the ${asset.symbol} Treasury balance`);
  }
}
const poolsAfterQuotes = await locus.listPools();
if (poolsAfterQuotes.length !== finalPools.length) throw new Error("Quote query unexpectedly changed pool count");
for (const plan of plans) {
  const before = poolBeforeQuotes.get(plan.pairKey);
  const after = await locus.getPool(plan.base.assetId, plan.quote.assetId);
  if (!before || !after || before.reserve0 !== after.reserve0 || before.reserve1 !== after.reserve1
      || catalogIdentityKey(before.manager) !== catalogIdentityKey(after.manager)) {
    throw new Error(`${plan.configured.base}/${plan.configured.quote} quote query unexpectedly changed pool state`);
  }
}

for (const asset of CURATED_ASSETS) {
  console.log(`${asset.symbol}_TREASURY_BALANCE_AFTER_SEED=${await locus.balanceOf(asset.assetId, curatedTreasuryOwnership)}`);
}

console.log("POOL_COUNT=5");
console.log("POOL_MANAGER_MATCH=PASS");
console.log(`POOL_SUPPLY_INVARIANT=${supplyInvariantVerified ? "PASS" : "NOT_VERIFIABLE_WITH_CURRENT_BALANCE_QUERY"}`);
console.log("PURE_QUOTES=PASS");
console.log(`POOL_SERVICE_ID=${descriptor.serviceId}`);
console.log("POOL_SEEDING=PASS");
