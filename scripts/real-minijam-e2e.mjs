import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  FetchRpcTransport,
  JamScriptClient,
  OWNERSHIP_KIND,
} from "@jamscript/client";
import {
  cryptoWaitReady,
  sr25519PairFromSeed,
  sr25519Sign,
} from "@polkadot/util-crypto";
import { LocusClient } from "../dist/sdk/index.js";

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const backendUrl = process.env.LOCUS_E2E_BACKEND_RPC ?? "http://127.0.0.1:8090";
const genesisHash = process.env.LOCUS_E2E_GENESIS_HASH;
const networkDomain = process.env.LOCUS_E2E_NETWORK_DOMAIN ?? genesisHash;
const serviceId = Number(process.env.LOCUS_E2E_SERVICE_ID);
const artifactDir = process.env.LOCUS_E2E_ARTIFACTS ?? path.join(root, "dist");

if (!genesisHash || !networkDomain || !Number.isInteger(serviceId)) {
  throw new Error("LOCUS_E2E_GENESIS_HASH, LOCUS_E2E_NETWORK_DOMAIN and LOCUS_E2E_SERVICE_ID are required");
}

const build = JSON.parse(await fs.readFile(path.join(artifactDir, "build.json"), "utf8"));
const abi = JSON.parse(await fs.readFile(path.join(artifactDir, "service.abi.json"), "utf8"));
const deployment = {
  genesisHash,
  networkDomain,
  serviceKey: build.serviceKey,
  serviceId,
  codeHash: build.code_hash,
  abiVersion: abi.abiVersion,
  abi,
};

await cryptoWaitReady();
const protocolClient = new JamScriptClient(deployment, new FetchRpcTransport(backendUrl));

function id(byte) {
  return new Uint8Array(32).fill(byte);
}

function signerFor(seedByte) {
  const pair = sr25519PairFromSeed(id(seedByte));
  const controller = { version: 1, kind: OWNERSHIP_KIND.SR25519_KEY, public: pair.publicKey };
  return {
    controller,
    async getController() { return controller; },
    async signJamScriptAction(request) { return sr25519Sign(request.message, pair); },
  };
}

async function applied(submitted, label) {
  console.log(`${label}_TRANSACTION=${submitted.transactionId}`);
  const result = await protocolClient.waitForAction(submitted.transactionId, { intervalMs: 500, timeoutMs: 180_000 });
  assert.equal(result.actionReceipt.status, "applied", `${label} receipt was ${JSON.stringify(result.actionReceipt)}`);
  console.log(`${label}_ACTION_RECEIPT=APPLIED`);
  return result;
}

async function expectRejected(submission, label, errorCode) {
  const submitted = await submission;
  const result = await protocolClient.waitForAction(submitted.transactionId, { intervalMs: 500, timeoutMs: 180_000 });
  assert.equal(result.actionReceipt.status, "failed", `${label} receipt status`);
  assert.equal(result.actionReceipt.errorCode, errorCode, `${label} error code`);
}

function sessionFor(signer) {
  return {
    signer,
    subject: signer.controller,
  };
}

function assertAmount(actual, expected, label) {
  assert.equal(actual, expected, label);
}

await protocolClient.validateDeployment();

const aliceSigner = signerFor(1);
const bobSigner = signerFor(2);
const carolSigner = signerFor(3);
const alice = new LocusClient(protocolClient, sessionFor(aliceSigner));
const bob = new LocusClient(protocolClient, sessionFor(bobSigner));
const carol = new LocusClient(protocolClient, sessionFor(carolSigner));
const aliceOwner = aliceSigner.controller;
const bobOwner = bobSigner.controller;
const carolOwner = carolSigner.controller;

const assetId = id(0xa1);
const wideAssetId = id(0xa2);
const abc = alice.asset(assetId);

