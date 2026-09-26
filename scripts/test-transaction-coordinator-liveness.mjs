import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  FetchRpcTransport,
  JamScriptClient,
  OWNERSHIP_KIND,
  asWorkRpc,
} from "@jamscript/client";
import {
  cryptoWaitReady,
  sr25519PairFromSeed,
  sr25519Sign,
} from "@polkadot/util-crypto";
import { LocusClient } from "../dist/sdk/index.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const expectedGenesis = "0xe8fdc80f81a93509206c712d1f6363e8df0672ec5425ebb54c90c4988a661e67";
const deployment = JSON.parse(
  await fs.readFile(path.join(root, "web/public/deployments/local.json"), "utf8"),
);
const catalog = JSON.parse(
  await fs.readFile(path.join(root, "web/public/catalogs/local.json"), "utf8"),
);
const backendUrl = process.env.LOCUS_E2E_BACKEND_RPC ?? "http://127.0.0.1:8090";
const mini = catalog.assets.find((asset) => asset.key === "mini");

assert.equal(deployment.network, "local", "liveness test is restricted to Local");
assert.equal(deployment.genesisHash, expectedGenesis, "unexpected chain genesis");
assert.ok(Number.isSafeInteger(deployment.serviceId), "deployment must reference a concrete Locus Service");
assert.equal(catalog.network, "local");
assert.equal(catalog.genesisHash, expectedGenesis);
assert.equal(catalog.serviceId, deployment.serviceId);
assert.ok(mini, "MINI must be present in the Local curated catalog");

await cryptoWaitReady();
const transport = new FetchRpcTransport(backendUrl);
const protocolClient = new JamScriptClient(deployment, transport);
const workRpc = asWorkRpc(transport);
await protocolClient.validateDeployment();

function signerFor(seedByte) {
  const seed = new Uint8Array(32).fill(seedByte);
  const pair = sr25519PairFromSeed(seed);
  const controller = {
    version: 1,
    kind: OWNERSHIP_KIND.SR25519_KEY,
    public: pair.publicKey,
  };
  return {
    controller,
    async getController() {
      return controller;
    },
    async signJamScriptAction(request) {
      return sr25519Sign(request.message, pair);
    },
  };
}

function sessionFor(signer) {
  return { signer, subject: signer.controller };
}

function bytes32(hex) {
  assert.match(hex, /^0x[0-9a-f]{64}$/i);
  return Uint8Array.from(Buffer.from(hex.slice(2), "hex"));
}

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitForSlotAdvance(startSlot, minimumAdvance = 8, timeoutMs = 180_000) {
  const deadline = Date.now() + timeoutMs;
  let latest = await workRpc.finalizedContext();
  while (latest.slot < startSlot + minimumAdvance) {
    if (Date.now() >= deadline) {
      throw new Error(
        `finalized slot did not advance enough: start=${startSlot}, current=${latest.slot}`,
      );
    }
    await delay(500);
    latest = await workRpc.finalizedContext();
  }
  return latest;
}

async function waitForServiceSequenceAfter(sequence, timeoutMs = 180_000) {
  const deadline = Date.now() + timeoutMs;
  let status = await transport.call("jamscript_getServiceStateStatusV1", {
    serviceId: deployment.serviceId,
  });
  while (status.sequence <= sequence) {
    if (Date.now() >= deadline) {
      throw new Error(`Service sequence did not advance beyond ${sequence}`);
    }
    await delay(1_000);
    status = await transport.call("jamscript_getServiceStateStatusV1", {
      serviceId: deployment.serviceId,
    });
  }
  return status;
}

const firstSigner = signerFor(0xf1);
const secondSigner = signerFor(0xf2);
const first = new LocusClient(protocolClient, sessionFor(firstSigner));
const second = new LocusClient(protocolClient, sessionFor(secondSigner));
const assetId = bytes32(mini.assetId);

const stateBeforeA = await transport.call("jamscript_getServiceStateStatusV1", {
  serviceId: deployment.serviceId,
});
const beforeA = await workRpc.finalizedContext();
const actionA = await first.transfer(assetId, firstSigner.controller, 0n);
console.log(`ACTION_A=${actionA.transactionId}`);
console.log(`ACTION_A_SUBMITTED_SLOT=${beforeA.slot}`);

// Deliberately do not call transactionStatus()/waitForAction(A). The chain
// advances while the backend coordinator must discover A's terminal state.
await waitForSlotAdvance(beforeA.slot);
const stateAfterA = await waitForServiceSequenceAfter(stateBeforeA.sequence);
const beforeB = await workRpc.finalizedContext();
const actionB = await second.transfer(assetId, secondSigner.controller, 0n);
console.log(`ACTION_B=${actionB.transactionId}`);
console.log(`ACTION_B_SUBMITTED_SLOT=${beforeB.slot}`);

const resultB = await protocolClient.waitForAction(actionB.transactionId, {
  intervalMs: 500,
  timeoutMs: 180_000,
});
assert.equal(
  resultB.actionReceipt.status,
  "applied",
  `action B did not apply: ${JSON.stringify(resultB.actionReceipt)}`,
);

console.log("ACTION_A_STATUS_POLL=NONE");
console.log(`ACTION_A_MATERIALIZED_SEQUENCE=${stateBeforeA.sequence}->${stateAfterA.sequence}`);
console.log("ACTION_B=APPLIED");
console.log("LIVENESS_TEST_NO_STATUS_POLLING=PASS");
