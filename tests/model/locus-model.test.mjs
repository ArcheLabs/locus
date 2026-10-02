import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { encodeActionPayload } from "@jamscript/client";
import { LocusClient, LocusError, encodeAssetName, encodeAssetSymbol, formatAmount, parseAmount } from "../../dist/sdk/index.js";
import { LocusModel, MAX_U128, id, owner, key } from "./locus-model.mjs";

const serviceAbi = JSON.parse(readFileSync(new URL("../../abi/service.abi.json", import.meta.url), "utf8"));

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

test("Matrix controllers authorize independently; revoked pairs cannot be restored", () => {
  const model = new LocusModel();
  const master = owner(60);
  const device1 = owner(61);
  const device2 = owner(62);
  const device3 = owner(63);

  expectCode(5001, () => model.requireController(master, device1));
  model.authorizeMatrixController(master, device1);
  assert.equal(model.controllerGrant(master, device1), 1);

  model.authorizeMatrixController(master, device2);
  model.authorizeMatrixController(master, device3);
  assert.equal(model.controllerGrant(master, device2), 1);
  assert.equal(model.controllerGrant(master, device3), 1);
  model.requireController(master, device1);
  model.requireController(master, device2);
  model.requireController(master, device3);

  const beforeDuplicate = new Map(model.controllerGrants);
  model.authorizeMatrixController(master, device2);
  assert.deepEqual(model.controllerGrants, beforeDuplicate);

  const asset = id(80);
  const recipient = owner(81);
  model.createAsset(master, asset, encodeAssetName("Shared Matrix asset"), encodeAssetSymbol("SHR"), 6, 1_000n);
  model.transferAs(device1, master, asset, recipient, 10n);
  model.transferAs(device2, master, asset, recipient, 20n);
  model.transferAs(device3, master, asset, recipient, 30n);
  assert.equal(model.balance(asset, recipient), 60n);

  model.revokeController(device2, master, device1);
  assert.equal(model.controllerGrant(master, device1), 0);
  const balanceBeforeDeniedAction = model.balance(asset, recipient);
  expectCode(5001, () => model.requireController(master, device1));
  expectCode(5001, () => model.transferAs(device1, master, asset, recipient, 1n));
  assert.equal(model.balance(asset, recipient), balanceBeforeDeniedAction);
  expectCode(5003, () => model.authorizeMatrixController(master, device1));
  model.requireController(master, device2);
  model.requireController(master, device3);
  model.transferAs(device2, master, asset, recipient, 1n);
  assert.equal(model.balance(asset, recipient), balanceBeforeDeniedAction + 1n);

  const device4 = owner(64);
  model.authorizeMatrixController(master, device4);
  model.requireController(master, device4);
});

test("direct owner needs no registration to manage identity", () => {
  const model = new LocusModel();
  const subject = owner(64);
  const controller = owner(65);
  model.requireController(subject, subject);
  model.addController(subject, subject, controller);
  assert.equal(model.controllerGrant(subject, controller), 1);
});

test("controller grants are non-transitive", () => {
  const model = new LocusModel();
  const master = owner(66);
  const device1 = owner(67);
  const device2 = owner(68);
  model.authorizeMatrixController(master, device1);
  model.addController(device1, device1, device2);
  expectCode(5001, () => model.requireController(master, device2));
});

test("Matrix controller operates on the master subject without moving asset ownership", () => {
  const model = new LocusModel();
  const master = owner(69);
  const device = owner(70);
  const recipient = owner(71);
  const matrixAsset = id(11);

  model.authorizeMatrixController(master, device);
  model.createAssetAs(device, master, matrixAsset, encodeAssetName("Matrix Token"), encodeAssetSymbol("MTRX"), 0, 100n);
  assert.deepEqual(model.asset(matrixAsset).issuer, master);
  assert.equal(model.balance(matrixAsset, master), 100n);
  assert.equal(model.balance(matrixAsset, device), 0n);

  model.transferAs(device, master, matrixAsset, recipient, 25n);
  assert.equal(model.balance(matrixAsset, master), 75n);
  assert.equal(model.balance(matrixAsset, recipient), 25n);

  model.revokeController(device, master, device);
  expectCode(5001, () => model.transferAs(device, master, matrixAsset, recipient, 1n));
});

test("invalid Matrix proof does not create a controller grant", () => {
  const model = new LocusModel();
  const master = owner(72);
  const device = owner(73);
  expectCode(5005, () => model.authorizeMatrixController(master, device, false));
  assert.equal(model.controllerGrant(master, device), null);
});

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
    async queryBest(name, queryKey) { return { value: model.query(name, queryKey) }; },
    async waitForAction() { return { status: "applied" }; },
  };
  const signer = { async getController() { return alice; }, async signJamScriptAction() { return new Uint8Array([1]); } };
  const client = new LocusClient(adapter, { signer, subject: alice });
  await client.transfer(assetId, bob, 3n);
  assert.equal(submitted[0].actionName, "transfer");
  assert.deepEqual(submitted[0].input.to, bob);
  assert.equal(typeof submitted[0].input.amount, "bigint");
  assert.equal(await client.balanceOf(assetId, bob), 3n);
  assert.equal(key(submitted[0].input.to), key(bob));
});

