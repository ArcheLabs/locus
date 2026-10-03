import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { lstat, readFile } from "node:fs/promises";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const expectedVersion = "0.1.0-rc.7";
const requiredMethods = [
  "assertTransactionLifecycleSupport",
  "transactionScope",
  "waitForBest",
  "waitForFinalized",
  "watchTransaction",
  "prepareOwnershipAction",
  "signPreparedOwnershipAction",
  "submitSignedOwnershipAction",
];

for (const consumer of ["root", "web"]) {
  const packageDirectory = consumer === "root" ? repoRoot : join(repoRoot, "web");
  const clientDirectory = join(packageDirectory, "node_modules/@jamscript/client");
  assert.equal((await lstat(clientDirectory)).isSymbolicLink(), false, `${consumer} package must not be a workspace/link install`);
  const packageJson = JSON.parse(await readFile(join(clientDirectory, "package.json"), "utf8"));
  assert.equal(packageJson.version, expectedVersion, `${consumer} must resolve the installed ${expectedVersion} package`);

  const entry = packageJson.exports?.["."]?.import ?? packageJson.module;
  assert.equal(typeof entry, "string", "installed Client must declare its ESM entry point");
  const moduleUrl = pathToFileURL(join(clientDirectory, entry)).href;
  const source = `
    import assert from "node:assert/strict";
    const client = await import(${JSON.stringify(moduleUrl)});
    assert.equal(typeof client.JamScriptClient, "function");
    assert.equal(typeof client.RpcError, "function");
    const fault = new client.RpcError("NOT_SUBMITTED: GUEST_HEAP_LIMIT_EXCEEDED", -32045, {
      code: "NOT_SUBMITTED",
      cause: { code: "GUEST_HEAP_LIMIT_EXCEEDED", message: "Guest allocation exceeded its memory budget", stage: "plan", details: { heapMaxBytes: 16777216 } },
    });
    assert.equal(fault.structuredError?.code, "GUEST_HEAP_LIMIT_EXCEEDED");
    assert.equal(fault.structuredError?.submissionState, "not_submitted");
    for (const method of ${JSON.stringify(requiredMethods)}) {
      assert.equal(typeof client.JamScriptClient.prototype[method], "function", method);
    }
  `;
  const result = spawnSync(process.execPath, ["--input-type=module", "-e", source], { encoding: "utf8" });
  assert.equal(result.status, 0, `${consumer} phased API check failed:\n${result.stderr}`);
  console.log(`${consumer.toUpperCase()}_INSTALLED_CLIENT=${packageJson.version} LIFECYCLE_AND_PHASED_APIS=PASS`);
}