const unit = 10n ** 18n;
await applied(await alice.createAsset(assetId, "Asset ABC", "ABC", 18, 100n * unit), "CREATE_ASSET");
assertAmount(await abc.balanceOf(aliceOwner), 100n * unit, "initial Alice balance");
assertAmount(await abc.balanceOf(bobOwner), 0n, "initial Bob balance");
assertAmount(await abc.balanceOf(carolOwner), 0n, "initial Carol balance");
assertAmount(await abc.totalSupply(), 100n * unit, "initial supply");
console.log("CREATE_ASSET=PASS");

await applied(await alice.transfer(assetId, bobOwner, 20n * unit), "TRANSFER");
assertAmount(await abc.balanceOf(aliceOwner), 80n * unit, "Alice after transfer");
assertAmount(await abc.balanceOf(bobOwner), 20n * unit, "Bob after transfer");
console.log("TRANSFER=PASS");

await applied(await alice.approve(assetId, bobOwner, 15n * unit), "APPROVE");
assertAmount(await abc.allowance(aliceOwner, bobOwner), 15n * unit, "allowance after approve");
console.log("APPROVE=PASS");

await applied(await bob.transferFrom(assetId, aliceOwner, carolOwner, 7n * unit), "TRANSFER_FROM");
assertAmount(await abc.balanceOf(aliceOwner), 73n * unit, "Alice after transferFrom");
assertAmount(await abc.balanceOf(carolOwner), 7n * unit, "Carol after transferFrom");
assertAmount(await abc.allowance(aliceOwner, bobOwner), 8n * unit, "allowance after transferFrom");
console.log("TRANSFER_FROM=PASS");

await expectRejected(bob.mint(assetId, bobOwner, 1n * unit), "NON_ISSUER_MINT", 2007);
console.log("NON_ISSUER_REJECTED=PASS");

await applied(await alice.mint(assetId, bobOwner, 10n * unit), "MINT");
assertAmount(await abc.balanceOf(bobOwner), 30n * unit, "Bob after mint");
assertAmount(await abc.totalSupply(), 110n * unit, "supply after mint");
console.log("MINT=PASS");

await applied(await alice.burn(assetId, 3n * unit), "BURN");
assertAmount(await abc.balanceOf(aliceOwner), 70n * unit, "Alice after burn");
assertAmount(await abc.totalSupply(), 107n * unit, "supply after burn");
console.log("BURN=PASS");

const wideSupply = 1000000000000000000000000000n;
const wideTransfer = 100000000000000000000000000n;
const wide = alice.asset(wideAssetId);
await applied(await alice.createAsset(wideAssetId, "Wide Asset", "WIDE", 0, wideSupply), "U128_WIDE_AMOUNT");
await applied(await alice.transfer(wideAssetId, bobOwner, wideTransfer), "wide transfer");
assertAmount(await wide.balanceOf(aliceOwner), wideSupply - wideTransfer, "wide Alice balance");
assertAmount(await wide.balanceOf(bobOwner), wideTransfer, "wide Bob balance");
assertAmount(await wide.totalSupply(), wideSupply, "wide supply");
console.log("U128_WIDE_AMOUNT=PASS");

assertAmount(
  (await abc.balanceOf(aliceOwner)) + (await abc.balanceOf(bobOwner)) + (await abc.balanceOf(carolOwner)),
  await abc.totalSupply(),
  "ABC balance sum equals supply",
);
console.log("BALANCE_SUM_EQUALS_SUPPLY=PASS");

const poolAssetA = id(0xa3);
const poolAssetB = id(0xa4);
await applied(await alice.createAsset(poolAssetA, "Pool Asset A", "PA", 0, 1_000_000n), "POOL_ASSET_A");
await applied(await alice.createAsset(poolAssetB, "Pool Asset B", "PB", 0, 1_000_000n), "POOL_ASSET_B");

