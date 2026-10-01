import assert from "node:assert/strict";
import test from "node:test";
import { MatrixRecipientRequestError, requestMatrixRecipientOwnership } from "../web/src/matrix/MatrixRecipientRequest.mjs";

const userId = "@bob:example.org";

test("browser resolver request sends only the Matrix ID and no credential", async () => {
  let request;
  const ownership = "locus:AQAgAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
  const result = await requestMatrixRecipientOwnership(userId, "/matrix-resolver", undefined, async (url, options) => {
    request = { url, options };
    return { ok: true, status: 200, async json() { return { userId, ownership }; } };
  });
  assert.equal(result, ownership);
  assert.equal(request.url, "/matrix-resolver/v1/resolve");
  assert.equal(request.options.method, "POST");
  assert.deepEqual(request.options.headers, { "content-type": "application/json" });
  assert.deepEqual(JSON.parse(request.options.body), { userId });
  assert.equal("authorization" in request.options.headers, false);
  assert.equal(request.options.credentials, "omit");
  assert.equal(request.options.mode, "cors");
  assert.equal(request.options.redirect, "error");
});

test("browser API has no token option and ignores accidental extra token arguments", async () => {
  let headers;
  await requestMatrixRecipientOwnership(userId, "/matrix-resolver", undefined, async (_url, options) => {
    headers = options.headers;
    return { ok: true, status: 200, async json() { return { ownership: "locus:AQAgAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" }; } };
  }, "should-not-be-used");
  assert.deepEqual(headers, { "content-type": "application/json" });
});

test("missing resolver configuration produces a clear unconfigured error before fetch", async () => {
  await assert.rejects(requestMatrixRecipientOwnership(userId, undefined, undefined, async () => {
    assert.fail("must not make a request without the network resolver URL");
  }), (error) => error instanceof MatrixRecipientRequestError && error.code === "RESOLVER_UNCONFIGURED");
});

test("master-key change is a hard stop and resolver failures never fabricate Ownership", async () => {
  await assert.rejects(requestMatrixRecipientOwnership(userId, "/matrix-resolver", undefined, async () => ({
    ok: false,
    status: 409,
    async json() { return { error: "MATRIX_MASTER_KEY_CHANGED" }; },
  })), (error) => error instanceof MatrixRecipientRequestError && error.code === "MATRIX_MASTER_KEY_CHANGED");
  await assert.rejects(requestMatrixRecipientOwnership(userId, "/matrix-resolver", undefined, async () => ({
    ok: false,
    status: 502,
    async json() { return { error: "MATRIX_FEDERATION_FAILURE" }; },
  })), (error) => error instanceof MatrixRecipientRequestError && error.code === "MATRIX_FEDERATION_FAILURE");
});

test("successful HTTP response without a canonical Ownership is rejected", async () => {
  await assert.rejects(requestMatrixRecipientOwnership(userId, "/matrix-resolver", undefined, async () => ({
    ok: true,
    status: 200,
    async json() { return { userId }; },
  })), (error) => error instanceof MatrixRecipientRequestError && error.code === "MATRIX_HOMESERVER_UNAVAILABLE");
});
