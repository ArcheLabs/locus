import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { encodeActionPayload, OWNERSHIP_KIND } from "@jamscript/client";
import {
  LocusClient,
  LocusError,
  MAX_POOL_RESERVE,
  evmOwnership,
  minimumAmountOut,
  quoteExactIn,
} from "../../dist/sdk/index.js";
import { LocusModel, MAX_U128, id, owner, key } from "./locus-model.mjs";

const abi = JSON.parse(readFileSync(new URL("../../abi/service.abi.json", import.meta.url), "utf8"));
const alice = owner(101);
const bob = owner(102);
const treasury = evmOwnership("0x78B02E176e587E163661fBe70232CCDDEb11759e");
const assetA = id(11);
const assetB = id(22);

function expectCode(code, callback) {
  assert.throws(callback, (error) => error?.code === code, `expected Locus abort ${code}`);
}

function fundedModel() {
  const model = new LocusModel();
  model.createAsset(alice, assetA, new Uint8Array([65]), new Uint8Array([65]), 6, 1_000_000n);
  model.createAsset(alice, assetB, new Uint8Array([66]), new Uint8Array([66]), 6, 2_000_000n);
  return model;
}

test("createAsset keeps issuer separate from initial holder and supports zero supply", () => {
  const model = new LocusModel();
  const otherAsset = id(12);
  model.createAsset(alice, assetA, new Uint8Array([65]), new Uint8Array([65]), 6, 900n, treasury);
  assert.deepEqual(model.asset(assetA).issuer, alice);
  assert.equal(model.balance(assetA, alice), 0n);
  assert.equal(model.balance(assetA, treasury), 900n);
  assert.equal(model.totalAccounted(assetA), model.asset(assetA).totalSupply);
  model.createAsset(alice, otherAsset, new Uint8Array([66]), new Uint8Array([66]), 0, 0n, treasury);
  assert.equal(model.balance(otherAsset, treasury), 0n);
  assert.equal(model.balances.has(`${key(otherAsset)}:${key(treasury)}`), false);
});

test("authorized controller can issue to a different initial holder", () => {
  const model = new LocusModel();
  const master = owner(103);
  const device = owner(104);
  model.authorizeMatrixController(master, device);
  model.createAssetAs(device, master, assetA, new Uint8Array([65]), new Uint8Array([65]), 0, 500n, treasury);
  assert.deepEqual(model.asset(assetA).issuer, master);
  assert.equal(model.balance(assetA, master), 0n);
  assert.equal(model.balance(assetA, treasury), 500n);
});

test("SDK defaults initialHolder to session.subject and validates explicit Ownership", async () => {
  const calls = [];
  const signer = { async getController() { return alice; }, async signJamScriptAction() { return new Uint8Array([1]); } };
  const adapter = {
    async submitOwnershipAction(actionName, input) {
      calls.push({ actionName, input, payload: encodeActionPayload(abi, actionName, input) });
      return { transactionId: "0xcreate", status: "queued", actionHash: "0xaction" };
    },
    async queryLatest() { return { value: null }; },
    async waitForAction() { return { status: "applied" }; },
  };
  const locus = new LocusClient(adapter, { signer, subject: alice });
  await locus.createAsset(assetA, "Default", "DEF", 6, 10n);
  await locus.createAsset(assetB, "Treasury", "TRY", 6, 20n, treasury);
  assert.deepEqual(calls[0].input.initialHolder, alice);
  assert.deepEqual(calls[1].input.initialHolder, treasury);
  assert.ok(calls.every((call) => call.payload instanceof Uint8Array && call.payload.length > 0));
  assert.equal(treasury.kind, OWNERSHIP_KIND.SECP256K1_KECCAK20);
  let submissions = calls.length;
  await assert.rejects(
    () => locus.createAsset(id(13), "Bad", "BAD", 0, 1n, { version: 1, kind: 2, public: new Uint8Array([1]) }),
    /initialHolder is not a valid Ownership/,
  );
  assert.equal(calls.length, submissions);
});

test("issuer cannot spend treasury's initial balance or become its pool manager", () => {
  const model = new LocusModel();
  model.createAsset(alice, assetA, new Uint8Array([65]), new Uint8Array([65]), 6, 1_000n, treasury);
  model.createAsset(alice, assetB, new Uint8Array([66]), new Uint8Array([66]), 6, 1_000n, treasury);
  expectCode(3002, () => model.transfer(alice, assetA, bob, 1n));
  model.createPoolAs(treasury, treasury, assetA, assetB, 10n, 10n);
  expectCode(6007, () => model.addPoolLiquidityAs(alice, alice, assetA, assetB, 1n, 1n));
  assert.equal(model.balance(assetA, treasury), 990n);
});

