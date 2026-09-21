import assert from "node:assert/strict";
import fs from "node:fs/promises";
import test from "node:test";
import { formatUnits, parseUnits, evmOwnership, polkadotOwnership, solanaOwnership, formatLocusId, parseLocusId } from "../dist/sdk/index.js";
import { encodeAddress } from "@polkadot/util-crypto";
import { selectNetwork } from "../web/src/network/selection.ts";
import { queryMatrixKeys } from "../web/src/matrix/MatrixKeysQuery.ts";

function matrixB64(bytes) {
  return Buffer.from(bytes).toString("base64url");
}

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

test("Matrix pending-device lookup reuses the same device ID until cross-signing appears", async () => {
  const userId = "@alice:example.org";
  const deviceId = "LOCUS-TEST";
  const master = new Uint8Array(32).fill(1);
  const selfSigning = new Uint8Array(32).fill(2);
  const curve = new Uint8Array(32).fill(3);
  const device = new Uint8Array(32).fill(4);
  const signature = new Uint8Array(64).fill(5);
  let verified = false;
  const fetchImpl = async () => ({
    ok: true,
    async text() {
      return JSON.stringify({
        master_keys: { [userId]: { keys: { "ed25519:MASTER": matrixB64(master) } } },
        self_signing_keys: { [userId]: { keys: { "ed25519:SELF": matrixB64(selfSigning) }, signatures: { [userId]: { "ed25519:MASTER": matrixB64(signature) } } } },
        device_keys: { [userId]: { [deviceId]: { algorithms: ["m.olm.v1.curve25519-aes-sha2"], keys: { [`curve25519:${deviceId}`]: matrixB64(curve), [`ed25519:${deviceId}`]: matrixB64(device) }, signatures: verified ? { [userId]: { "ed25519:SELF": matrixB64(signature) } } : {} } } },
      });
    },
  });
  const pending = await queryMatrixKeys(userId, deviceId, "https://example.org", "token", fetchImpl);
  assert.equal(pending.verification, "pending");
  assert.equal(pending.deviceId, deviceId);
  verified = true;
  const ready = await queryMatrixKeys(userId, deviceId, "https://example.org", "token", fetchImpl);
  assert.equal(ready.verification, "verified");
  assert.equal(ready.deviceId, deviceId);
  assert.deepEqual(ready.masterPublicKey, master);
});
