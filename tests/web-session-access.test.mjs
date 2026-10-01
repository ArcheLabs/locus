import assert from "node:assert/strict";
import test from "node:test";
import { authorizationWaitMessage, canPerformAuthorizedAction } from "../web/src/session/actionAuthorization.ts";

const scopeKey = "polkadot:test-genesis:42";
const context = (overrides = {}) => ({
  networkMode: true,
  networkReady: true,
  authorizationScopeKey: scopeKey,
  session: { kind: "matrix" },
  access: { identity: "CONNECTED", authorization: "READY", scopeKey },
  ...overrides,
});

test("Matrix protected actions require a verified identity and READY authorization for this exact service scope", () => {
  assert.equal(canPerformAuthorizedAction(context()), true);
  assert.equal(canPerformAuthorizedAction(context({ access: { identity: "CONNECTED", authorization: "PREPARING", scopeKey } })), false);
  assert.equal(canPerformAuthorizedAction(context({ access: { identity: "STATUS_UNKNOWN", authorization: "READY", scopeKey } })), false);
  assert.equal(canPerformAuthorizedAction(context({ access: { identity: "CONNECTED", authorization: "READY", scopeKey: "kusama:other:7" } })), false);
  assert.equal(canPerformAuthorizedAction(context({ authorizationScopeKey: null })), false);
  assert.equal(canPerformAuthorizedAction(context({ networkReady: false })), false);
});

test("authorization gating leaves demo and non-Matrix wallet behavior unchanged", () => {
  assert.equal(canPerformAuthorizedAction(context({ networkMode: false, networkReady: false, session: null, access: null })), true);
  assert.equal(canPerformAuthorizedAction(context({ session: { kind: "evm" }, access: null })), true);
  assert.equal(canPerformAuthorizedAction(context({ session: null })), false);
});

test("blocked Matrix actions receive a recoverable and accurate status", () => {
  assert.equal(authorizationWaitMessage(context({ access: { identity: "STATUS_UNKNOWN", authorization: "READY", scopeKey } })), "正在检查设备状态，请稍候。");
  assert.equal(authorizationWaitMessage(context({ access: { identity: "CONNECTED", authorization: "QUEUED", scopeKey } })), "正在准备账户，请稍候。");
  assert.match(authorizationWaitMessage(context({ access: { identity: "CONNECTED", authorization: "RETRY_REQUIRED", scopeKey } })), /账户菜单中重试/);
  assert.equal(authorizationWaitMessage(context({ networkReady: false })), "网络或服务尚未就绪，请稍候。");
});
