import assert from "node:assert/strict";
import test from "node:test";
import { LocusModel, id, owner } from "./locus-model.mjs";

function rng(seed) {
  let value = seed >>> 0;
  return () => {
    value ^= value << 13;
    value ^= value >>> 17;
    value ^= value << 5;
    return value >>> 0;
  };
}

test("deterministic ownership state machine preserves ledger invariants", () => {
  const model = new LocusModel();
  const owners = [owner(41), owner(42), owner(43), owner(44)];
  const assets = [id(10), id(11), id(12)];
  for (const assetId of assets) model.createAsset(owners[0], assetId, new Uint8Array([65]), new Uint8Array([65]), 0, 1000n);

  const next = rng(0x51c0de01);
  for (let step = 0; step < 500; step += 1) {
    const source = owners[next() % owners.length];
    const destination = owners[next() % owners.length];
    const assetId = assets[next() % assets.length];
    const operation = next() % 5;
    if (operation === 0) {
      const available = model.balance(assetId, source);
      const value = available === 0n ? 0n : BigInt(next()) % (available + 1n);
      model.transfer(source, assetId, destination, value);
    } else if (operation === 1) {
      model.mint(owners[0], assetId, destination, BigInt(next() % 51));
    } else if (operation === 2) {
      const available = model.balance(assetId, source);
      const value = available === 0n ? 0n : BigInt(next()) % (available + 1n);
      model.burn(source, assetId, value);
    } else if (operation === 3) {
      model.approve(source, assetId, destination, BigInt(next() % 201));
    } else {
      const spender = source;
      const from = destination;
      const allowed = model.allowance(assetId, from, spender);
      const available = model.balance(assetId, from);
      const maximum = allowed < available ? allowed : available;
      const value = maximum === 0n ? 0n : BigInt(next()) % (maximum + 1n);
      model.transferFrom(spender, assetId, from, source, value);
    }
  }

  for (const assetId of assets) assert.equal(model.totalBalance(assetId), model.asset(assetId).totalSupply);
});