test("pool pair is canonical and reversed pair cannot create another pool", () => {
  const model = fundedModel();
  model.createPoolAs(alice, alice, assetB, assetA, 100n, 200n);
  const pool = model.pool(assetA, assetB);
  assert.deepEqual(pool.asset0, assetA);
  assert.deepEqual(pool.asset1, assetB);
  assert.equal(pool.reserve0, 200n);
  assert.equal(pool.reserve1, 100n);
  assert.equal(model.poolIndex.length, 1);
  expectCode(6002, () => model.createPoolAs(alice, alice, assetA, assetB, 1n, 1n));
  expectCode(6003, () => model.createPoolAs(alice, alice, assetA, assetA, 1n, 1n));
  expectCode(2001, () => model.createPoolAs(alice, alice, assetA, id(33), 1n, 1n));
});

test("only pool manager can add/remove liquidity; supply accounting remains conserved", () => {
  const model = fundedModel();
  const supplyA = model.asset(assetA).totalSupply;
  const supplyB = model.asset(assetB).totalSupply;
  model.createPoolAs(alice, alice, assetA, assetB, 100n, 200n);
  expectCode(6007, () => model.addPoolLiquidityAs(bob, bob, assetA, assetB, 1n, 2n));
  expectCode(6007, () => model.removePoolLiquidityAs(bob, bob, assetA, assetB, 1n, 2n));
  model.addPoolLiquidityAs(alice, alice, assetA, assetB, 50n, 80n);
  assert.equal(model.totalAccounted(assetA), supplyA);
  assert.equal(model.totalAccounted(assetB), supplyB);
  model.removePoolLiquidityAs(alice, alice, assetB, assetA, 10n, 5n);
  assert.equal(model.totalAccounted(assetA), supplyA);
  assert.equal(model.totalAccounted(assetB), supplyB);
});

test("exact-input swaps apply fee, both directions, slippage and atomic rollback", () => {
  const model = fundedModel();
  model.createPoolAs(alice, alice, assetA, assetB, 100_000n, 300_000n);
  model.transfer(alice, assetA, bob, 1_000n);
  const poolBefore = structuredClone(model.pool(assetA, assetB));
  const bobBeforeA = model.balance(assetA, bob);
  const bobBeforeB = model.balance(assetB, bob);
  const quoteOut = model.quoteExactIn(assetA, assetB, 100n);
  expectCode(6006, () => model.swapExactInAs(bob, bob, assetA, assetB, 100n, quoteOut + 1n));
  assert.deepEqual(model.pool(assetA, assetB), poolBefore);
  assert.equal(model.balance(assetA, bob), bobBeforeA);
  assert.equal(model.balance(assetB, bob), bobBeforeB);
  const kBefore = poolBefore.reserve0 * poolBefore.reserve1;
  const received = model.swapExactInAs(bob, bob, assetA, assetB, 100n, quoteOut);
  assert.equal(received, quoteOut);
  let pool = model.pool(assetA, assetB);
  assert.ok(pool.reserve0 * pool.reserve1 >= kBefore);
  assert.equal(model.balance(assetA, bob), bobBeforeA - 100n);
  assert.equal(model.balance(assetB, bob), bobBeforeB + received);
  const reverseIn = 80n;
  const reverseOut = model.quoteExactIn(assetB, assetA, reverseIn);
  const reverseK = pool.reserve0 * pool.reserve1;
  assert.equal(model.swapExactInAs(bob, bob, assetB, assetA, reverseIn, reverseOut), reverseOut);
  pool = model.pool(assetA, assetB);
  assert.ok(pool.reserve0 * pool.reserve1 >= reverseK);
  assert.equal(model.totalAccounted(assetA), model.asset(assetA).totalSupply);
  assert.equal(model.totalAccounted(assetB), model.asset(assetB).totalSupply);
  expectCode(3002, () => model.swapExactInAs(bob, bob, assetA, assetB, 10_000n, 0n));
  expectCode(6004, () => model.swapExactInAs(bob, bob, assetA, assetB, 0n, 0n));
});

