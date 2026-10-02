import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const descriptorPath = path.join(root, "web", "dist", "deployments", "testnet.json");
const [descriptor, build, abi, networks] = await Promise.all([
  fs.readFile(descriptorPath, "utf8").then(JSON.parse),
  fs.readFile(path.join(root, "dist", "build.json"), "utf8").then(JSON.parse),
  fs.readFile(path.join(root, "dist", "service.abi.json"), "utf8").then(JSON.parse),
  fs.readFile(path.join(root, "web", "dist", "locus-networks.json"), "utf8").then(JSON.parse),
]);

function rejectSecretFields(value, location = "descriptor") {
  if (Array.isArray(value)) {
    value.forEach((entry, index) => rejectSecretFields(entry, `${location}[${index}]`));
    return;
  }
  if (!value || typeof value !== "object") return;
  for (const [key, child] of Object.entries(value)) {
    if (location === "descriptor" && key === "abi") continue;
    assert.doesNotMatch(key, /token|secret|mnemonic|password|private.?key|seed/i, `unexpected credential field at ${location}`);
    rejectSecretFields(child, `${location}.${key}`);
  }
}

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]));
}

assert.equal(descriptor.format, 1);
assert.equal(descriptor.network, "testnet");
assert.equal(descriptor.backendUrl, "https://rpc-stage1.minijam.xyz/rpc");
assert.match(descriptor.genesisHash, /^0x[0-9a-f]{64}$/i);
assert.equal(typeof descriptor.networkDomain, "string");
assert.ok(descriptor.networkDomain.length > 0);
assert.ok(Number.isInteger(descriptor.serviceId) && descriptor.serviceId >= 0);
assert.equal(descriptor.serviceKey, build.serviceKey);
assert.equal(descriptor.codeHash, build.code_hash);
assert.equal(descriptor.codeHash, "0x7244d2be5d4c66cd59b186700c18e86464e0e5768cb73e64b4d03258cbd97114");
assert.equal(descriptor.abiVersion, abi.abiVersion);
assert.deepEqual(stable(descriptor.abi), stable(abi));
assert.equal(descriptor.provenance?.locusCommit, "359f4605f6a8ff2dc96fbbbd9be608e8babce51c");
assert.equal(descriptor.provenance?.jamscriptVersion, "v0.1.0-rc.8");
assert.equal(descriptor.provenance?.backendVersion, "backend-v0.1.0-rc.8");
assert.equal(descriptor.provenance?.minijamVersion, "stage1-v0.2.1");
assert.equal(networks.defaultNetwork, "testnet");
assert.equal(networks.networks?.testnet?.backendUrl, "https://rpc-stage1.minijam.xyz/rpc");
assert.equal(networks.networks?.testnet?.matrixResolverUrl, "https://rpc-stage1.minijam.xyz/matrix-resolver");
assert.equal(networks.networks?.testnet?.deploymentUrl, "deployments/testnet.json");
assert.equal(await fs.readFile(path.join(root, "web", "dist", "404.html"), "utf8"), await fs.readFile(path.join(root, "web", "dist", "index.html"), "utf8"));
rejectSecretFields(descriptor);

console.log("PAGES_DEPLOYMENT_DESCRIPTOR=verified");
console.log("PAGES_PUBLIC_ENDPOINTS=verified");
console.log("PAGES_ARTIFACT_AND_ABI_MATCH=verified");
