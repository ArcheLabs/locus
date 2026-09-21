import assert from "node:assert/strict";
import test from "node:test";
import { formatMatrixOwnership, resolveMasterOwnership } from "./server.mjs";

const key = Uint8Array.from({ length: 32 }, (_, index) => index);

test("resolver returns master Ownership and rejects key changes", async () => {
  const response = {
    ok: true,
    async json() {
      return { master_keys: { "@alice:example.org": { keys: { "ed25519:MASTER": Buffer.from(key).toString("base64url") } } } };
    },
  };
  const fetchImpl = async (url) => url.includes(".well-known") ? { ok: false, async json() { return {}; } } : response;
  const result = await resolveMasterOwnership("@alice:example.org", { accessToken: "secret", fetchImpl });
  assert.equal(result.ownership, formatMatrixOwnership(key));
  await assert.rejects(
    resolveMasterOwnership("@alice:example.org", { accessToken: "secret", fetchImpl, previous: { masterKey: "different" } }),
    /MATRIX_MASTER_KEY_CHANGED/,
  );
});

test("resolver never performs an anonymous Matrix lookup", async () => {
  await assert.rejects(resolveMasterOwnership("@alice:example.org", { fetchImpl: async () => { throw new Error("must not fetch"); } }), /MATRIX_RESOLVER_ACCESS_TOKEN_MISSING/);
});
