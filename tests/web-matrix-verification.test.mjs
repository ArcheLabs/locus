import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  createMatrixDeviceTrustMonitor,
  evaluateMatrixDeviceTrust,
  matrixMasterPublicKeyFromSdk,
  MATRIX_TRUST_POLL_INTERVAL_MS,
} from "../web/src/matrix/MatrixDeviceTrust.ts";
import { matrixControllerReceiptFailure, MatrixConnectorError } from "../web/src/matrix/MatrixErrors.ts";
import { classifyMatrixProofFailure, retryMatrixProofPreparation } from "../web/src/matrix/MatrixProofRetry.ts";

class FakeEventTarget {
  constructor() { this.listeners = new Map(); }
  addEventListener(type, listener) {
    const listeners = this.listeners.get(type) ?? new Set();
    listeners.add(listener);
    this.listeners.set(type, listeners);
  }
  removeEventListener(type, listener) { this.listeners.get(type)?.delete(listener); }
  emit(type) { for (const listener of this.listeners.get(type) ?? []) listener(); }
  count(type) { return this.listeners.get(type)?.size ?? 0; }
}

const verifiedSignals = {
  identityAvailable: true,
  deviceAvailable: true,
  identityChanged: false,
  deviceRevoked: false,
  masterKeyAvailable: true,
  deviceKeyAvailable: true,
  masterKeyMatches: true,
  deviceKeyMatches: true,
  identityVerified: true,
  identityTrustsOwnDevice: true,
  deviceCrossSignedByOwner: true,
  deviceCrossSigningTrusted: true,
};

const matrixUserId = "@alice:example.org";
const masterPublicKey = Buffer.alloc(32, 255).toString("base64").replace(/=+$/, "");
const sdkMasterKey = (publicKey = masterPublicKey) => JSON.stringify({
  user_id: matrixUserId,
  usage: ["master"],
  keys: { [`ed25519:${publicKey}`]: publicKey },
  signatures: { [matrixUserId]: { "ed25519:DEVICE": "signature" } },
});

test("SDK master-key JSON is decoded before identity comparison", () => {
  const serialized = sdkMasterKey();
  assert.notEqual(serialized, masterPublicKey, "the old comparison rejects every SDK identity");
  const extracted = matrixMasterPublicKeyFromSdk(serialized, matrixUserId);
  assert.equal(extracted, masterPublicKey);
  assert.equal(evaluateMatrixDeviceTrust({ ...verifiedSignals, masterKeyMatches: extracted === masterPublicKey }).state, "VERIFIED");
  assert.equal(evaluateMatrixDeviceTrust({ ...verifiedSignals, identityVerified: false, deviceCrossSigningTrusted: false, masterKeyMatches: extracted === masterPublicKey }).state, "VERIFIED");
  const changedKey = Buffer.alloc(32, 1).toString("base64").replace(/=+$/, "");
  const changed = matrixMasterPublicKeyFromSdk(sdkMasterKey(changedKey), matrixUserId);
  assert.equal(evaluateMatrixDeviceTrust({ ...verifiedSignals, masterKeyMatches: changed === masterPublicKey }).state, "IDENTITY_CHANGED");
});

test("SDK master-key extraction rejects unavailable or invalid data without inventing an identity change", () => {
  for (const serialized of ["", "not-json", masterPublicKey, "null", "[]", "{}",
    JSON.stringify({ user_id: "@other:example.org", usage: ["master"], keys: { "ed25519:key": masterPublicKey } }),
    JSON.stringify({ user_id: matrixUserId, usage: ["self_signing"], keys: { "ed25519:key": masterPublicKey } }),
    JSON.stringify({ user_id: matrixUserId, usage: ["master"], keys: { "ed25519:a": masterPublicKey, "ed25519:b": masterPublicKey } }),
    sdkMasterKey("too-short"), sdkMasterKey("invalid!base64"),
  ]) {
    const extracted = matrixMasterPublicKeyFromSdk(serialized, matrixUserId);
    assert.equal(extracted, null);
    assert.equal(evaluateMatrixDeviceTrust({ ...verifiedSignals, masterKeyAvailable: extracted !== null, masterKeyMatches: false }).state, "UNKNOWN");
  }
});

