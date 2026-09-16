import assert from "node:assert/strict";
import fs from "node:fs/promises";
import test from "node:test";

const servicePath = new URL("../../src/service.ts", import.meta.url);
const source = await fs.readFile(servicePath, "utf8");

test("service keeps identity/key and numeric boundaries explicit", () => {
  assert.match(source, /key: BalanceKey/);
  assert.match(source, /key: AllowanceKey/);
  assert.match(source, /issuer: IdentityId/);
  assert.match(source, /value: u128/);
  assert.match(source, /payload: bytes\(65\)/);
  assert.doesNotMatch(source, /balances\s*\[\s*ctx\.sender/);
  assert.doesNotMatch(source, /allowances\s*\[\s*ctx\.sender/);
  assert.doesNotMatch(source, /Number\([^)]*amount/);
  assert.doesNotMatch(source, /parseInt\([^)]*amount/);
  assert.doesNotMatch(source, /native JAM|jamBalance|wrapJAM/i);
});
