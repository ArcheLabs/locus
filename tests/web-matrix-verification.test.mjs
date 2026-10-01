import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  createMatrixVerificationMonitor,
  MATRIX_VERIFICATION_POLL_INTERVAL_MS,
  MATRIX_VERIFICATION_POLL_WINDOW_MS,
  matrixProofIsPublished,
} from "../web/src/matrix/MatrixVerificationMonitor.ts";

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

test("Element verification published by the server advances through controller authorization to READY", async () => {
  const documentTarget = new FakeEventTarget();
  documentTarget.visibilityState = "visible";
  const windowTarget = new FakeEventTarget();
  const keys = { verification: "pending", selfSigningSignature: null };
  const states = [];
  let authorizationCount = 0;
  const refresh = async () => {
    if (!matrixProofIsPublished(keys)) return false;
    states.push("VERIFIED");
    authorizationCount += 1;
    states.push("CONTROLLER_AUTHORIZING");
    await Promise.resolve();
    states.push("READY");
    return true;
  };
  const monitor = createMatrixVerificationMonitor(refresh, {
    documentTarget,
    windowTarget,
    scheduleInterval: () => 1,
    clearScheduledInterval: () => {},
  });
  await monitor.refreshNow();
  keys.verification = "verified";
  keys.selfSigningSignature = new Uint8Array([1, 2, 3]);
  assert.equal(await monitor.refreshNow(), true);
  assert.deepEqual(states, ["VERIFIED", "CONTROLLER_AUTHORIZING", "READY"]);
  assert.equal(authorizationCount, 1);
  assert.equal(documentTarget.count("visibilitychange"), 0);
  console.log("MATRIX_EXTERNAL_VERIFICATION_DETECTED=PASS");
  console.log("MATRIX_VERIFIED_TO_CONTROLLER_AUTH=PASS");
  console.log("MATRIX_VERIFIED_TO_READY=PASS");
});

test("visibility, focus, and pageshow resume checks immediately; hidden tabs are ignored", async () => {
  const documentTarget = new FakeEventTarget();
  documentTarget.visibilityState = "hidden";
  const windowTarget = new FakeEventTarget();
  let refreshCount = 0;
  const monitor = createMatrixVerificationMonitor(async () => { refreshCount += 1; return false; }, {
    documentTarget,
    windowTarget,
    scheduleInterval: () => 1,
    clearScheduledInterval: () => {},
  });
  await monitor.refreshNow();
  assert.equal(refreshCount, 1);
  documentTarget.emit("visibilitychange");
  windowTarget.emit("focus");
  windowTarget.emit("pageshow");
  assert.equal(refreshCount, 1, "background pages do not trigger resume requests");
  documentTarget.visibilityState = "visible";
  documentTarget.emit("visibilitychange");
  await monitor.refreshNow();
  windowTarget.emit("focus");
  await monitor.refreshNow();
  windowTarget.emit("pageshow");
  await monitor.refreshNow();
  assert.equal(refreshCount, 4);
  assert.equal(MATRIX_VERIFICATION_POLL_INTERVAL_MS, 2_000);
  assert.equal(MATRIX_VERIFICATION_POLL_WINDOW_MS, 120_000);
  monitor.dispose();
  assert.equal(documentTarget.count("visibilitychange"), 0);
  assert.equal(windowTarget.count("focus"), 0);
  assert.equal(windowTarget.count("pageshow"), 0);
  console.log("MATRIX_VISIBILITY_RESUME_REFRESH=PASS");
});

test("the connector retains its SAS compatibility route while polling server proof", async () => {
  const connector = await readFile(new URL("../web/src/matrix/MatrixConnector.ts", import.meta.url), "utf8");
  const dialog = await readFile(new URL("../web/src/matrix/MatrixLoginDialog.tsx", import.meta.url), "utf8");
  assert.match(connector, /verificationMonitor = createMatrixVerificationMonitor\(refreshPublishedVerification\)/);
  assert.match(connector, /matrixProofIsPublished\(refreshed\)/);
  assert.match(connector, /if \(controllerAuthorization\) return controllerAuthorization/);
  assert.match(connector, /ensureMatrixController\(locus, owner, controller, verifiedKeys, stored\.deviceId, setState\)/);
  assert.match(connector, /if \(snapshot\?\.phase === "done"\) void connected\.refreshVerification\(\)/);
  assert.match(dialog, /pendingConnection!\.requestOwnUserVerification\(\)/);
  assert.match(dialog, /pendingConnection!\.confirmVerification\(true\)/);
  console.log("MATRIX_SAS_FLOW_STILL_SUPPORTED=PASS");
});