test("reserve bounds protect u128 multiplication and empty pools reject quotes", () => {
  const model = new LocusModel();
  const wide = id(31);
  model.createAsset(alice, assetA, new Uint8Array([65]), new Uint8Array([65]), 0, MAX_U128);
  model.createAsset(alice, assetB, new Uint8Array([66]), new Uint8Array([66]), 0, MAX_U128);
  expectCode(6008, () => model.createPoolAs(alice, alice, assetA, assetB, MAX_POOL_RESERVE + 1n, 1n));
  model.createPoolAs(alice, alice, assetA, assetB, 1n, 1n);
  expectCode(6008, () => model.addPoolLiquidityAs(alice, alice, assetA, assetB, MAX_POOL_RESERVE, 1n));
  model.createAsset(alice, wide, new Uint8Array([67]), new Uint8Array([67]), 0, 0n);
  expectCode(6001, () => model.quoteExactIn(assetA, wide, 1n));
  expectCode(6004, () => quoteExactIn(100n, 100n, 0n));
  expectCode(6005, () => quoteExactIn(0n, 100n, 1n));
});

test("SDK quote, pool read and slippage helper use exact integer rules", async () => {
  const model = fundedModel();
  model.createPoolAs(alice, alice, assetA, assetB, 100_000n, 200_000n);
  const adapter = {
    async submitOwnershipAction(actionName, input) {
      return { actionName, input, transactionId: "0x1", status: "queued", actionHash: "0x2" };
    },
    async queryLatest(name, queryKey) { return { value: model.query(name, queryKey) }; },
    async waitForAction() { return { status: "applied" }; },
  };
  const client = new LocusClient(adapter, null);
  const quote = await client.quoteExactIn(assetA, assetB, 1_000n);
  assert.equal(quote.amountOut, model.quoteExactIn(assetA, assetB, 1_000n));
  assert.equal(quote.feeBps, 30);
  assert.equal(quote.minimumAmountOut, quote.amountOut);
  assert.equal(minimumAmountOut(quote.amountOut, 100), quote.amountOut * 9900n / 10_000n);
  const pool = await client.getPool(assetB, assetA);
  assert.ok(pool);
  assert.equal((await client.listPools()).length, 1);
  assert.equal((await client.pool(assetA, assetB).quoteExactIn(assetA, 1_000n)).amountOut, quote.amountOut);
  assert.deepEqual(abi.actions.find((action) => action.name === "createAsset").input.map((field) => field.name), ["subject", "assetId", "name", "symbol", "decimals", "initialSupply", "initialHolder"]);
  for (const name of ["createPool", "addPoolLiquidity", "removePoolLiquidity", "swapExactIn"]) {
    assert.ok(abi.actions.some((action) => action.name === name), `${name} ABI action is present`);
  }
});

test("SDK treats never-written asset and pool counts as zero on a fresh Service", async () => {
  const adapter = {
    async queryLatest() { return { value: null }; },
    async submitOwnershipAction() { throw new Error("unexpected submission"); },
  };
  const locus = new LocusClient(adapter, null);
  assert.deepEqual(await locus.listAssets(), []);
  assert.deepEqual(await locus.listPools(), []);
});

test("SDK hydrates pool pair keys from the query key when the stored descriptor contains reserves only", async () => {
  const canonical = { asset0: assetA, asset1: assetB };
  const value = {
    version: 1,
    manager: alice,
    reserve0: 123n,
    reserve1: 456n,
  };
  const adapter = {
    async queryLatest(queryName) {
      if (queryName === "getPool") return { value };
      if (queryName === "getPoolCount") return { value: 1n };
      if (queryName === "getPoolByIndex") return { value: canonical };
      throw new Error(`unexpected query ${queryName}`);
    },
    async submitOwnershipAction() { throw new Error("unexpected submission"); },
  };
  const locus = new LocusClient(adapter, null);
  const pool = await locus.getPool(assetB, assetA);
  assert.deepEqual(pool.asset0, assetA);
  assert.deepEqual(pool.asset1, assetB);
  assert.equal(pool.reserve0, 123n);
  assert.equal(pool.reserve1, 456n);
  assert.deepEqual(await locus.listPools(), [pool]);
});

test("deterministic swap sample vectors preserve the constant-product invariant", () => {
  let seed = 0x12345678;
  const random = (max) => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return BigInt(seed % max) + 1n;
  };
  for (let i = 0; i < 500; i += 1) {
    const reserveIn = random(1_000_000_000);
    const reserveOut = random(1_000_000_000);
    const amountIn = random(Number(MAX_POOL_RESERVE < 1_000_000n ? MAX_POOL_RESERVE : 1_000_000n));
    const amountOut = quoteExactIn(reserveIn, reserveOut, amountIn).amountOut;
    const netAmountIn = amountIn * 9970n / 10_000n;
    assert.ok(amountOut > 0n && amountOut < reserveOut);
    assert.ok((reserveIn + amountIn) * (reserveOut - amountOut) >= reserveIn * reserveOut);
    assert.ok(reserveOut * netAmountIn < 1n << 128n);
  }
});
