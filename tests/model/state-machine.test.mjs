import assert from "node:assert/strict";
import test from "node:test";
import { LocusModel, id } from "./locus-model.mjs";

function rng(seed) {
  let value = seed >>> 0;
  return () => {
    value ^= value << 13;
    value ^= value >>> 17;
    value ^= value << 5;
    return value >>> 0;
  };
}

test("deterministic 500-operation state machine preserves ledger invariants", () => {
  const model = new LocusModel();
  const identities = [id(1), id(2), id(3), id(4)];
  const owners = [id(41), id(42), id(43), id(44)];
  const assets = [id(10), id(11), id(12)];
  for (let index = 0; index < identities.length; index += 1) {
    model.createIdentity(identities[index], owners[index]);
  }
  for (const assetId of assets) {
    const nonce = model.identity(identities[0]).nonce;
    model.createAsset(identities[0], nonce, assetId, new Uint8Array([65]), new Uint8Array([65]), 0, 1000n, model.identity(identities[0]).owner);
  }

  const next = rng(0x51c0de01);
  for (let step = 0; step < 500; step += 1) {
    const sourceIndex = next() % identities.length;
    const destinationIndex = next() % identities.length;
    const assetIndex = next() % assets.length;
    const source = identities[sourceIndex];
    const destination = identities[destinationIndex];
    const assetId = assets[assetIndex];
    const operation = next() % 5;
    const sender = model.identity(source).owner;
    const nonce = model.identity(source).nonce;

    if (operation === 0) {
      const available = model.balance(assetId, source);
      const value = available === 0n ? 0n : BigInt(next()) % (available + 1n);
      model.transfer(source, nonce, assetId, destination, value, sender);
    } else if (operation === 1) {
      const issuer = identities[0];
      const issuerNonce = model.identity(issuer).nonce;
      const issuerOwner = model.identity(issuer).owner;
      model.mint(issuer, issuerNonce, assetId, destination, BigInt(next() % 51), issuerOwner);
    } else if (operation === 2) {
      const available = model.balance(assetId, source);
      const value = available === 0n ? 0n : BigInt(next()) % (available + 1n);
      model.burn(source, nonce, assetId, value, sender);
    } else if (operation === 3) {
      model.approve(source, nonce, assetId, destination, BigInt(next() % 201), sender);
    } else {
      const spender = source;
      const owner = destination;
      const spenderNonce = model.identity(spender).nonce;
      const spenderOwner = model.identity(spender).owner;
      const allowed = model.allowance(assetId, owner, spender);
      const available = model.balance(assetId, owner);
      const maximum = allowed < available ? allowed : available;
      const value = maximum === 0n ? 0n : BigInt(next()) % (maximum + 1n);
      model.transferFrom(spender, spenderNonce, assetId, owner, source, value, spenderOwner);
    }

    if (step % 17 === 0) {
      const rotateIndex = next() % identities.length;
      const rotated = identities[rotateIndex];
      const rotatedIdentity = model.identity(rotated);
      const nextOwner = id(100 + (step % 100));
      if (nextOwner.every((byte, index) => byte === rotatedIdentity.owner[index])) nextOwner[0] += 1;
      model.rotateOwner(rotated, rotatedIdentity.nonce, nextOwner, rotatedIdentity.owner);
    }
  }

  for (const assetId of assets) {
    assert.equal(model.totalBalance(assetId), model.asset(assetId).totalSupply);
    for (const identityId of identities) {
      assert.ok(model.balance(assetId, identityId) >= 0n);
    }
  }
});
