import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { FetchRpcTransport, JamScriptClient, ownershipKey, toHex } from "@jamscript/client";
import { LocusClient, encodeOwnership } from "../../dist/sdk/index.js";

const root = path.resolve(new URL("../..", import.meta.url).pathname);

export async function createCuratedRuntime(signerEnvName, { requireTreasurySigner = false } = {}) {
  const descriptorPath = path.resolve(process.env.LOCUS_CURATED_DEPLOYMENT ?? path.join(root, "web/public/deployments/local.json"));
  const descriptor = JSON.parse(await fs.readFile(descriptorPath, "utf8"));
  if (descriptor.network !== "local") throw new Error("Curated Local tooling refuses non-Local deployment descriptors; canonical Testnet is deferred.");
  if (!descriptor.genesisHash || !Number.isSafeInteger(descriptor.serviceId) || !descriptor.abi || !descriptor.serviceKey || !descriptor.codeHash) {
    throw new Error("Local deployment descriptor is incomplete");
  }
  const backendRpc = process.env.LOCUS_CURATED_BACKEND_RPC ?? descriptor.backendUrl;
  if (typeof backendRpc !== "string" || !/^https?:\/\//.test(backendRpc)) {
    throw new Error("Set LOCUS_CURATED_BACKEND_RPC to the trusted backend RPC URL; relative browser paths cannot be used by this script.");
  }

  const signerModulePath = process.env[signerEnvName];
  if (!signerModulePath) throw new Error(`${signerEnvName} is required; no key is generated or substituted by this script`);
  const resolvedSignerPath = signerModulePath.startsWith("file:")
    ? new URL(signerModulePath)
    : pathToFileURL(path.resolve(signerModulePath));
  const signerFsPath = resolvedSignerPath.protocol === "file:" ? path.resolve(resolvedSignerPath.pathname) : "";
  if (signerFsPath && (signerFsPath === root || signerFsPath.startsWith(`${root}${path.sep}`))) {
    throw new Error("Signer module must be stored outside the repository");
  }
  const signerExports = await import(resolvedSignerPath.href);
  const provided = signerExports.default ?? {};
  const signer = signerExports.signer ?? provided.signer ?? signerExports.default;
  const subject = signerExports.subject ?? signerExports.issuer ?? provided.subject ?? provided.issuer ?? signer?.controller;
  if (!signer || !subject || typeof signer.signJamScriptAction !== "function" || !signer.controller) {
    throw new Error(`${signerEnvName} must reference a protected module exporting signer and optional subject/issuer Ownership`);
  }
  encodeOwnership(subject);
  encodeOwnership(signer.controller);
  if (requireTreasurySigner) {
    const { curatedTreasuryOwnership } = await import("./config.mjs");
    if (toHex(ownershipKey(signer.controller)).toLowerCase() !== toHex(ownershipKey(curatedTreasuryOwnership)).toLowerCase()) {
      throw new Error("Treasury signer controller does not match the configured curated treasury Ownership");
    }
    if (toHex(ownershipKey(subject)).toLowerCase() !== toHex(ownershipKey(curatedTreasuryOwnership)).toLowerCase()) {
      throw new Error("Treasury pool actions require the treasury Ownership as the direct subject");
    }
  }

  const protocolClient = new JamScriptClient(descriptor, new FetchRpcTransport(backendRpc));
  await protocolClient.validateDeployment();
  return { descriptor, backendRpc, protocolClient, locus: new LocusClient(protocolClient, { signer, subject }), subject };
}

export async function submitAndRequireApplied(protocolClient, submitted, label) {
  const result = await protocolClient.waitForAction(submitted.transactionId, { intervalMs: 500, timeoutMs: 180_000 });
  if (result.actionReceipt.status !== "applied") {
    const code = result.actionReceipt.errorCode;
    throw new Error(`${label} failed${code === null ? "" : ` with Locus error ${code}`}`);
  }
  return result;
}

export function catalogIdentityKey(ownership) {
  return toHex(ownershipKey(ownership)).toLowerCase();
}