test("SDK master-key extraction accepts standard and URL-safe Base64 with optional padding", () => {
  for (const publicKey of [masterPublicKey, `${masterPublicKey}=`, masterPublicKey.replace(/\//g, "_").replace(/\+/g, "-")]) {
    assert.equal(matrixMasterPublicKeyFromSdk(sdkMasterKey(publicKey), matrixUserId), publicKey);
  }
});

test("Matrix trust requires the SDK's cross-signing chain and exact current device keys", () => {
  assert.deepEqual(evaluateMatrixDeviceTrust(verifiedSignals), { state: "VERIFIED" });
  assert.equal(evaluateMatrixDeviceTrust({ ...verifiedSignals, identityAvailable: false }).state, "UNKNOWN");
  assert.equal(evaluateMatrixDeviceTrust({ ...verifiedSignals, deviceAvailable: false }).state, "UNKNOWN");
  assert.equal(evaluateMatrixDeviceTrust({ ...verifiedSignals, masterKeyAvailable: false }).state, "UNKNOWN");
  assert.equal(evaluateMatrixDeviceTrust({ ...verifiedSignals, deviceKeyAvailable: false }).state, "UNKNOWN");
  assert.equal(evaluateMatrixDeviceTrust({ ...verifiedSignals, identityVerified: false }).state, "VERIFIED");
  assert.equal(evaluateMatrixDeviceTrust({ ...verifiedSignals, identityTrustsOwnDevice: false }).state, "UNVERIFIED");
  assert.equal(evaluateMatrixDeviceTrust({ ...verifiedSignals, deviceCrossSignedByOwner: false }).state, "UNVERIFIED");
  assert.equal(evaluateMatrixDeviceTrust({ ...verifiedSignals, deviceCrossSigningTrusted: false }).state, "VERIFIED");
  assert.equal(evaluateMatrixDeviceTrust({ ...verifiedSignals, identityChanged: true }).state, "IDENTITY_CHANGED");
  assert.equal(evaluateMatrixDeviceTrust({ ...verifiedSignals, deviceRevoked: true }).state, "DEVICE_REVOKED");
  assert.equal(evaluateMatrixDeviceTrust({ ...verifiedSignals, masterKeyMatches: false }).state, "IDENTITY_CHANGED");
  assert.equal(evaluateMatrixDeviceTrust({ ...verifiedSignals, deviceKeyMatches: false }).state, "DEVICE_REVOKED");
});

test("trust monitor subscribes before initial read and repeats if a change arrives mid-read", async () => {
  const documentTarget = new FakeEventTarget();
  documentTarget.visibilityState = "visible";
  const windowTarget = new FakeEventTarget();
  let changeListener;
  let releaseFirst;
  let refreshCount = 0;
  const monitor = createMatrixDeviceTrustMonitor(async () => {
    refreshCount += 1;
    if (refreshCount === 1) await new Promise((resolve) => { releaseFirst = resolve; });
    return { state: "UNVERIFIED" };
  }, {
    documentTarget,
    windowTarget,
    subscribeToChanges: (listener) => { changeListener = listener; return () => { changeListener = null; }; },
    scheduleInterval: () => 1,
    clearScheduledInterval: () => {},
  });
  assert.equal(typeof changeListener, "function", "SDK listener is installed before the first trust read starts");
  changeListener();
  releaseFirst();
  await monitor.refreshNow();
  assert.equal(refreshCount, 2, "a trust change during refresh is not dropped");
  monitor.dispose();
  assert.equal(changeListener, null);
});

test("trust monitor refreshes on sync and foreground, but its fallback poll is low-frequency and visible-only", async () => {
  const documentTarget = new FakeEventTarget();
  documentTarget.visibilityState = "hidden";
  const windowTarget = new FakeEventTarget();
  let refreshCount = 0;
  let poll;
  let changes;
  const monitor = createMatrixDeviceTrustMonitor(async () => {
    refreshCount += 1;
    return { state: "UNVERIFIED" };
  }, {
    documentTarget,
    windowTarget,
    subscribeToChanges: (listener) => { changes = listener; return () => { changes = null; }; },
    scheduleInterval: (callback) => { poll = callback; return 1; },
    clearScheduledInterval: () => {},
  });
  const settle = () => new Promise((resolve) => setImmediate(resolve));
  await settle();
  assert.equal(refreshCount, 1);
  poll();
  assert.equal(refreshCount, 1, "hidden pages pause the fallback poll");
  changes();
  await settle();
  assert.equal(refreshCount, 2, "SDK sync notifications still refresh trust");
  documentTarget.visibilityState = "visible";
  documentTarget.emit("visibilitychange");
  await settle();
  windowTarget.emit("focus");
  await settle();
  assert.equal(refreshCount, 4);
  assert.equal(MATRIX_TRUST_POLL_INTERVAL_MS, 30_000);
  monitor.dispose();
  assert.equal(documentTarget.count("visibilitychange"), 0);
  assert.equal(windowTarget.count("focus"), 0);
  assert.equal(windowTarget.count("pageshow"), 0);
  assert.equal(changes, null);
});

test("proof retry is finite, obeys Retry-After, and keeps invalid proof and expired sessions separate", async () => {
  const waits = [];
  let attempts = 0;
  const value = await retryMatrixProofPreparation(async () => {
    attempts += 1;
    if (attempts < 3) throw new MatrixConnectorError("HOMESERVER_UNAVAILABLE", "rate limited", { retryAfterMs: 1_250 });
    return "proof-ready";
  }, { delaysMs: [100, 200], sleep: async (delay) => waits.push(delay) });
  assert.equal(value, "proof-ready");
  assert.equal(attempts, 3);
  assert.deepEqual(waits, [1_250, 1_250]);

  let invalidAttempts = 0;
  await assert.rejects(retryMatrixProofPreparation(async () => {
    invalidAttempts += 1;
    throw matrixControllerReceiptFailure(5005);
  }, { sleep: async () => assert.fail("invalid proof must not retry") }), { code: "OWNERSHIP_PROOF_INVALID" });
  assert.equal(invalidAttempts, 1);
  assert.equal(classifyMatrixProofFailure(new MatrixConnectorError("MATRIX_SESSION_INVALID", "expired")), "SESSION_INVALID");
  assert.equal(classifyMatrixProofFailure(new MatrixConnectorError("OWNERSHIP_PROOF_PENDING", "not synced")), "PENDING");

  let exhaustedAttempts = 0;
  await assert.rejects(retryMatrixProofPreparation(async () => {
    exhaustedAttempts += 1;
    throw new MatrixConnectorError("HOMESERVER_UNAVAILABLE", "later", { retryAfterMs: 60_000 });
  }, { delaysMs: [10, 20], sleep: async () => assert.fail("do not retry before Retry-After") }));
  assert.equal(exhaustedAttempts, 1);
});

test("only Locus application code 5005 is classified as definitive proof invalidity", () => {
  const rejected = matrixControllerReceiptFailure(5005);
  assert.equal(rejected.code, "OWNERSHIP_PROOF_INVALID");
  assert.equal(classifyMatrixProofFailure(rejected), "INVALID");
  assert.doesNotMatch(rejected.message, /proof bytes|signature|0x/);
  assert.equal(matrixControllerReceiptFailure(5003).code, "CONTROLLER_REVOKED");
  assert.equal(classifyMatrixProofFailure(matrixControllerReceiptFailure(5003)), "RELOGIN_REQUIRED");
  assert.equal(classifyMatrixProofFailure(matrixControllerReceiptFailure(2_147_483_649)), "PENDING");
});

test("connector uses trust before proof and never treats SAS done or server proof presence as device trust", async () => {
  const connector = await readFile(new URL("../web/src/matrix/MatrixConnector.ts", import.meta.url), "utf8");
  const crypto = await readFile(new URL("../web/src/matrix/MatrixCryptoDevice.ts", import.meta.url), "utf8");
  const dialog = await readFile(new URL("../web/src/matrix/MatrixLoginDialog.tsx", import.meta.url), "utf8");
  assert.match(crypto, /this\.machine\.queryKeysForUsers\(\[user\]\)/);
  assert.match(crypto, /identity\.trustsOurOwnDevice\(\)/);
  assert.match(crypto, /matrixMasterPublicKeyFromSdk\(identity\.masterKey, this\.userId\)/);
  assert.match(crypto, /device\.isCrossSignedByOwner\(\)/);
  assert.match(crypto, /device\.isCrossSigningTrusted\(\)/);
  assert.doesNotMatch(crypto, /device\.isVerified\(\)/);
  assert.match(connector, /trustSnapshot\.state !== "VERIFIED"/);
  assert.match(connector, /if \(!discovered\.encodedProof\) throw missingMatrixProof\(\)/);
  assert.match(connector, /const finalTrust = await connected\.refreshDeviceTrust\(\)/);
  assert.doesNotMatch(connector, /matrixProofIsPublished|keys\.verification === "verified"/);
  assert.match(connector, /else if \(hasActiveVerificationRequest\(connected\.verification\)\) setState\(mapVerificationState\(connected\.verification\)\)/);
  assert.match(connector, /if \(snapshot\?\.phase === "done" \|\| snapshot\?\.phase === "cancelled"\) void trustMonitor\?\.refreshNow\(\)/);
  assert.match(dialog, /我已完成验证/);
  assert.match(dialog, /onClick=\{\(\) => void refreshDeviceTrust\(\)\}/);
  assert.match(dialog, /requestOwnUserVerification\(\)[\s\S]*?改用此设备确认/);
  assert.match(dialog, /QR|二维码/);
  assert.match(dialog, /case "AUTHENTICATED":[\s\S]*case "DEVICE_KEYS_READY":[\s\S]*case "TRUST_CHECKING": return "正在登录"/);
  assert.match(dialog, /const initializing = connectionState === "AUTHENTICATED"[\s\S]*connectionState === "TRUST_CHECKING"/);
  assert.match(dialog, /initializing \?[\s\S]*正在登录…/);
  assert.doesNotMatch(dialog, /needsElementConfirmation \|\| connectionState === "TRUST_CHECKING"/);
  assert.match(connector, /if \(snapshot\.state === "UNVERIFIED"\)[\s\S]*?setState\(mapVerificationState\(connected\.verification\)\)/);
  assert.match(connector, /hasActiveVerificationRequest\(snapshot\)[\s\S]*?setState\(mapVerificationState\(snapshot\)\)/);
  assert.match(connector, /device\.startSync\(homeserver, authFetch, cryptoHttp\)[\s\S]*?makeConnected\(/);
  assert.match(connector, /const snapshot = await crypto\.refreshDeviceTrust\(authenticatedHttp\(stored\.homeserver, stored\)\)/);
  assert.doesNotMatch(connector + dialog, /navigator\.userAgent|\bMobile\b|\biPhone\b|\bAndroid\b/);
});
