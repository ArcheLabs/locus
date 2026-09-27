import assert from "node:assert/strict";
import { mkdtemp, readFile, stat, writeFile, chmod, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { formatLocusId, matrixOwnership } from "../../sdk/src/ownership.ts";
import {
  createResolverServer,
  isValidMatrixUserId,
  resolveMasterOwnership,
  ResolverError,
  TUWUNEL_ORIGIN,
  validateMatrixMasterKey,
} from "./server.mjs";

const userId = "@alice:example.org";
const keyBytes = Uint8Array.from({ length: 32 }, (_, index) => index);
const keyValue = Buffer.from(keyBytes).toString("base64").replace(/=+$/, "");
const masterKey = (bytes = keyBytes, forUser = userId) => {
  const encoded = Buffer.from(bytes).toString("base64").replace(/=+$/, "");
  return { user_id: forUser, usage: ["master"], keys: { [`ed25519:${encoded}`]: encoded } };
};
const appserviceToken = "a".repeat(64);

function matrixResponse(body, { status = 200, redirected = false } = {}) {
  return { ok: status >= 200 && status < 300, status, redirected, async json() { return body; } };
}

async function withServer(t, { fetchImpl = async () => matrixResponse({ master_keys: { [userId]: masterKey() } }), statePath, homeserverUrl } = {}) {
  const directory = await mkdtemp(join(tmpdir(), "locus-matrix-resolver-"));
  const tokenPath = join(directory, "as_token");
  const pinsPath = statePath ?? join(directory, "state.json");
  await writeFile(tokenPath, `${appserviceToken}\n`, { mode: 0o600 });
  await chmod(tokenPath, 0o600);
  const server = await createResolverServer({
    port: 0,
    asTokenFile: tokenPath,
    statePath: pinsPath,
    fetchImpl,
    ...(homeserverUrl ? { homeserverUrl } : {}),
  });
  t.after(async () => {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    await rm(directory, { recursive: true, force: true });
  });
  const address = server.address();
  return { baseUrl: `http://127.0.0.1:${address.port}`, tokenPath, statePath: pinsPath };
}

async function postResolve(baseUrl, body = { userId }) {
  return fetch(`${baseUrl}/v1/resolve`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

test("Matrix user ID parser accepts valid IDs and rejects malformed / invalid port IDs", () => {
  assert.equal(isValidMatrixUserId("@alice:example.org"), true);
  assert.equal(isValidMatrixUserId("@alice:example.org:8448"), true);
  assert.equal(isValidMatrixUserId("@alice:[2001:db8::1]:8448"), true);
  for (const candidate of ["alice:example.org", "@alice", "@alice:bad/path", "@alice:example.org:0", "@alice:example.org:70000", "@alice:example.org:abc", "@alice:example.org token"]) {
    assert.equal(isValidMatrixUserId(candidate), false, candidate);
  }
});

test("strict master key validation checks user, usage, one Ed25519 key, exact key ID/value and 32-byte canonical base64", async (t) => {
  const valid = masterKey();
  assert.deepEqual(validateMatrixMasterKey(userId, valid), keyBytes);
  await t.test("signatures are optional", () => {
    assert.deepEqual(validateMatrixMasterKey(userId, valid), keyBytes);
  });
  const cases = [
    ["user ID mismatch", { ...valid, user_id: "@mallory:example.org" }],
    ["usage must contain only master", { ...valid, usage: ["master", "self_signing"] }],
    ["usage must be present", { ...valid, usage: undefined }],
    ["master must have one key", { ...valid, keys: { ...valid.keys, "ed25519:other": keyValue } }],
    ["master key algorithm must be ed25519", { ...valid, keys: { [`curve25519:${keyValue}`]: keyValue } }],
    ["key ID suffix must equal key value", { ...valid, keys: { "ed25519:different": keyValue } }],
    ["key must be unpadded Matrix Base64", { ...valid, keys: { "ed25519:AA==": "AA==" } }],
  ];
  for (const [label, candidate] of cases) {
    await t.test(label, () => assert.throws(() => validateMatrixMasterKey(userId, candidate), (error) => error instanceof ResolverError && error.code === "MATRIX_INVALID_REMOTE_KEY"));
  }
});

test("ownership uses the canonical JamScript SDK encoding", async () => {
  const result = await resolveMasterOwnership(userId, {
    asToken: appserviceToken,
    fetchImpl: async (url, options) => {
      assert.equal(url, `${TUWUNEL_ORIGIN}/_matrix/client/v3/keys/query`);
      assert.equal(options.redirect, "error");
      assert.equal(options.signal.aborted, false);
      assert.deepEqual(JSON.parse(options.body), { device_keys: { [userId]: [] }, timeout: 10_000 });
      assert.equal(options.headers.authorization, `Bearer ${appserviceToken}`);
      assert.equal(options.headers["content-type"], "application/json");
      return matrixResponse({ master_keys: { [userId]: masterKey() } });
    },
  });
  assert.equal(result.ownership, formatLocusId(matrixOwnership(keyBytes)));
  assert.equal(result.masterKey, Buffer.from(keyBytes).toString("base64url"));
});

test("fixed Tuwunel target is independent of the recipient homeserver", async () => {
  const calls = [];
  const result = await resolveMasterOwnership("@alice:attacker.invalid", {
    asToken: appserviceToken,
    fetchImpl: async (url, options) => {
      calls.push({ url, authorization: options.headers.authorization });
      return matrixResponse({ master_keys: { "@alice:attacker.invalid": masterKey(keyBytes, "@alice:attacker.invalid") } });
    },
  });
  assert.equal(result.userId, "@alice:attacker.invalid");
  assert.deepEqual(calls, [{ url: `${TUWUNEL_ORIGIN}/_matrix/client/v3/keys/query`, authorization: `Bearer ${appserviceToken}` }]);
});

test("Tuwunel federation failure and unavailable cross-signing have normalized errors", async (t) => {
  await t.test("federation failures", async () => {
    await assert.rejects(resolveMasterOwnership(userId, {
      asToken: appserviceToken,
      fetchImpl: async () => matrixResponse({ failures: { "example.org": { errcode: "M_UNKNOWN" } } }),
    }), (error) => error.code === "MATRIX_FEDERATION_FAILURE");
  });
  await t.test("missing cross-signing master", async () => {
    await assert.rejects(resolveMasterOwnership(userId, {
      asToken: appserviceToken,
      fetchImpl: async () => matrixResponse({ master_keys: {} }),
    }), (error) => error.code === "MATRIX_CROSS_SIGNING_UNAVAILABLE");
  });
  await t.test("malformed remote key", async () => {
    await assert.rejects(resolveMasterOwnership(userId, {
      asToken: appserviceToken,
      fetchImpl: async () => matrixResponse({ master_keys: { [userId]: { ...masterKey(), user_id: "@other:example.org" } } }),
    }), (error) => error.code === "MATRIX_INVALID_REMOTE_KEY");
  });
});

test("resolver rejects remote redirects and bounds the Tuwunel request", async () => {
  let request;
  await assert.rejects(resolveMasterOwnership(userId, {
    asToken: appserviceToken,
    fetchImpl: async (url, options) => {
      request = { url, options };
      return matrixResponse({}, { status: 302, redirected: true });
    },
  }), (error) => error.code === "MATRIX_HOMESERVER_UNAVAILABLE");
  assert.equal(request.url, `${TUWUNEL_ORIGIN}/_matrix/client/v3/keys/query`);
  assert.equal(request.options.redirect, "error");
  assert.equal(request.options.signal.aborted, false);
  await assert.rejects(resolveMasterOwnership(userId, {
    asToken: appserviceToken,
    fetchImpl: async () => { throw new DOMException("timed out", "TimeoutError"); },
  }), (error) => error.code === "MATRIX_QUERY_TIMEOUT");
});

test("resolver starts only with a protected AS token file and fixed homeserver", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "locus-matrix-config-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const tokenPath = join(directory, "token");
  await writeFile(tokenPath, appserviceToken, { mode: 0o644 });
  await assert.rejects(createResolverServer({ port: 0, asTokenFile: tokenPath, statePath: join(directory, "state.json") }), (error) => error.code === "MATRIX_RESOLVER_CONFIGURATION_ERROR");
  await chmod(tokenPath, 0o600);
  await assert.rejects(createResolverServer({ port: 0, homeserverUrl: "https://attacker.invalid", asTokenFile: tokenPath, statePath: join(directory, "state.json") }), (error) => error.code === "MATRIX_RESOLVER_CONFIGURATION_ERROR");
});

test("HTTP API accepts only userId and returns canonical Ownership without key internals", async (t) => {
  const requests = [];
  const service = await withServer(t, { fetchImpl: async (url, options) => {
    requests.push({ url, options });
    return matrixResponse({ master_keys: { [userId]: masterKey() } });
  } });
  const response = await postResolve(service.baseUrl);
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.deepEqual(Object.keys(result).sort(), ["ownership", "userId"]);
  assert.equal(result.userId, userId);
  assert.equal(result.ownership, formatLocusId(matrixOwnership(keyBytes)));
  assert.equal(requests.length, 1);
  assert.equal(requests[0].url, `${TUWUNEL_ORIGIN}/_matrix/client/v3/keys/query`);
  assert.equal(requests[0].options.headers.authorization, `Bearer ${appserviceToken}`);
  assert.deepEqual(JSON.parse(requests[0].options.body), { device_keys: { [userId]: [] }, timeout: 10_000 });
  assert.equal(requests[0].options.redirect, "error");
});

test("HTTP API rejects client-supplied homeservers, tokens, endpoints and authorization", async (t) => {
  let upstreamCalls = 0;
  const service = await withServer(t, { fetchImpl: async () => {
    upstreamCalls += 1;
    return matrixResponse({ master_keys: { [userId]: masterKey() } });
  } });
  for (const extra of [{ homeserver: "https://attacker.invalid" }, { url: "https://attacker.invalid" }, { endpoint: "https://attacker.invalid" }, { accessToken: "secret" }, { token: "secret" }, { authorization: "Bearer secret" }]) {
    const response = await postResolve(service.baseUrl, { userId, ...extra });
    assert.equal(response.status, 400);
    assert.deepEqual(await response.json(), { error: "INVALID_REQUEST" });
  }
  assert.equal(upstreamCalls, 0);
});

test("HTTP API enforces JSON and the 4096 byte request limit", async (t) => {
  const service = await withServer(t);
  const wrongType = await fetch(`${service.baseUrl}/v1/resolve`, { method: "POST", headers: { "content-type": "text/plain" }, body: "{}" });
  assert.equal(wrongType.status, 400);
  const large = await fetch(`${service.baseUrl}/v1/resolve`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ userId, padding: "x".repeat(5000) }) });
  assert.equal(large.status, 413);
});