test("SDK injects the stable subject and does not use actAs", async () => {
  const calls = [];
  const adapter = {
    async submitOwnershipAction(...args) { calls.push(args); return { transactionId: "0x1", status: "queued", actionHash: "0x2" }; },
    async queryBest() { return { value: null }; },
    async waitForAction() { return { status: "applied" }; },
  };
  const controller = owner(51);
  const subject = owner(52);
  const signer = { async getController() { return controller; }, async signJamScriptAction() { return new Uint8Array([1]); } };
  await new LocusClient(adapter, { signer, subject }).transfer(assetId, bob, 1n);
  assert.equal(calls[0][0], "transfer");
  assert.equal(calls[0][2], signer);
  assert.deepEqual(calls[0][1].subject, subject);
  assert.equal(calls[0].length, 3);
});

test("direct-owner session uses signer controller as subject and encodes through JamScript SDK", async () => {
  const calls = [];
  const signer = {
    controller: alice,
    async getController() { return this.controller; },
    async signJamScriptAction() { return new Uint8Array([1]); },
  };
  const session = { signer, subject: signer.controller };
  assert.equal(signer.controller, session.subject);
  const adapter = {
    async submitOwnershipAction(actionName, input) {
      const payload = encodeActionPayload(serviceAbi, actionName, input);
      calls.push({ actionName, input, payload });
      return { transactionId: "0xencoded", status: "queued", actionHash: "0xhash" };
    },
    async queryBest() { return { value: null }; },
    async waitForAction() { return { status: "applied" }; },
  };

  const result = await new LocusClient(adapter, session).createAsset(assetId, "Direct", "DIR", 0, 1n);
  assert.equal(result.transactionId, "0xencoded");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].actionName, "createAsset");
  assert.equal(calls[0].input.subject, signer.controller);
  assert.ok(calls[0].payload instanceof Uint8Array);
  assert.ok(calls[0].payload.length > 0);
});

test("malformed JavaScript Ownership session rejects missing subject before submission", async () => {
  let submissions = 0;
  const signer = {
    async getController() { return alice; },
    async signJamScriptAction() { return new Uint8Array([1]); },
  };
  const adapter = {
    async submitOwnershipAction() { submissions += 1; return { transactionId: "0x1", status: "queued", actionHash: "0x2" }; },
    async queryBest() { return { value: null }; },
    async waitForAction() { return { status: "applied" }; },
  };

  await assert.rejects(
    () => new LocusClient(adapter, { signer }).createAsset(assetId, "Invalid", "INV", 0, 1n),
    /session\.subject is not a valid Ownership/,
  );
  assert.equal(submissions, 0);
});

test("SDK treats missing controller state as inactive", async () => {
  const subject = owner(74);
  const controller = owner(75);
  const signer = { async getController() { return controller; }, async signJamScriptAction() { return new Uint8Array([1]); } };
  const adapter = {
    async submitOwnershipAction() { return { transactionId: "0x1", status: "queued", actionHash: "0x2" }; },
    async queryBest() { return { value: null }; },
    async waitForAction() { return { status: "applied" }; },
  };
  const client = new LocusClient(adapter, { signer, subject });
  assert.equal(await client.getControllerStatus(subject, controller), "absent");
  assert.equal(await client.isControllerActive(subject, controller), false);
});

test("SDK reports absent, active and revoked controller grant states", async () => {
  const subject = owner(76);
  const controller = owner(77);
  const results = [null, 1n, 0n];
  const signer = { async getController() { return controller; }, async signJamScriptAction() { return new Uint8Array([1]); } };
  const client = new LocusClient({
    async submitOwnershipAction() { return { transactionId: "0x1", status: "queued", actionHash: "0x2" }; },
    async queryBest() { return { value: results.shift() ?? null }; },
    async waitForAction() { return { status: "applied" }; },
  }, { signer, subject });
  assert.equal(await client.getControllerStatus(subject, controller), "absent");
  assert.equal(await client.getControllerStatus(subject, controller), "active");
  assert.equal(await client.getControllerStatus(subject, controller), "revoked");
});

test("SDK submits the Matrix proof through the per-controller authorization action", async () => {
  const calls = [];
  const controller = owner(78);
  const signer = { async getController() { return controller; }, async signJamScriptAction() { return new Uint8Array([1]); } };
  const client = new LocusClient({
    async submitOwnershipAction(actionName, input) {
      calls.push({ actionName, input });
      return { transactionId: "0xauth", status: "queued", actionHash: "0xproof" };
    },
    async queryBest() { return { value: null }; },
    async waitForAction() { return { status: "applied" }; },
  }, { signer, subject: owner(79) });
  const proof = new Uint8Array([1, 2, 3]);
  await client.authorizeMatrixController(proof);
  assert.equal(calls[0].actionName, "authorizeMatrixController");
  assert.deepEqual(calls[0].input.proof, proof);
});

test("SDK surfaces mapped application errors", async () => {
  const client = new LocusClient({
    async submitOwnershipAction() {
      const error = new Error("not issuer");
      error.code = 2007;
      throw error;
    },
    async queryBest() { return { value: null }; },
    async waitForAction() { return {}; },
  }, { signer: { async getController() { return alice; }, async signJamScriptAction() { return new Uint8Array([1]); } }, subject: alice });
  await assert.rejects(() => client.mint(assetId, bob, 1n), (error) => error instanceof LocusError && error.code === 2007);
});

test("amount helpers preserve exact u128-scale values", () => {
  const value = parseAmount("100000000000000000000.123456789012345678", 18);
  assert.equal(value, 100000000000000000000123456789012345678n);
  assert.equal(formatAmount(value, 18), "100000000000000000000.123456789012345678");
});
