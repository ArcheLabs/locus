import assert from "node:assert/strict";
import fs from "node:fs/promises";
import test from "node:test";

const servicePath = new URL("../../src/service.ts", import.meta.url);
const source = await fs.readFile(servicePath, "utf8");

test("service is Ownership-native and keeps protocol boundaries explicit", () => {
  assert.match(source, /auth:\s*ownership\(\)/);
  assert.match(source, /issuer:\s*ownership/);
  assert.match(source, /key: BalanceKey/);
  assert.match(source, /key: AllowanceKey/);
  assert.match(source, /ownershipKey\(/);
  assert.match(source, /value: u128/);
  assert.doesNotMatch(source, /wallet\(\)/);
  assert.doesNotMatch(source, /IdentityId|IdentityV1|OwnerV1|identityNonces|rotateOwner/);
  assert.doesNotMatch(source, /ECDSA|secp256k1|sr25519|EIP-712|Matrix/i);
  assert.doesNotMatch(source, /Number\([^)]*amount/);
  assert.doesNotMatch(source, /parseInt\([^)]*amount/);
  assert.doesNotMatch(source, /native JAM|jamBalance|wrapJAM/i);
});
