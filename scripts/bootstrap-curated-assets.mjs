import fs from "node:fs/promises";
import path from "node:path";
import { CURATED_ASSETS, curatedTreasuryOwnership } from "./curated/config.mjs";
import { catalogIdentityKey, createCuratedRuntime, submitAndRequireApplied } from "./curated/runtime.mjs";
import { toHex } from "../dist/sdk/index.js";

const root = path.resolve(new URL("..", import.meta.url).pathname);
const { descriptor, protocolClient, locus, subject } = await createCuratedRuntime("LOCUS_CURATED_ISSUER_SIGNER_MODULE");
const issuerKey = catalogIdentityKey(subject);
const treasuryKey = catalogIdentityKey(curatedTreasuryOwnership);
const entries = [];

for (const item of CURATED_ASSETS) {
  const current = await locus.getAsset(item.assetId);
  if (current) {
    const matches = current.version === 2
      && current.issuer && catalogIdentityKey(current.issuer) === issuerKey
      && Buffer.from(current.name).toString("utf8") === item.name
      && Buffer.from(current.symbol).toString("utf8") === item.symbol
      && current.decimals === item.decimals
      && current.totalSupply === item.initialSupply;
    if (!matches) throw new Error(`${item.symbol} deterministic Asset ID already exists with different issuer or metadata; refusing to overwrite`);
    console.log(`${item.symbol}_ASSET=EXISTS_METADATA_MATCH`);
  } else {
    const submitted = await locus.createAsset(item.assetId, item.name, item.symbol, item.decimals, item.initialSupply, curatedTreasuryOwnership);
    await submitAndRequireApplied(protocolClient, submitted, `create ${item.symbol}`);
    console.log(`${item.symbol}_ASSET=CREATED`);
  }
  entries.push({
    key: item.key,
    assetId: toHex(item.assetId),
    symbol: item.symbol,
    name: item.name,
    decimals: item.decimals,
    issuerKey,
    class: item.class,
    status: item.status,
    icon: item.icon,
    ...(item.unit ? { unit: item.unit } : {}),
    disclosure: item.disclosure,
  });
}

for (const item of CURATED_ASSETS) {
  const asset = await locus.getAsset(item.assetId);
  if (!asset || asset.totalSupply !== item.initialSupply || catalogIdentityKey(asset.issuer) !== issuerKey) {
    throw new Error(`${item.symbol} chain metadata verification failed`);
  }
  const treasuryBalance = await locus.balanceOf(item.assetId, curatedTreasuryOwnership);
  if (treasuryBalance !== item.initialSupply) {
    throw new Error(`${item.symbol} treasury balance is ${treasuryBalance}; expected the entire initial supply ${item.initialSupply}. No catalog was written.`);
  }
  console.log(`${item.symbol}_TREASURY_BALANCE=${treasuryBalance}`);
}

const catalog = {
  version: 1,
  network: "local",
  genesisHash: descriptor.genesisHash,
  serviceId: descriptor.serviceId,
  assets: entries,
};
const output = path.resolve(process.env.LOCUS_CURATED_CATALOG_OUTPUT ?? path.join(root, "web/public/catalogs/local.json"));
if (output === root || !output.startsWith(`${root}${path.sep}`)) throw new Error("Curated catalog output must remain inside the repository");
await fs.mkdir(path.dirname(output), { recursive: true });
const temporary = `${output}.${process.pid}.tmp`;
await fs.writeFile(temporary, `${JSON.stringify(catalog, null, 2)}\n`, { mode: 0o644 });
await fs.rename(temporary, output);
console.log(`CURATED_TREASURY_KEY=${treasuryKey}`);
console.log(`CURATED_CATALOG=${output}`);
console.log("TREASURY_INITIAL_DISTRIBUTION=PASS");
console.log("CURATED_ASSET_BOOTSTRAP=PASS");