test("health endpoints distinguish loaded configuration from Tuwunel readiness", async (t) => {
  const service = await withServer(t, { fetchImpl: async (url) => {
    assert.equal(url, `${TUWUNEL_ORIGIN}/_matrix/client/versions`);
    return matrixResponse({ versions: ["v1.1"] });
  } });
  const health = await fetch(`${service.baseUrl}/healthz`);
  assert.equal(health.status, 200);
  assert.deepEqual(await health.json(), { status: "ready" });
  const readiness = await fetch(`${service.baseUrl}/readyz`);
  assert.equal(readiness.status, 200);
  assert.deepEqual(await readiness.json(), { status: "ready" });
});

test("master key pinning is concurrency-safe and changed keys fail closed", async (t) => {
  let key = keyBytes;
  const service = await withServer(t, { fetchImpl: async () => matrixResponse({ master_keys: { [userId]: masterKey(key) } }) });
  const responses = await Promise.all(Array.from({ length: 8 }, () => postResolve(service.baseUrl)));
  assert.ok(responses.every((response) => response.status === 200));
  const pin = JSON.parse(await readFile(service.statePath, "utf8"))[userId];
  assert.equal(pin.masterKey, Buffer.from(keyBytes).toString("base64url"));
  assert.equal(typeof pin.firstSeen, "string");
  assert.equal(typeof pin.lastSeen, "string");
  assert.equal((await stat(service.statePath)).mode & 0o077, 0);

  key = Uint8Array.from({ length: 32 }, (_, index) => 255 - index);
  const changed = await postResolve(service.baseUrl);
  assert.equal(changed.status, 409);
  assert.deepEqual(await changed.json(), { error: "MATRIX_MASTER_KEY_CHANGED" });
  const after = JSON.parse(await readFile(service.statePath, "utf8"))[userId];
  assert.equal(after.masterKey, Buffer.from(keyBytes).toString("base64url"));
});

test("simultaneous first resolutions of conflicting keys create exactly one pin", async (t) => {
  const first = keyBytes;
  const second = Uint8Array.from({ length: 32 }, (_, index) => 200 + index);
  let calls = 0;
  let release;
  const bothArrived = new Promise((resolve) => { release = resolve; });
  const service = await withServer(t, { fetchImpl: async () => {
    const call = calls++;
    if (calls === 2) release();
    await bothArrived;
    const bytes = call === 0 ? first : second;
    return matrixResponse({ master_keys: { [userId]: masterKey(bytes) } });
  } });
  const results = await Promise.all([postResolve(service.baseUrl), postResolve(service.baseUrl)]);
  assert.deepEqual(results.map((response) => response.status).sort(), [200, 409]);
  const state = JSON.parse(await readFile(service.statePath, "utf8"));
  assert.equal(Object.keys(state).length, 1);
  assert.ok([Buffer.from(first).toString("base64url"), Buffer.from(second).toString("base64url")].includes(state[userId].masterKey));
});
