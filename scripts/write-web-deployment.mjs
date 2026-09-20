import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";

function required(name) {
  const index = process.argv.indexOf(`--${name}`);
  const value = index === -1 ? undefined : process.argv[index + 1];
  if (!value) throw new Error(`missing --${name}`);
  return value;
}

const network = required("network");
const backend = required("backend");
const serviceId = Number(required("service-id"));
const genesisHash = required("genesis-hash");
const networkDomain = required("network-domain");
const root = path.resolve(new URL("..", import.meta.url).pathname);
const build = JSON.parse(await fs.readFile(path.join(root, "dist/build.json"), "utf8"));
const abi = JSON.parse(await fs.readFile(path.join(root, "dist/service.abi.json"), "utf8"));
const output = process.argv.includes("--output")
  ? process.argv[process.argv.indexOf("--output") + 1]
  : path.join(root, "web/public/deployments", `${network}.json`);

if (!Number.isInteger(serviceId) || serviceId < 0) throw new Error("--service-id must be a non-negative integer");
const descriptor = {
  format: 1,
  network,
  backendUrl: backend,
  genesisHash,
  networkDomain,
  serviceId,
  serviceKey: build.serviceKey,
  codeHash: build.code_hash,
  abiVersion: abi.abiVersion,
  abi,
  provenance: {
    locusCommit: process.env.LOCUS_COMMIT ?? "",
    jamscriptVersion: process.env.JAMSCRIPT_VERSION ?? "v0.1.0-rc.7",
    backendVersion: process.env.JAMSCRIPT_BACKEND_VERSION ?? "backend-v0.1.0-rc.7",
    minijamVersion: process.env.MINIJAM_VERSION ?? "stage1-v0.2.0",
  },
};
await fs.mkdir(path.dirname(path.resolve(output)), { recursive: true });
await fs.writeFile(path.resolve(output), `${JSON.stringify(descriptor, null, 2)}\n`);
console.log(`WEB_DEPLOYMENT_WRITTEN=${path.resolve(output)}`);
