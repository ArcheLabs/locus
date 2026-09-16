import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const clientRoot = process.env.JAMSCRIPT_CLIENT_ROOT;
const backendUrl = process.env.LOCUS_E2E_BACKEND_RPC ?? "http://127.0.0.1:8091";
const genesisHash = process.env.LOCUS_E2E_GENESIS_HASH;
const serviceId = Number(process.env.LOCUS_E2E_SERVICE_ID);
const artifactDir = process.env.LOCUS_E2E_ARTIFACTS ?? path.join(root, "dist");

if (!clientRoot) throw new Error("JAMSCRIPT_CLIENT_ROOT is required");
if (!genesisHash || !Number.isInteger(serviceId)) {
  throw new Error("LOCUS_E2E_GENESIS_HASH and LOCUS_E2E_SERVICE_ID are required");
}

const importFrom = (file) => import(pathToFileURL(path.join(clientRoot, file)).href);
const {
  FetchRpcTransport,
  JamScriptClient,
} = await importFrom("dist/index.js");
const { hexToU8a, u8aToHex } = await importFrom("node_modules/@polkadot/util/index.js");
const {
  cryptoWaitReady,
  sr25519PairFromSeed,
  sr25519Sign,
} = await importFrom("node_modules/@polkadot/util-crypto/index.js");
const { LocusClient } = await import(pathToFileURL(path.join(root, "dist/sdk/index.js")).href);

const build = JSON.parse(await fs.readFile(path.join(artifactDir, "build.json"), "utf8"));
const abi = JSON.parse(await fs.readFile(path.join(artifactDir, "service.abi.json"), "utf8"));
const deployment = {
  genesisHash,
  serviceKey: build.serviceKey,
  serviceId,
  codeHash: build.code_hash,
  abiVersion: abi.abiVersion,
  abi,
};

await cryptoWaitReady();
const transport = new FetchRpcTransport(backendUrl);
const protocolClient = new JamScriptClient(deployment, transport);

function id(byte) {
  return new Uint8Array(32).fill(byte);
}

function pair(byte) {
  return sr25519PairFromSeed(id(byte));
}

function signerFor(keyPair) {
  return {
    publicKey: keyPair.publicKey,
    signRaw: async (message) => sr25519Sign(message, keyPair),
  };
}

function locusFor(signer) {
  return new LocusClient({
    submitAction: async (actionName, input) => {
      const submitted = await protocolClient.submitAction(actionName, input, signer);
      const result = await protocolClient.waitForAction(
        submitted.packageHash,
        submitted.actionHash,
        { intervalMs: 500, timeoutMs: 120_000 },
      );
      assert.equal(
        result.actionReceipt.status,
        "applied",
        `${actionName} application receipt was ${JSON.stringify(result.actionReceipt)}`,
      );
      return result;
    },
    queryLatest: (queryName, key) => protocolClient.queryLatest(queryName, key),
    waitForAction: (actionHash, options) => protocolClient.waitForAction(actionHash, undefined, options),
  });
}

async function submitExpected(signer, actionName, input, status, errorCode) {
  const submitted = await protocolClient.submitAction(actionName, input, signer);
  const result = await protocolClient.waitForAction(
    submitted.packageHash,
    submitted.actionHash,
    { intervalMs: 500, timeoutMs: 120_000 },
  );
  assert.equal(result.actionReceipt.status, status, `${actionName} receipt status`);
  if (errorCode !== undefined) assert.equal(result.actionReceipt.errorCode, errorCode);
  return result;
}

function assertAmount(actual, expected, label) {
  assert.equal(actual, expected, label);
}

const aliceA = pair(1);
const aliceB = pair(2);
const bobPair = pair(3);
const carolPair = pair(4);
const aliceId = id(0x11);
const bobId = id(0x22);
const carolId = id(0x33);
const assetId = id(0xa1);
const wideAssetId = id(0xa2);
const alice = locusFor(signerFor(aliceA));
const aliceNew = locusFor(signerFor(aliceB));
const bob = locusFor(signerFor(bobPair));
const carol = locusFor(signerFor(carolPair));
const abc = alice.asset(assetId);

await protocolClient.validateDeployment();

await alice.createIdentity(aliceId);
await bob.createIdentity(bobId);
await carol.createIdentity(carolId);
console.log("CREATE_IDENTITY=PASS");

const unit = 10n ** 18n;
await alice.createAsset(aliceId, assetId, "Asset ABC", "ABC", 18, 100n * unit);
assertAmount(await abc.balanceOf(aliceId), 100n * unit, "initial Alice balance");
assertAmount(await abc.balanceOf(bobId), 0n, "initial Bob balance");
assertAmount(await abc.balanceOf(carolId), 0n, "initial Carol balance");
assertAmount(await abc.totalSupply(), 100n * unit, "initial supply");
console.log("CREATE_ASSET=PASS");

