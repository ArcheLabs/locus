import assert from "node:assert/strict";
import test from "node:test";
import { LocusModel, MAX_U128, id, key } from "./locus-model.mjs";
import {
  LocusClient,
  LocusError,
  encodeAssetName,
  encodeAssetSymbol,
} from "../../dist/sdk/index.js";

const aliceId = id(1);
const bobId = id(2);
const carolId = id(3);
const abcId = id(10);
const xyzId = id(11);
const keyA = id(21);
const keyB = id(22);

function expectCode(code, callback) {
  assert.throws(callback, (error) => error?.code === code, `expected Locus abort ${code}`);
}

function setup() {
  const model = new LocusModel();
  model.createIdentity(aliceId, keyA);
  model.createIdentity(bobId, id(2));
  model.createIdentity(carolId, id(3));
  model.createAsset(aliceId, 0n, abcId, encodeAssetName("ABC Token"), encodeAssetSymbol("ABC"), 18, 100n, keyA);
  return model;
}

test("main identity-native ERC-20 scenario preserves ownership abstraction", () => {
  const model = setup();
  model.transfer(aliceId, 1n, abcId, bobId, 20n, keyA);
  model.approve(aliceId, 2n, abcId, bobId, 15n, keyA);

  model.rotateOwner(aliceId, 3n, keyB, keyA);
  assert.equal(model.balance(abcId, aliceId), 80n);
  assert.equal(model.allowance(abcId, aliceId, bobId), 15n);
  assert.deepEqual(model.asset(abcId).issuer, aliceId);
  assert.equal(model.identity(aliceId).nonce, 4n);

  expectCode(1004, () => model.transfer(aliceId, 4n, abcId, bobId, 10n, keyA));
  model.transfer(aliceId, 4n, abcId, bobId, 10n, keyB);
  model.transferFrom(bobId, 0n, abcId, aliceId, carolId, 7n, id(2));
  model.mint(aliceId, 5n, abcId, bobId, 10n, keyB);
  model.burn(aliceId, 6n, abcId, 3n, keyB);

  assert.equal(model.balance(abcId, aliceId), 60n);
  assert.equal(model.balance(abcId, bobId), 40n);
  assert.equal(model.balance(abcId, carolId), 7n);
  assert.equal(model.allowance(abcId, aliceId, bobId), 8n);
  assert.equal(model.asset(abcId).totalSupply, 107n);
  assert.equal(model.totalBalance(abcId), model.asset(abcId).totalSupply);
});

test("wide u128 quantities remain exact beyond Number.MAX_SAFE_INTEGER", () => {
  const model = new LocusModel();
  model.createIdentity(aliceId, keyA);
  model.createIdentity(bobId, id(2));
  const wide = 1000000000000000000000000000n;
  const transfer = 123456789012345678901234n;
  model.createAsset(aliceId, 0n, abcId, new Uint8Array([65]), new Uint8Array([65]), 0, wide, keyA);
  model.transfer(aliceId, 1n, abcId, bobId, transfer, keyA);
  assert.equal(model.balance(abcId, aliceId), wide - transfer);
  assert.equal(model.balance(abcId, bobId), transfer);
  assert.equal(model.asset(abcId).totalSupply, wide);
});

test("recipient does not sign, and self/zero transfers are safe", () => {
  const model = setup();
  model.transfer(aliceId, 1n, abcId, bobId, 0n, keyA);
  model.transfer(aliceId, 2n, abcId, aliceId, 10n, keyA);
  assert.equal(model.balance(abcId, aliceId), 100n);
  assert.equal(model.balance(abcId, bobId), 0n);
  assert.equal(model.identity(aliceId).nonce, 3n);
});

test("negative authorization, identity, metadata, and allowance paths are stable", () => {
  const model = setup();
  expectCode(1002, () => model.createIdentity(aliceId, keyA));
  expectCode(1003, () => model.createIdentity(new Uint8Array(32), keyA));
  expectCode(2002, () => model.createAsset(aliceId, 1n, abcId, new Uint8Array([1]), new Uint8Array([1]), 0, 0n, keyA));
  expectCode(2004, () => model.createAsset(aliceId, 1n, xyzId, new Uint8Array(), new Uint8Array([1]), 0, 0n, keyA));
  expectCode(2006, () => model.createAsset(aliceId, 1n, xyzId, new Uint8Array([1]), new Uint8Array([1]), 39, 0n, keyA));
  expectCode(1004, () => model.transfer(aliceId, 1n, abcId, bobId, 1n, id(99)));
  expectCode(3001, () => model.transfer(aliceId, 1n, abcId, id(88), 1n, keyA));
  expectCode(3002, () => model.transfer(aliceId, 1n, abcId, bobId, 101n, keyA));
  expectCode(4002, () => model.transferFrom(bobId, 0n, abcId, aliceId, carolId, 1n, id(2)));
  expectCode(1007, () => model.transfer(aliceId, 0n, abcId, bobId, 1n, keyA));
});