await applied(await alice.createPool(poolAssetA, poolAssetB, 40_000n, 90_000n), "CREATE_POOL");
console.log("CREATE_POOL_PVM_PLAN=PASS");
console.log("CREATE_POOL_ACTION_RECEIPT=APPLIED");
const initialPool = await alice.getPool(poolAssetA, poolAssetB);
assert.ok(initialPool, "created pool is queryable");
const poolAssetAIs0 = initialPool.asset0.every((byte, index) => byte === poolAssetA[index]);
assertAmount(poolAssetAIs0 ? initialPool.reserve0 : initialPool.reserve1, 40_000n, "initial asset A reserve");
assertAmount(poolAssetAIs0 ? initialPool.reserve1 : initialPool.reserve0, 90_000n, "initial asset B reserve");
assertAmount(initialPool.totalShares, 60_000n, "initial total shares");
console.log("POOL_STATE=PASS");
assertAmount(await alice.liquiditySharesOf(poolAssetA, poolAssetB, aliceOwner), 60_000n, "Alice initial LP position");
const alicePositions = await alice.listLiquidityPositions(aliceOwner);
assert.ok(alicePositions.some((position) => position.shares === 60_000n), "Alice LP position is indexed");
console.log("LP_POSITION=PASS");

await applied(await alice.transfer(poolAssetA, bobOwner, 10_000n), "POOL_TRANSFER_A_TO_BOB");
await applied(await alice.transfer(poolAssetB, bobOwner, 22_500n), "POOL_TRANSFER_B_TO_BOB");
await applied(await alice.transfer(poolAssetA, carolOwner, 1_000n), "POOL_TRANSFER_A_TO_CAROL");
await applied(await bob.addPoolLiquidity(poolAssetA, poolAssetB, 10_000n, 22_500n, 15_000n), "ADD_LIQUIDITY");
console.log("ADD_LIQUIDITY_ACTION_RECEIPT=APPLIED");
let poolAfterAdd = await alice.getPool(poolAssetA, poolAssetB);
assert.ok(poolAfterAdd, "pool remains queryable after add");
assertAmount(poolAfterAdd.totalShares, 75_000n, "total shares after add");
assertAmount(await bob.liquiditySharesOf(poolAssetA, poolAssetB, bobOwner), 15_000n, "Bob position after add");

await applied(await bob.removePoolLiquidity(poolAssetA, poolAssetB, 7_500n, 5_000n, 11_250n), "REMOVE_LIQUIDITY");
console.log("REMOVE_LIQUIDITY_ACTION_RECEIPT=APPLIED");
const poolAfterRemove = await alice.getPool(poolAssetA, poolAssetB);
assert.ok(poolAfterRemove, "pool remains queryable after remove");
assertAmount(poolAfterRemove.totalShares, 67_500n, "total shares after remove");
assertAmount(await bob.liquiditySharesOf(poolAssetA, poolAssetB, bobOwner), 7_500n, "Bob position after remove");

const quote = await carol.quoteExactIn(poolAssetA, poolAssetB, 1_000n);
await applied(await carol.swapExactIn(poolAssetA, poolAssetB, 1_000n, quote.amountOut), "SWAP");
console.log("SWAP_ACTION_RECEIPT=APPLIED");
const poolAfterSwap = await alice.getPool(poolAssetA, poolAssetB);
assert.ok(poolAfterSwap, "pool remains queryable after swap");
assertAmount(await carol.asset(poolAssetB).balanceOf(carolOwner), quote.amountOut, "Carol swap output balance");
const reserveAAfterRemove = poolAssetAIs0 ? poolAfterRemove.reserve0 : poolAfterRemove.reserve1;
const reserveAAfterSwap = poolAssetAIs0 ? poolAfterSwap.reserve0 : poolAfterSwap.reserve1;
assertAmount(reserveAAfterSwap, reserveAAfterRemove + 1_000n, "asset A reserve after swap");
console.log("LIQUIDITY_SWAP_STATE=PASS");
console.log("LOCUS_REAL_MINIJAM_E2E=PASS");
console.log("LOCUS_V0_2=PASS");
