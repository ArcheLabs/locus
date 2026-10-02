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
  integerSqrt,
  ceilDiv,
  quoteInitialLiquidity,
  quoteAddLiquidity,
  quoteRemoveLiquidity,
  formatLiquiditySharePercentage,
} from "../../dist/sdk/index.js";
import { LocusModel, MAX_U128, id, owner, key } from "./locus-model.mjs";

const abi = JSON.parse(readFileSync(new URL("../../abi/service.abi.json", import.meta.url), "utf8"));
const alice = owner(101);
const bob = owner(102);
const treasury = evmOwnership("0x78B02E176e587E163661fBe70232CCDDEb11759e");
const assetA = id(11);
const assetB = id(22);

const lifecycleSupport = {
  async assertTransactionLifecycleSupport() {
    return { transactionLifecycleVersion: 1, bestChainTracking: true, strictFinalizedReceipts: true };
  },
};

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
  const adapter = { ...lifecycleSupport,
    async submitOwnershipAction(actionName, input) {
      calls.push({ actionName, input, payload: encodeActionPayload(abi, actionName, input) });
      return { transactionId: "0xcreate", status: "queued", actionHash: "0xaction" };
    },
    async queryBest() { return { value: null }; },
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

test("issuer cannot spend treasury's initial balance; LP management is permissionless", () => {
  const model = new LocusModel();
  model.createAsset(alice, assetA, new Uint8Array([65]), new Uint8Array([65]), 6, 1_000n, treasury);
  model.createAsset(alice, assetB, new Uint8Array([66]), new Uint8Array([66]), 6, 1_000n, treasury);
  expectCode(3002, () => model.transfer(alice, assetA, bob, 1n));
  model.createPoolAs(treasury, treasury, assetA, assetB, 10n, 10n);
  model.transfer(treasury, assetA, alice, 5n);
  model.transfer(treasury, assetB, alice, 5n);
  model.addPoolLiquidityAs(alice, alice, assetA, assetB, 5n, 5n, 5n);
  assert.ok(model.liquidityShares.get(model.shareKey(assetA, assetB, alice)) > 0n);
  assert.equal(model.balance(assetA, treasury), 985n);
});

test("pool pair is canonical and reversed pair cannot create another pool", () => {
  const model = fundedModel();
  model.createPoolAs(alice, alice, assetB, assetA, 100n, 200n);
  const pool = model.pool(assetA, assetB);
  assert.deepEqual(pool.asset0, assetA);
  assert.deepEqual(pool.asset1, assetB);
  assert.equal(pool.reserve0, 200n);
  assert.equal(pool.reserve1, 100n);
  assert.equal(pool.version, 2);
  assert.equal(pool.totalShares, 141n);
  const forwardOrder = fundedModel();
  forwardOrder.createPoolAs(alice, alice, assetA, assetB, 200n, 100n);
  assert.deepEqual(forwardOrder.pool(assetA, assetB), pool);
  assert.equal(model.poolIndex.length, 1);
  expectCode(6002, () => model.createPoolAs(alice, alice, assetA, assetB, 1n, 1n));
  expectCode(6003, () => model.createPoolAs(alice, alice, assetA, assetA, 1n, 1n));
  expectCode(2001, () => model.createPoolAs(alice, alice, assetA, id(33), 1n, 1n));
});

test("multiple Ownership providers receive shares and withdrawals conserve supply", () => {
  const model = fundedModel();
  const supplyA = model.asset(assetA).totalSupply;
  const supplyB = model.asset(assetB).totalSupply;
  model.createPoolAs(alice, alice, assetA, assetB, 100n, 200n);
  model.transfer(alice, assetA, bob, 50n);
  model.transfer(alice, assetB, bob, 100n);
  const added = model.addPoolLiquidityAs(bob, bob, assetA, assetB, 10n, 20n, 14n);
  assert.deepEqual(added, { usedA: 10n, usedB: 20n, mintedShares: 14n });
  const aliceShares = model.liquidityShares.get(model.shareKey(assetA, assetB, alice));
  const bobShares = model.liquidityShares.get(model.shareKey(assetA, assetB, bob));
  expectCode(6010, () => model.removePoolLiquidityAs(alice, alice, assetA, assetB, aliceShares + 1n));
  const bobBefore = model.balance(assetA, bob);
  model.removePoolLiquidityAs(bob, bob, assetA, assetB, 7n);
  assert.ok(model.liquidityShares.get(model.shareKey(assetA, assetB, alice)) === aliceShares);
  assert.ok(model.balance(assetA, bob) > bobBefore);
  assert.equal(model.totalAccounted(assetA), supplyA);
  assert.equal(model.totalAccounted(assetB), supplyB);
  model.removePoolLiquidityAs(alice, alice, assetB, assetA, aliceShares);
  assert.equal(model.totalAccounted(assetA), supplyA);
  assert.equal(model.totalAccounted(assetB), supplyB);
});

test("fixed liquidity vectors conserve shares and assets across providers and swaps", () => {
  const model = fundedModel();
  const carol = owner(105);
  const initialA = model.asset(assetA).totalSupply;
  const initialB = model.asset(assetB).totalSupply;
  model.createPoolAs(alice, alice, assetA, assetB, 10_000n, 20_000n);
  model.transfer(alice, assetA, bob, 3_000n);
  model.transfer(alice, assetB, bob, 6_000n);
  model.transfer(alice, assetA, carol, 2_000n);
  model.transfer(alice, assetB, carol, 4_000n);
  model.addPoolLiquidityAs(bob, bob, assetA, assetB, 2_000n, 6_000n);
  model.addPoolLiquidityAs(carol, carol, assetB, assetA, 4_000n, 2_000n);
  model.transfer(alice, assetA, carol, 100n);

  const owners = [alice, bob, carol];
  const assertSharesAndSupply = () => {
    const pool = model.pool(assetA, assetB);
    const sum = owners.reduce((total, provider) => total + (model.liquidityShares.get(model.shareKey(assetA, assetB, provider)) ?? 0n), 0n);
    assert.equal(sum, pool.totalShares);
    assert.ok(pool.reserve0 <= MAX_POOL_RESERVE && pool.reserve1 <= MAX_POOL_RESERVE);
    assert.equal(model.totalAccounted(assetA), initialA);
    assert.equal(model.totalAccounted(assetB), initialB);
    model.assertPoolInvariant(pool);
  };
  assertSharesAndSupply();
  const totalSharesBeforeSwap = model.pool(assetA, assetB).totalShares;
  const swapIn = 100n;
  model.swapExactInAs(carol, carol, assetA, assetB, swapIn, 0n);
  assert.equal(model.pool(assetA, assetB).totalShares, totalSharesBeforeSwap);
  assertSharesAndSupply();

  const bobShares = model.liquidityShares.get(model.shareKey(assetA, assetB, bob));
  model.removePoolLiquidityAs(bob, bob, assetA, assetB, bobShares / 2n);
  assertSharesAndSupply();
  for (const provider of owners) {
    const shares = model.liquidityShares.get(model.shareKey(assetA, assetB, provider)) ?? 0n;
    if (shares > 0n) model.removePoolLiquidityAs(provider, provider, assetA, assetB, shares);
    assertSharesAndSupply();
  }
  const empty = model.pool(assetA, assetB);
  assert.deepEqual([empty.reserve0, empty.reserve1, empty.totalShares], [0n, 0n, 0n]);
  model.transfer(alice, assetA, bob, 1n);
  model.transfer(alice, assetB, bob, 1n);
  model.addPoolLiquidityAs(bob, bob, assetA, assetB, 1n, 1n, 1n);
  assertSharesAndSupply();
});

test("failed remove and slippage actions leave reserves, shares, balances and index unchanged", () => {
  const model = fundedModel();
  model.createPoolAs(alice, alice, assetA, assetB, 100n, 200n);
  const bobShares = model.liquidityShares.get(model.shareKey(assetA, assetB, bob)) ?? 0n;
  const snapshot = () => ({
    pool: structuredClone(model.pool(assetA, assetB)),
    aliceA: model.balance(assetA, alice),
    aliceB: model.balance(assetB, alice),
    aliceShares: model.liquidityShares.get(model.shareKey(assetA, assetB, alice)),
    bobShares: model.liquidityShares.get(model.shareKey(assetA, assetB, bob)) ?? 0n,
    alicePositions: structuredClone(model.liquidityPositions.get(key(alice))),
    bobPositions: structuredClone(model.liquidityPositions.get(key(bob)) ?? []),
  });
  const before = snapshot();
  expectCode(6010, () => model.removePoolLiquidityAs(bob, bob, assetA, assetB, 1n));
  assert.deepEqual(snapshot(), before);
  const aliceShares = before.aliceShares;
  expectCode(6011, () => model.removePoolLiquidityAs(alice, alice, assetA, assetB, aliceShares, MAX_U128, 0n));
  assert.deepEqual(snapshot(), before);
  expectCode(6011, () => model.addPoolLiquidityAs(alice, alice, assetA, assetB, 10n, 20n, MAX_U128));
  assert.deepEqual(snapshot(), before);
  assert.equal(bobShares, 0n);
});

test("add uses proportional amounts, leaves excess untouched, and protects minimum shares atomically", () => {
  const model = fundedModel();
  model.createPoolAs(alice, alice, assetA, assetB, 100n, 1_000n);
  model.transfer(alice, assetA, bob, 50n);
  model.transfer(alice, assetB, bob, 1_000n);
  const beforePool = structuredClone(model.pool(assetA, assetB));
  const beforeA = model.balance(assetA, bob); const beforeB = model.balance(assetB, bob);
  expectCode(6011, () => model.addPoolLiquidityAs(bob, bob, assetA, assetB, 10n, 1_000n, 101n));
  assert.deepEqual(model.pool(assetA, assetB), beforePool);
  assert.equal(model.balance(assetA, bob), beforeA); assert.equal(model.balance(assetB, bob), beforeB);
  const result = model.addPoolLiquidityAs(bob, bob, assetA, assetB, 10n, 1_000n, 0n);
  assert.equal(result.usedA, 10n); assert.equal(result.usedB, 99n);
  assert.equal(model.balance(assetB, bob), beforeB - 99n);
  assert.equal(model.liquidityShares.get(model.shareKey(assetA, assetB, bob)), result.mintedShares);
});

test("swap changes reserves but not shares; fees remain in reserves; last LP exits exactly and pool can be reinitialized", () => {
  const model = fundedModel();
  model.createPoolAs(alice, alice, assetA, assetB, 100_000n, 200_000n);
  model.transfer(alice, assetA, bob, 1_000n);
  const poolBefore = structuredClone(model.pool(assetA, assetB));
  const totalBefore = poolBefore.totalShares;
  const swapOut = model.swapExactInAs(bob, bob, assetA, assetB, 100n, 0n);
  const afterSwap = model.pool(assetA, assetB);
  assert.equal(afterSwap.totalShares, totalBefore);
  assert.ok(afterSwap.reserve0 * afterSwap.reserve1 >= poolBefore.reserve0 * poolBefore.reserve1);
  const ownerShares = model.liquidityShares.get(model.shareKey(assetA, assetB, alice));
  const quote0 = afterSwap.reserve0; const quote1 = afterSwap.reserve1;
  model.removePoolLiquidityAs(alice, alice, assetA, assetB, ownerShares);
  const empty = model.pool(assetA, assetB);
  assert.equal(empty.reserve0, 0n); assert.equal(empty.reserve1, 0n); assert.equal(empty.totalShares, 0n);
  assert.equal(model.balance(assetB, alice), 2_000_000n - 200_000n + quote1);
  assert.ok(swapOut > 0n && quote0 > 0n);
  model.transfer(alice, assetA, bob, 1n);
  model.transfer(alice, assetB, bob, 1n);
  model.addPoolLiquidityAs(bob, bob, assetA, assetB, 1n, 1n, 1n);
  assert.equal(model.pool(assetA, assetB).totalShares, 1n);
  assert.equal(model.liquidityPositions.get(key(alice)).length, 1);
  assert.equal(model.liquidityPositions.get(key(bob)).length, 1);
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
  expectCode(6008, () => model.addPoolLiquidityAs(alice, alice, assetA, assetB, MAX_POOL_RESERVE, MAX_POOL_RESERVE));
  model.createAsset(alice, wide, new Uint8Array([67]), new Uint8Array([67]), 0, 0n);
  expectCode(6001, () => model.quoteExactIn(assetA, wide, 1n));
  expectCode(6004, () => quoteExactIn(100n, 100n, 0n));
  expectCode(6005, () => quoteExactIn(0n, 100n, 1n));
});

test("SDK quote, pool read and slippage helper use exact integer rules", async () => {
  const model = fundedModel();
  model.createPoolAs(alice, alice, assetA, assetB, 100_000n, 200_000n);
  const adapter = { ...lifecycleSupport,
    async submitOwnershipAction(actionName, input) {
      return { actionName, input, transactionId: "0x1", status: "queued", actionHash: "0x2" };
    },
    async queryBest(name, queryKey) { return { value: model.query(name, queryKey) }; },
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
  assert.deepEqual(abi.actions.find((action) => action.name === "createPool").input.map((field) => field.name), [
    "subject", "assetA", "assetB", "amountA", "amountB", "initialShares",
  ]);
  assert.deepEqual(abi.actions.find((action) => action.name === "addPoolLiquidity").input.map((field) => field.name), [
    "subject", "assetA", "assetB", "maxAmountA", "maxAmountB", "amountAUsed", "amountBUsed", "sharesMinted", "minShares", "initialShares",
  ]);
  assert.deepEqual(abi.actions.find((action) => action.name === "removePoolLiquidity").input.map((field) => field.name), [
    "subject", "assetA", "assetB", "shares", "amountAOut", "amountBOut", "minAmountA", "minAmountB",
  ]);
});

test("SDK supplies a quoted withdrawal for the division-free service action", async () => {
  const model = fundedModel();
  model.createPoolAs(alice, alice, assetA, assetB, 100_000n, 200_000n);
  const calls = [];
  const signer = { async getController() { return alice; }, async signJamScriptAction() { return new Uint8Array([1]); } };
  const adapter = { ...lifecycleSupport,
    async submitOwnershipAction(actionName, input) {
      calls.push({ actionName, input, payload: encodeActionPayload(abi, actionName, input) });
      return { transactionId: "0xremove", status: "queued", actionHash: "0xaction" };
    },
    async queryBest(name, queryKey) { return { value: model.query(name, queryKey) }; },
  };
  const locus = new LocusClient(adapter, { signer, subject: alice });
  await locus.removePoolLiquidity(assetB, assetA, 250n, 0n, 0n);
  assert.equal(calls[0].actionName, "removePoolLiquidity");
  assert.equal(calls[0].input.amountAOut, 353n);
  assert.equal(calls[0].input.amountBOut, 176n);
  assert.ok(calls[0].payload instanceof Uint8Array && calls[0].payload.length > 0);
});

test("SDK supplies client-computed initial shares in create and empty-pool initialize actions", async () => {
  const calls = [];
  const signer = { async getController() { return alice; }, async signJamScriptAction() { return new Uint8Array([1]); } };
  const adapter = { ...lifecycleSupport,
    async submitOwnershipAction(actionName, input) {
      calls.push({ actionName, input, payload: encodeActionPayload(abi, actionName, input) });
      return { transactionId: `0x${calls.length}`, status: "queued", actionHash: "0xaction" };
    },
    async queryBest(name) {
      return { value: name === "getPool" ? { version: 2, reserve0: 0n, reserve1: 0n, totalShares: 0n } : null };
    },
  };
  const locus = new LocusClient(adapter, { signer, subject: alice });
  await locus.createPool(assetA, assetB, 100n, 1_000n);
  await locus.addPoolLiquidity(assetA, assetB, 100n, 1_000n, 316n);
  assert.equal(calls[0].actionName, "createPool");
  assert.equal(calls[0].input.initialShares, 316n);
  assert.equal(calls[1].actionName, "addPoolLiquidity");
  assert.equal(calls[1].input.initialShares, 316n);
  assert.equal(calls[1].input.amountAUsed, 100n);
  assert.equal(calls[1].input.amountBUsed, 1_000n);
  assert.equal(calls[1].input.sharesMinted, 316n);
  assert.ok(calls.every((call) => call.payload instanceof Uint8Array && call.payload.length > 0));
});

test("permissionless liquidity math stays integer-only at u64/u128 boundaries", () => {
  assert.equal(integerSqrt(0n), 0n);
  assert.equal(integerSqrt(1n), 1n);
  assert.equal(integerSqrt(2n), 1n);
  assert.equal(integerSqrt(15n), 3n);
  assert.equal(integerSqrt(MAX_POOL_RESERVE * MAX_POOL_RESERVE), MAX_POOL_RESERVE);
  assert.equal(integerSqrt(MAX_U128), MAX_POOL_RESERVE);
  assert.equal(ceilDiv(0n, 7n), 0n);
  assert.equal(ceilDiv(15n, 7n), 3n);
  assert.equal(ceilDiv(MAX_U128, MAX_U128), 1n);
  assert.throws(() => ceilDiv(1n, 0n), /denominator/);

  const initial = quoteInitialLiquidity(100n, 1_000n);
  assert.equal(initial.sharesMinted, 316n);
  const add = quoteAddLiquidity(100n, 1_000n, 316n, 10n, 1_000n);
  assert.deepEqual(add, { maxAmount0: 10n, maxAmount1: 1_000n, amount0Used: 10n, amount1Used: 99n, sharesMinted: 31n });
  const remove = quoteRemoveLiquidity(110n, 1_099n, 347n, 31n, 15n);
  assert.deepEqual(remove, { sharesBurned: 15n, amount0: 4n, amount1: 47n });
  const last = quoteRemoveLiquidity(110n, 1_099n, 347n, 347n, 347n);
  assert.deepEqual(last, { sharesBurned: 347n, amount0: 110n, amount1: 1_099n });
  assert.equal(formatLiquiditySharePercentage(1n, 1_000_000n), "<0.01%");
  assert.equal(formatLiquiditySharePercentage(1242n, 10_000n), "12.42%");
  assert.throws(() => quoteInitialLiquidity(MAX_POOL_RESERVE, MAX_POOL_RESERVE + 1n), /reserve limit/);
  assert.throws(() => quoteAddLiquidity(100n, 1_000n, 316n, 10n, 0n), /greater than zero/);
  assert.throws(() => quoteRemoveLiquidity(100n, 1_000n, 316n, 10n, 11n), /insufficient/);
});

test("SDK treats never-written asset and pool counts as zero on a fresh Service", async () => {
  const adapter = { ...lifecycleSupport,
    async queryBest() { return { value: null }; },
    async submitOwnershipAction() { throw new Error("unexpected submission"); },
  };
  const locus = new LocusClient(adapter, null);
  assert.deepEqual(await locus.listAssets(), []);
  assert.deepEqual(await locus.listPools(), []);
});

test("SDK hydrates V2 pool key fields from the query key", async () => {
  const canonical = { asset0: assetA, asset1: assetB };
  const value = {
    version: 2,
    reserve0: 123n,
    reserve1: 456n,
    totalShares: 236n,
  };
  const adapter = { ...lifecycleSupport,
    async queryBest(queryName) {
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
  assert.equal(pool.totalShares, 236n);
  assert.deepEqual(await locus.listPools(), [pool]);
});

test("SDK pool listing is bounded and supports an explicit page offset", async () => {
  const keys = [assetA, assetB, id(33), id(44)].slice(1).map((asset, index, all) => ({
    asset0: assetA,
    asset1: asset,
  }));
  const adapter = { ...lifecycleSupport,
    async queryBest(name, queryKey) {
      if (name === "getPoolCount") return { value: BigInt(keys.length) };
      if (name === "getPoolByIndex") return { value: keys[Number(queryKey)] };
      if (name === "getPool") return { value: { version: 2, reserve0: 10n, reserve1: 20n, totalShares: 14n } };
      throw new Error(`unexpected query ${name}`);
    },
    async submitOwnershipAction() { throw new Error("unexpected submission"); },
  };
  const locus = new LocusClient(adapter, null);
  const page = await locus.listPools({ offset: 1n, limit: 1 });
  assert.equal(page.length, 1);
  assert.deepEqual(page[0].asset1, id(33));
  await assert.rejects(() => locus.listPools({ offset: 0n, limit: 101 }), /limit must be/);
  await assert.rejects(() => locus.listPools({ offset: 4n }), /offset is outside/);
});

test("SDK lists only an Ownership's active indexed liquidity positions", async () => {
  const model = fundedModel();
  model.createPoolAs(alice, alice, assetA, assetB, 100_000n, 200_000n);
  model.transfer(alice, assetA, bob, 1_000n);
  model.transfer(alice, assetB, bob, 2_000n);
  model.addPoolLiquidityAs(bob, bob, assetA, assetB, 1_000n, 2_000n, 1_000n);
  const adapter = { ...lifecycleSupport,
    async queryBest(name, queryKey) { return { value: model.query(name, queryKey) }; },
    async submitOwnershipAction() { throw new Error("unexpected submission"); },
  };
  const locus = new LocusClient(adapter, null);
  assert.equal(await locus.liquidityPositionCount(alice), 1n);
  assert.equal(await locus.liquidityPositionCount(bob), 1n);
  const alicePositions = await locus.listLiquidityPositions(alice, { limit: 1 });
  const bobPositions = await locus.listLiquidityPositions(bob, { offset: 0n, limit: 1 });
  assert.equal(alicePositions.length, 1);
  assert.equal(bobPositions.length, 1);
  assert.equal(alicePositions[0].shares, 141_421n);
  assert.equal(bobPositions[0].shares, 1_414n);
  assert.deepEqual(await locus.listLiquidityPositions(alice, { offset: 1n }), []);
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