test("owner rotation preserves allowance and issuer, and mint authority follows the identity", () => {
  const model = setup();
  model.approve(aliceId, 1n, abcId, bobId, 15n, keyA);
  model.rotateOwner(aliceId, 2n, keyB, keyA);
  expectCode(1004, () => model.mint(aliceId, 3n, abcId, bobId, 1n, keyA));
  model.mint(aliceId, 3n, abcId, bobId, 1n, keyB);
  assert.equal(model.allowance(abcId, aliceId, bobId), 15n);
  assert.equal(model.asset(abcId).totalSupply, 101n);
});

test("duplicate symbols are permitted because AssetId is the identifier", () => {
  const model = setup();
  model.createAsset(aliceId, 1n, xyzId, new Uint8Array([88]), new Uint8Array([65, 66, 67]), 0, 0n, keyA);
  assert.notEqual(key(abcId), key(xyzId));
  assert.equal(model.asset(abcId).symbol.length, model.asset(xyzId).symbol.length);
});

test("u128 max and checked overflow are handled by the reference model", () => {
  const model = new LocusModel();
  model.createIdentity(aliceId, keyA);
  model.createIdentity(bobId, id(2));
  model.createAsset(aliceId, 0n, abcId, new Uint8Array([65]), new Uint8Array([65]), 0, MAX_U128, keyA);
  expectCode(3003, () => model.mint(aliceId, 1n, abcId, bobId, 1n, keyA));
});

test("SDK fetches the current identity nonce instead of guessing it", async () => {
  const model = new LocusModel();
  const submitted = [];
  const adapter = {
    async submitAction(actionName, input) {
      submitted.push({ actionName, input });
      if (actionName === "createIdentity") model.createIdentity(input.identityId, keyA);
      if (actionName === "transfer") model.transfer(input.fromId, input.nonce, input.assetId, input.toId, input.amount, keyA);
      return { ok: true };
    },
    async queryLatest(name, queryKey) {
      const value = model.query(name, queryKey);
      return { value };
    },
    async waitForAction() {
      return { ok: true };
    },
  };
  const client = new LocusClient(adapter);
  await client.createIdentity(aliceId);
  await client.createIdentity(bobId);
  model.createAsset(aliceId, 0n, abcId, new Uint8Array([65]), new Uint8Array([65]), 0, 10n, keyA);
  await client.transfer(aliceId, abcId, bobId, 3n);
  assert.equal(submitted.at(-1).input.nonce, 1n);
  assert.equal(model.balance(abcId, bobId), 3n);
  assert.equal(submitted.at(-1).input.amount, 3n);
  assert.equal(typeof submitted.at(-1).input.amount, "bigint");
});

test("SDK surfaces mapped application errors", async () => {
  const client = new LocusClient({
    async submitAction() {
      const error = new Error("unauthorized");
      error.code = 1004;
      throw error;
    },
    async queryLatest() { return { value: null }; },
    async waitForAction() { return {}; },
  });
  await assert.rejects(() => client.createIdentity(aliceId), (error) => {
    assert.ok(error instanceof LocusError);
    return error.code === 1004 && error.locusName === "UNAUTHORIZED_OWNER";
  });
});

test("SDK exposes the asset-bound ERC-20 façade and direct discovery queries", async () => {
  const model = setup();
  const adapter = {
    async submitAction() { return { ok: true }; },
    async queryLatest(name, queryKey) { return { value: model.query(name, queryKey) }; },
    async waitForAction() { return { ok: true }; },
  };
  const client = new LocusClient(adapter);
  const asset = client.asset(abcId);
  assert.equal(await asset.name(), "ABC Token");
  assert.equal(await asset.symbol(), "ABC");
  assert.equal(await asset.decimals(), 18);
  assert.equal(await asset.totalSupply(), 100n);
  assert.deepEqual(await client.listIdentities(), [aliceId, bobId, carolId]);
  assert.deepEqual(await client.listAssets(), [abcId]);
  assert.equal(await client.balanceOf(abcId, bobId), 0n);
  assert.equal(await client.allowance(abcId, aliceId, bobId), 0n);
});
