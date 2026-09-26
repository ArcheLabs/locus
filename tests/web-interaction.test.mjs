import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  EvmOwnershipSigner,
  PolkadotOwnershipSigner,
  SolanaOwnershipSigner,
} from "@jamscript/client";
import { SolanaSignMessage } from "@solana/wallet-standard-features";
import {
  CREATE_ASSET_PENDING_STORAGE_KEY,
  DuplicateCreateAssetSubmissionError,
  OperationTimeoutError,
  PreparationTimeoutError,
  WalletSignatureTimeoutError,
  readCreateAssetPendings,
  resumeCreateAssetFinalization,
  submitCreateAssetOnce,
  waitForWalletSignature,
  withPreparationTimeout,
  withOperationTimeout,
} from "../web/src/locus/createAssetWorkflow.ts";

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
  assert.match(matrixDialogSource, /Switch to Element on this phone/);
  assert.match(matrixDialogSource, /Sessions or Security/);
  assert.match(matrixDialogSource, /find the Locus session/);
  assert.match(matrixDialogSource, /accept the incoming SAS request/);
  assert.match(matrixDialogSource, /requestOwnUserVerification\(\)/);
  assert.match(matrixDialogSource, /Retry request delivery/);
  assert.match(matrixConnectorSource, /if \(keys\.verification !== "verified"\) \{\s*void connected\.requestOwnUserVerification\(\)/);
  assert.match(matrixDialogSource, /verification\.startedByLocus/);
  assert.match(matrixDialogSource, /pendingConnection!\.stored\.deviceId/);
  assert.match(matrixDialogSource, /Copy device ID/);
  assert.match(matrixDialogSource, /navigator\.clipboard\.writeText\(deviceId\)/);
  assert.match(matrixDialogSource, /Element is a trusted second Matrix device; it is separate from signing in to Locus/);
  assert.match(matrixDialogSource, /matrix-device-id--troubleshooting/);
  assert.doesNotMatch(matrixDialogSource, /elementMobileLaunchUrl|mobile\.element\.io|hs_url|element:\/\//);
  assert.match(readFileSync(new URL("../web/src/matrix/MatrixCryptoDevice.ts", import.meta.url), "utf8"), /OwnUserIdentity[\s\S]*?requestVerification\(\[VerificationMethod\.SasV1\]\)/);
  assert.match(readFileSync(new URL("../web/src/matrix/MatrixCryptoDevice.ts", import.meta.url), "utf8"), /request\.weStarted\(\).*?request\.phase\(\) === VerificationRequestPhase\.Ready/s);
  assert.match(responsive, /\.matrix-device-id \.secondary \{ width: 100%;/);
});

function memoryStorage() {
  const entries = new Map();
  return {
    getItem: (key) => entries.get(key) ?? null,
    setItem: (key, value) => entries.set(key, String(value)),
    removeItem: (key) => entries.delete(key),
  };
}

function createVisibilitySource(initiallyHidden = false) {
  let hidden = initiallyHidden;
  const listeners = new Set();
  return {
    isHidden: () => hidden,
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    setHidden(value) { hidden = value; for (const listener of listeners) listener(value); },
  };
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function pendingCreateAssetRecord(key = "local:797069104:owner:asset") {
  return {
    version: 1,
    key,
    assetId: `0x${"11".repeat(32)}`,
    name: "Asset",
    symbol: "AST",
    decimals: 6,
    initialSupply: "10",
    state: "submission-unknown",
    actionHash: `0x${"22".repeat(32)}`,
    updatedAt: Date.now(),
  };
}

test("Create Asset wallet signature can resolve and a rejected signature stays a wallet failure", async () => {
  assert.equal(CREATE_ASSET_PENDING_STORAGE_KEY, "locus.create-asset.pending.v1");
  const signature = Promise.resolve("signed");
  assert.equal(await waitForWalletSignature(signature, 100), "signed");
  await assert.rejects(waitForWalletSignature(Promise.reject(new Error("user rejected")), 100), /user rejected/);
});

test("wallet signature timeout is bounded, pauses while hidden, and accepts a late return signature", async () => {
  const never = new Promise(() => {});
  await assert.rejects(waitForWalletSignature(never, 15), WalletSignatureTimeoutError);

  const visibility = createVisibilitySource();
  const returnedSignature = deferred();
  const waiting = waitForWalletSignature(returnedSignature.promise, 30, visibility);
  await new Promise((resolve) => setTimeout(resolve, 10));
  visibility.setHidden(true);
  await new Promise((resolve) => setTimeout(resolve, 45));
  visibility.setHidden(false);
  await new Promise((resolve) => setTimeout(resolve, 5));
  returnedSignature.resolve("signed-after-return");
  assert.equal(await waiting, "signed-after-return");
});

test("create submission timeout keeps one no-ID recovery record and rejects duplicate submission", async () => {
  const storage = memoryStorage();
  const deferredSubmission = deferred();
  const record = pendingCreateAssetRecord();
  let submitCount = 0;
  const submission = submitCreateAssetOnce(record, storage, () => { submitCount += 1; return deferredSubmission.promise; });
  await assert.rejects(withOperationTimeout(submission, "submission", 15), OperationTimeoutError);
  const unresolved = readCreateAssetPendings(storage)[0];
  assert.equal(unresolved.state, "submission-unknown");
  assert.equal(unresolved.transactionId, undefined);
  assert.equal(submitCount, 1);
  await assert.rejects(submitCreateAssetOnce(record, storage, async () => { submitCount += 1; return { transactionId: "duplicate", actionHash: record.actionHash }; }), DuplicateCreateAssetSubmissionError);
  assert.equal(submitCount, 1);
  deferredSubmission.resolve({ transactionId: "tx-123", actionHash: record.actionHash });
  await submission;
  assert.equal(readCreateAssetPendings(storage)[0].state, "submitted");
});

test("a saved transaction ID survives reload and finalization resumes the same transaction", async () => {
  const storage = memoryStorage();
  const record = pendingCreateAssetRecord();
  let submitted = 0;
  await submitCreateAssetOnce(record, storage, async () => {
    submitted += 1;
    return { transactionId: "tx-resume", actionHash: record.actionHash };
  });

  // A new page instance reads the durable record and resumes polling by the
  // returned transaction ID/action hash pair instead of creating another one.
  const afterReload = readCreateAssetPendings(storage)[0];
  assert.equal(afterReload.transactionId, "tx-resume");
  assert.equal(afterReload.actionHash, record.actionHash);
  const polled = [];
  const outcome = await resumeCreateAssetFinalization(afterReload, async (transactionId, actionHash) => {
    polled.push({ transactionId, actionHash });
    return "applied";
  }, 100);
  assert.equal(outcome, "applied");
  assert.deepEqual(polled, [{ transactionId: "tx-resume", actionHash: record.actionHash }]);
  assert.equal(submitted, 1);
  await assert.rejects(resumeCreateAssetFinalization(record, async () => "wrong", 10), /transaction ID and action hash/);
  await assert.rejects(
    resumeCreateAssetFinalization(afterReload, async () => new Promise(() => {}), 15),
    (error) => error instanceof OperationTimeoutError && error.stage === "finalization",
  );
});

test("create-asset UI prepares before the signature gesture and exposes every action stage", () => {
  const source = readFileSync(new URL("../web/src/locus/dialogs.tsx", import.meta.url), "utf8");
  for (const state of ["EDITING", "PREPARING", "AWAITING_WALLET", "SIGNED", "SUBMITTING", "SUBMITTED", "FINALIZING", "APPLIED", "FAILED"]) {
    assert.ok(source.includes(`case "${state}"`), `missing ${state} stage`);
  }
  assert.match(source, /CREATE_ASSET_PREPARATION_TIMEOUT_MS = 45_000/);
  assert.match(source, /Complete asset details/);
  assert.match(source, /Preparation timed out\. No signature was requested and no transaction was submitted/);
  assert.match(source, /locus\.signPreparedOwnershipAction\(preparedAction\)/);
  assert.match(source, /locus\.abandonPreparedOwnershipAction\(preparedAction\)/);
  assert.match(source, /resumeCreateAssetFinalization/);
  assert.match(source, /submitCreateAssetOnce/);
  assert.doesNotMatch(source, /onClick=\{signAndCreate\}.*Retry preparation/);
});

test("create-asset preparation timeout is bounded and abandons a late unsigned action", async () => {
  const stalledPreparation = deferred();
  const abandoned = [];
  await assert.rejects(
    withPreparationTimeout(stalledPreparation.promise, 15, (prepared) => abandoned.push(prepared)),
    PreparationTimeoutError,
  );
  const latePreparedAction = { actionName: "createAsset" };
  stalledPreparation.resolve(latePreparedAction);
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.deepEqual(abandoned, [latePreparedAction]);
});