await abc.transfer(aliceId, bobId, 20n * unit);
assertAmount(await abc.balanceOf(aliceId), 80n * unit, "Alice after transfer");
assertAmount(await abc.balanceOf(bobId), 20n * unit, "Bob after transfer");
console.log("TRANSFER=PASS");

await abc.approve(aliceId, bobId, 15n * unit);
assertAmount(await abc.allowance(aliceId, bobId), 15n * unit, "allowance after approve");
console.log("APPROVE=PASS");

await alice.rotateOwner(aliceId, aliceB.publicKey);
const rotated = await alice.getIdentity(aliceId);
assert.ok(rotated);
assert.deepEqual(Array.from(rotated.owner.payload), Array.from(aliceB.publicKey));
assertAmount(await abc.balanceOf(aliceId), 80n * unit, "balance stable across rotation");
assertAmount(await abc.allowance(aliceId, bobId), 15n * unit, "allowance stable across rotation");
const rotatedAsset = await alice.getAsset(assetId);
assert.ok(rotatedAsset);
assert.deepEqual(Array.from(rotatedAsset.issuer), Array.from(aliceId));
console.log("ROTATE_OWNER=PASS");
console.log("OWNER_ROTATION_BALANCE_STABLE=PASS");
console.log("OWNER_ROTATION_ALLOWANCE_STABLE=PASS");
console.log("OWNER_ROTATION_ISSUER_STABLE=PASS");

const currentAliceNonce = await aliceNew.identityNonce(aliceId);
await submitExpected(
  signerFor(aliceA),
  "transfer",
  { fromId: aliceId, nonce: currentAliceNonce, assetId, toId: carolId, amount: 1n * unit },
  "failed",
  1004,
);
console.log("OLD_OWNER_REJECTED=PASS");

await abc.transfer(aliceId, bobId, 10n * unit);
assertAmount(await abc.balanceOf(aliceId), 70n * unit, "Alice after new-owner transfer");
assertAmount(await abc.balanceOf(bobId), 30n * unit, "Bob after new-owner transfer");
console.log("NEW_OWNER_ACCEPTED=PASS");

await abc.transferFrom(bobId, aliceId, carolId, 7n * unit);
assertAmount(await abc.balanceOf(aliceId), 63n * unit, "Alice after transferFrom");
assertAmount(await abc.balanceOf(bobId), 30n * unit, "Bob after transferFrom");
assertAmount(await abc.balanceOf(carolId), 7n * unit, "Carol after transferFrom");
assertAmount(await abc.allowance(aliceId, bobId), 8n * unit, "allowance after transferFrom");
console.log("TRANSFER_FROM=PASS");

await abc.mint(aliceId, bobId, 10n * unit);
assertAmount(await abc.balanceOf(bobId), 40n * unit, "Bob after mint");
assertAmount(await abc.totalSupply(), 110n * unit, "supply after mint");
console.log("MINT=PASS");

await abc.burn(aliceId, 3n * unit);
assertAmount(await abc.balanceOf(aliceId), 60n * unit, "Alice after burn");
assertAmount(await abc.totalSupply(), 107n * unit, "supply after burn");
console.log("BURN=PASS");

const staleNonce = (await aliceNew.identityNonce(aliceId)) - 1n;
await submitExpected(
  signerFor(aliceB),
  "transfer",
  { fromId: aliceId, nonce: staleNonce, assetId, toId: carolId, amount: 1n * unit },
  "failed",
  1007,
);
console.log("IDENTITY_REPLAY_REJECTED=PASS");

const wideSupply = 1000000000000000000000000000000n;
const wideTransfer = 100000000000000000000000000000n;
const wide = aliceNew.asset(wideAssetId);
await aliceNew.createAsset(aliceId, wideAssetId, "Wide Asset", "WIDE", 0, wideSupply);
await wide.transfer(aliceId, bobId, wideTransfer);
assertAmount(await wide.balanceOf(aliceId), wideSupply - wideTransfer, "wide Alice balance");
assertAmount(await wide.balanceOf(bobId), wideTransfer, "wide Bob balance");
assertAmount(await wide.totalSupply(), wideSupply, "wide supply");
console.log("U128_WIDE_AMOUNT=PASS");

assertAmount(
  (await abc.balanceOf(aliceId)) + (await abc.balanceOf(bobId)) + (await abc.balanceOf(carolId)),
  await abc.totalSupply(),
  "ABC balance sum equals supply",
);
console.log("BALANCE_SUM_EQUALS_SUPPLY=PASS");
console.log("REAL_MINIJAM_E2E=PASS");
console.log("LOCUS_V0_1=PASS");
