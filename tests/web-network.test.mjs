import assert from "node:assert/strict";
import fs from "node:fs/promises";
import test from "node:test";
import { formatUnits, parseUnits, evmOwnership, polkadotOwnership, solanaOwnership, formatLocusId, parseLocusId } from "../dist/sdk/index.js";
import { encodeAddress } from "@polkadot/util-crypto";
import { selectNetwork } from "../web/src/network/selection.ts";

test("network selection prefers URL, then storage, env, config, and local", () => {
  assert.equal(selectNetwork("testnet", "local", "local", "local"), "testnet");
  assert.equal(selectNetwork(null, "testnet", "local", "local"), "testnet");
  assert.equal(selectNetwork(null, null, "testnet", "local"), "testnet");
  assert.equal(selectNetwork(null, null, null, "testnet"), "testnet");
  assert.equal(selectNetwork("invalid", "invalid", "invalid", "local"), "local");
});

test("network deployment does not silently configure Testnet as Local", async () => {
  const config = JSON.parse(await fs.readFile(new URL("../web/public/locus-networks.json", import.meta.url), "utf8"));
  assert.equal(config.networks.local.backendUrl, "http://127.0.0.1:8090");
  assert.equal(config.networks.testnet.backendUrl, null);
  assert.equal(config.networks.testnet.deploymentUrl, null);
});

test("network recipient resolution uses canonical ownership decoders", () => {
  assert.equal(evmOwnership("0x0000000000000000000000000000000000000001").public.length, 20);
  assert.throws(() => evmOwnership("0x1234"));
  assert.equal(polkadotOwnership(encodeAddress(new Uint8Array(32).fill(1))).public.length, 32);
  assert.throws(() => polkadotOwnership("not-an-address"));
  assert.equal(solanaOwnership("11111111111111111111111111111111").public.length, 32);
  assert.throws(() => solanaOwnership("not-a-solana-address"));
});

test("Locus IDs round-trip the canonical Ownership encoding", () => {
  const owner = evmOwnership("0x0000000000000000000000000000000000000001");
  const locusId = formatLocusId(owner);
  const decoded = parseLocusId(locusId);
  assert.equal(locusId.startsWith("locus:"), true);
  assert.deepEqual(decoded, owner);
  assert.throws(() => parseLocusId("locus:not-valid"));
});

test("network amounts remain exact bigint values", () => {
  assert.equal(parseUnits("12.345", 3), 12345n);
  assert.equal(formatUnits(12345n, 3), "12.345");
  assert.throws(() => parseUnits("1e3", 0));
  assert.throws(() => parseUnits("1.234", 2));
});
