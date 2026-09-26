import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  EvmOwnershipSigner,
  PolkadotOwnershipSigner,
  SolanaOwnershipSigner,
} from "@jamscript/client";
import { SolanaSignMessage } from "@solana/wallet-standard-features";

const matrixConnectorSource = readFileSync(new URL("../web/src/matrix/MatrixConnector.ts", import.meta.url), "utf8");
const matrixDialogSource = readFileSync(new URL("../web/src/matrix/MatrixLoginDialog.tsx", import.meta.url), "utf8");

const actionRequest = {
  version: 2,
  networkDomain: new Uint8Array(32).fill(1),
  serviceKey: new Uint8Array(32).fill(2),
  actionSelector: new Uint8Array(8).fill(3),
  controller: { version: 1, kind: 0, public: new Uint8Array(32).fill(4) },
  actAs: null,
  nonce: 0n,
  validUntil: 100n,
  payloadHash: new Uint8Array(32).fill(5),
  payload: new Uint8Array([6, 7]),
  message: new TextEncoder().encode("JAMSCRIPT_ACTION_V2:test"),
};

test("mock EVM provider signs the canonical Ownership request", async () => {
  let called = false;
  const signer = new EvmOwnershipSigner({ request: async ({ method }) => { called = method === "eth_signTypedData_v4"; return `0x${"11".repeat(64)}1b`; } }, "0x0000000000000000000000000000000000000001");
  assert.equal((await signer.signJamScriptAction(actionRequest)).length, 65);
  assert.equal(called, true);
});

test("mock Polkadot extension preserves every declared signature scheme", async () => {
  for (const [scheme, size] of [["ed25519", 64], ["sr25519", 64], ["ecdsa", 65]]) {
    const signer = new PolkadotOwnershipSigner({ accountId: new Uint8Array(32).fill(8), address: "5Mock", scheme, signer: { signRaw: async () => ({ signature: `0x${"22".repeat(size)}` }) } });
    const signature = await signer.signJamScriptAction(actionRequest);
    assert.equal(signature.length, size + 1);
    assert.equal(signature[0], scheme === "ed25519" ? 0 : scheme === "sr25519" ? 1 : 2);
  }
});

test("mock Wallet Standard Solana signer returns ED25519 Ownership", async () => {
  const account = { address: "11111111111111111111111111111111", publicKey: new Uint8Array(32).fill(9), chains: ["solana:mainnet"], features: [], label: "Mock" };
  const feature = { [SolanaSignMessage]: { signMessage: async ({ message }) => [{ signedMessage: message, signature: new Uint8Array(64).fill(10), signatureType: "ed25519" }] } };
  const signer = new SolanaOwnershipSigner(account, feature);
  assert.equal((await signer.getController()).public.length, 32);
  assert.equal((await signer.signJamScriptAction(actionRequest)).length, 64);
});

test("Matrix bootstrap restoration checks the saved transaction before permitting a replacement", () => {
  const restorePending = matrixConnectorSource.indexOf("const pendingRecord = pendingMatrixBootstrapFor(");
  const freshSubmission = matrixConnectorSource.indexOf("const submitted = await scoped.bootstrapMatrixController(proof);");
  assert.ok(restorePending >= 0 && freshSubmission > restorePending);
  assert.match(matrixConnectorSource, /if \(pendingRecord\) \{[\s\S]*?await settlePending\(pendingRecord\)/);
  assert.match(matrixConnectorSource, /if \(cause instanceof MatrixBootstrapWaitTimeout\) return false;/);
  assert.match(matrixConnectorSource, /validUntil: submittedWithValidity\.validUntil \?\? submittedSlot \+ 64/);
  assert.doesNotMatch(matrixConnectorSource, /catch \(cause\) \{\s*if \(cause instanceof TransactionWaitTimeoutError\) \{\s*removePendingMatrixBootstrap/);
  assert.match(matrixDialogSource, /Check authorization status/);
  assert.match(matrixDialogSource, /do not repeat Matrix verification/);
});

test("mobile Matrix verification clearly separates sign-in from Element SAS and exposes the Locus device ID", async () => {
  const responsive = readFileSync(new URL("../web/src/styles/responsive.css", import.meta.url), "utf8");
  assert.match(matrixDialogSource, /connectionState === "VERIFICATION_REQUIRED"/);
  assert.match(matrixDialogSource, /Open Element\./);
  assert.match(matrixDialogSource, /Sessions/);
  assert.match(matrixDialogSource, /Security/);
  assert.match(matrixDialogSource, /Find the device named <strong>Locus<\/strong>/);
  assert.match(matrixDialogSource, /pendingConnection!\.stored\.deviceId/);
  assert.match(matrixDialogSource, /Copy device ID/);
  assert.match(matrixDialogSource, /navigator\.clipboard\.writeText\(deviceId\)/);
  assert.match(matrixDialogSource, /trusted second Matrix device for verification; it is not the sign-in method/);
  assert.match(matrixDialogSource, /https:\/\/mobile\.element\.io\//);
  assert.match(matrixDialogSource, /searchParams\.set\("hs_url", homeserver\)/);
  assert.match(matrixDialogSource, /does not jump to the Locus verification request/);
  assert.match(responsive, /\.matrix-device-id \.secondary \{ width: 100%;/);
  assert.doesNotMatch(matrixDialogSource, /element:\/\//);
});
