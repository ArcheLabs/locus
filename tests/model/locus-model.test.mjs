import assert from "node:assert/strict";
import test from "node:test";
import { LocusClient, LocusError, encodeAssetName, encodeAssetSymbol, formatAmount, parseAmount } from "../../dist/sdk/index.js";
import { LocusModel, MAX_U128, id, owner, key } from "./locus-model.mjs";

const alice = owner(41);
const bob = owner(42);
const carol = owner(43);
const assetId = id(10);

function expectCode(code, callback) {
  assert.throws(callback, (error) => error?.code === code, `expected Locus abort ${code}`);
}

function setup() {
  const model = new LocusModel();
  model.createAsset(alice, assetId, encodeAssetName("ABC Token"), encodeAssetSymbol("ABC"), 18, 100n);
  return model;
}

test("ownership-native ERC-20 scenario preserves issuer and allowance", () => {
  const model = setup();
  model.transfer(alice, assetId, bob, 20n);
  model.approve(alice, assetId, bob, 15n);
  model.transfer(alice, assetId, bob, 10n);
  model.transferFrom(bob, assetId, alice, carol, 7n);
  model.mint(alice, assetId, bob, 10n);
  model.burn(alice, assetId, 3n);

  assert.equal(model.balance(assetId, alice), 60n);
  assert.equal(model.balance(assetId, bob), 40n);
  assert.equal(model.balance(assetId, carol), 7n);
  assert.equal(model.allowance(assetId, alice, bob), 8n);
  assert.equal(model.asset(assetId).totalSupply, 107n);
  assert.equal(model.totalBalance(assetId), model.asset(assetId).totalSupply);
});

test("unregistered Ownership recipients and wide u128 quantities remain exact", () => {
  const model = new LocusModel();
  const wide = 1000000000000000000000000000n;
  const transfer = 123456789012345678901234n;
  model.createAsset(alice, assetId, new Uint8Array([65]), new Uint8Array([65]), 0, wide);
  model.transfer(alice, assetId, owner(99), transfer);
  assert.equal(model.balance(assetId, owner(99)), transfer);
  assert.equal(model.balance(assetId, alice), wide - transfer);
  assert.equal(model.asset(assetId).totalSupply, wide);
});

test("self transfer and zero transfer are safe without registration", () => {
  const model = setup();
  model.transfer(alice, assetId, bob, 0n);
  model.transfer(alice, assetId, alice, 10n);
  assert.equal(model.balance(assetId, alice), 100n);
  assert.equal(model.balance(assetId, bob), 0n);
});

test("negative authorization, allowance, metadata, and overflow paths are stable", () => {
  const model = setup();
  expectCode(2002, () => model.createAsset(alice, assetId, new Uint8Array([1]), new Uint8Array([1]), 0, 0n));
  expectCode(2004, () => model.createAsset(alice, id(11), new Uint8Array(), new Uint8Array([1]), 0, 0n));
  expectCode(2006, () => model.createAsset(alice, id(11), new Uint8Array([1]), new Uint8Array([1]), 39, 0n));
  expectCode(2007, () => model.mint(bob, assetId, carol, 1n));
  expectCode(3002, () => model.transfer(alice, assetId, bob, 101n));
  expectCode(4002, () => model.transferFrom(bob, assetId, alice, carol, 1n));
});

test("u128 max and checked overflow are handled by the reference model", () => {
  const model = new LocusModel();
  model.createAsset(alice, assetId, new Uint8Array([65]), new Uint8Array([65]), 0, MAX_U128);
  expectCode(3003, () => model.mint(alice, assetId, bob, 1n));
});

test("SDK uses Ownership auth and canonical ownership keys", async () => {
  const model = setup();
  const submitted = [];
  const adapter = {
    async submitOwnershipAction(actionName, input) {
      submitted.push({ actionName, input });
      if (actionName === "transfer") model.transfer(alice, input.assetId, input.to, input.amount);
      return { transactionId: "0x1", status: "queued", actionHash: "0x2" };
    },
    async queryLatest(name, queryKey) { return { value: model.query(name, queryKey) }; },
    async waitForAction() { return { status: "applied" }; },
  };
  const signer = { async getController() { return alice; }, async signJamScriptAction() { return new Uint8Array([1]); } };
  const client = new LocusClient(adapter, { signer });
  await client.transfer(assetId, bob, 3n);
  assert.equal(submitted[0].actionName, "transfer");
  assert.deepEqual(submitted[0].input.to, bob);
  assert.equal(typeof submitted[0].input.amount, "bigint");
  assert.equal(await client.balanceOf(assetId, bob), 3n);
  assert.equal(key(submitted[0].input.to), key(bob));
});

test("SDK forwards controller delegation as actAs", async () => {
  const calls = [];
  const adapter = {
    async submitOwnershipAction(...args) { calls.push(args); return { transactionId: "0x1", status: "queued", actionHash: "0x2" }; },
    async queryLatest() { return { value: null }; },
    async waitForAction() { return { status: "applied" }; },
  };
  const controller = owner(51);
  const subject = owner(52);
  const signer = { async getController() { return controller; }, async signJamScriptAction() { return new Uint8Array([1]); } };
  await new LocusClient(adapter, { signer, actAs: subject }).transfer(assetId, bob, 1n);
  assert.deepEqual(calls[0][3], { actAs: subject });
});

test("SDK surfaces mapped application errors", async () => {
  const client = new LocusClient({
    async submitOwnershipAction() {
      const error = new Error("not issuer");
      error.code = 2007;
      throw error;
    },
    async queryLatest() { return { value: null }; },
    async waitForAction() { return {}; },
  }, { signer: { async getController() { return alice; }, async signJamScriptAction() { return new Uint8Array([1]); } } });
  await assert.rejects(() => client.mint(assetId, bob, 1n), (error) => error instanceof LocusError && error.code === 2007);
});

test("amount helpers preserve exact u128-scale values", () => {
  const value = parseAmount("100000000000000000000.123456789012345678", 18);
  assert.equal(value, 100000000000000000000123456789012345678n);
  assert.equal(formatAmount(value, 18), "100000000000000000000.123456789012345678");
});
