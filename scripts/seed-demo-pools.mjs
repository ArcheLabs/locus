import fs from "node:fs/promises";
import { CURATED_ASSETS, DEMO_POOL_CONFIG_PATH, curatedTreasuryOwnership } from "./curated/config.mjs";
import { catalogIdentityKey, createCuratedRuntime, submitAndRequireApplied } from "./curated/runtime.mjs";
import { toHex } from "../dist/sdk/index.js";

const { descriptor, locus, protocolClient, subject } = await createCuratedRuntime("LOCUS_CURATED_TREASURY_SIGNER_MODULE", { requireTreasurySigner: true });
if (catalogIdentityKey(subject) !== catalogIdentityKey(curatedTreasuryOwnership)) {
  throw new Error("Pool seeding requires the fixed curated treasury Ownership as the direct subject");
}
const configuration = JSON.parse(await fs.readFile(DEMO_POOL_CONFIG_PATH, "utf8"));
if (configuration.version !== 1 || configuration.demoOnly !== true || !Array.isArray(configuration.pools) || configuration.pools.length !== 5) {
  throw new Error("scripts/curated/pools.json must contain the five demo-only v0 pools");
}
const assetBySymbol = new Map(CURATED_ASSETS.map((asset) => [asset.symbol, asset]));
const plans = [];
const neededByAsset = new Map();

for (const configured of configuration.pools) {
  const base = assetBySymbol.get(configured.base);
  const quote = assetBySymbol.get(configured.quote);
  if (!base || !quote || configured.quote !== "USDT" || configured.base === "USDT") throw new Error("Pool manifest contains an unsupported curated pair");
  const baseAmount = BigInt(configured.baseAmount);
  const quoteAmount = BigInt(configured.quoteAmount);
  if (baseAmount <= 0n || quoteAmount <= 0n || baseAmount >= 1n << 64n || quoteAmount >= 1n << 64n) throw new Error(`Invalid demo pool seed amounts for ${configured.base}/${configured.quote}`);
  const baseIs0 = toHex(base.assetId).toLowerCase() < toHex(quote.assetId).toLowerCase();
  const targetReserve0 = baseIs0 ? baseAmount : quoteAmount;
  const targetReserve1 = baseIs0 ? quoteAmount : baseAmount;
  const current = await locus.getPool(base.assetId, quote.assetId);
  if (current) {
    if (catalogIdentityKey(current.manager) !== catalogIdentityKey(curatedTreasuryOwnership)) {
      throw new Error(`${configured.base}/${configured.quote} already exists with a different manager`);
    }
    if (current.reserve0 === targetReserve0 && current.reserve1 === targetReserve1) {
      console.log(`${configured.base}_${configured.quote}_POOL=EXISTS_TREASURY_MANAGED`);
      plans.push({ configured, base, quote, current, baseAmount: 0n, quoteAmount: 0n, targetReserve0, targetReserve1 });
      continue;
    }
    if (current.reserve0 !== 0n || current.reserve1 !== 0n) {
      throw new Error(`${configured.base}/${configured.quote} has existing reserves that differ from the seed manifest; refusing to add or replace liquidity`);
    }
  }
  plans.push({ configured, base, quote, current, baseAmount, quoteAmount, targetReserve0, targetReserve1 });
  neededByAsset.set(base.symbol, (neededByAsset.get(base.symbol) ?? 0n) + baseAmount);
  neededByAsset.set(quote.symbol, (neededByAsset.get(quote.symbol) ?? 0n) + quoteAmount);
}

for (const [symbol, needed] of neededByAsset) {
  const asset = assetBySymbol.get(symbol);
  const balance = await locus.balanceOf(asset.assetId, curatedTreasuryOwnership);
  if (balance < needed) throw new Error(`${symbol} treasury balance ${balance} is below configured pool liquidity ${needed}; no new liquidity was added`);
}

for (const plan of plans) {
  if (plan.baseAmount === 0n && plan.quoteAmount === 0n) continue;
  if (plan.current) {
    const submitted = await locus.addPoolLiquidity(plan.base.assetId, plan.quote.assetId, plan.baseAmount, plan.quoteAmount);
    await submitAndRequireApplied(protocolClient, submitted, `add ${plan.configured.base}/${plan.configured.quote} liquidity`);
  } else {
    const submitted = await locus.createPool(plan.base.assetId, plan.quote.assetId, plan.baseAmount, plan.quoteAmount);
    await submitAndRequireApplied(protocolClient, submitted, `create ${plan.configured.base}/${plan.configured.quote} pool`);
  }
  const created = await locus.getPool(plan.base.assetId, plan.quote.assetId);
  if (!created || catalogIdentityKey(created.manager) !== catalogIdentityKey(curatedTreasuryOwnership)) throw new Error(`${plan.configured.base}/${plan.configured.quote} pool manager verification failed`);
  if (created.reserve0 !== plan.targetReserve0 || created.reserve1 !== plan.targetReserve1) throw new Error(`${plan.configured.base}/${plan.configured.quote} reserve verification failed`);
  console.log(`${plan.configured.base}_${plan.configured.quote}_POOL=SEEDED`);
}

console.log(`POOL_NETWORK=local`);
console.log(`POOL_SERVICE_ID=${descriptor.serviceId}`);
console.log("POOL_SEEDING=PASS");
