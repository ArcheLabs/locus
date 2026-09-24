import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { FetchRpcTransport, JamScriptClient, ownershipKey, toHex } from "@jamscript/client";
import { LocusClient, encodeOwnership } from "../../dist/sdk/index.js";
import { CURATED_TREASURY_EVM, curatedTreasuryOwnership } from "./config.mjs";

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

  let signer;
  let subject;
  const treasuryKeyFile = requireTreasurySigner ? process.env.LOCUS_TREASURY_KEY_FILE : undefined;
  if (treasuryKeyFile) {
    const { createTreasurySignerFromKeyFile } = await import("./treasury-keyfile.mjs");
    ({ signer, subject } = await createTreasurySignerFromKeyFile(treasuryKeyFile, CURATED_TREASURY_EVM, root));
  } else {
    const signerModulePath = process.env[signerEnvName];
    if (!signerModulePath) {
      const expected = requireTreasurySigner
        ? "LOCUS_TREASURY_KEY_FILE or a protected Treasury signer module is required; no key is generated or substituted by this script"
        : `${signerEnvName} is required; no key is generated or substituted by this script`;
      throw new Error(expected);
    }
    const resolvedSignerPath = signerModulePath.startsWith("file:")
      ? new URL(signerModulePath)
      : pathToFileURL(path.resolve(signerModulePath));
    const signerFsPath = resolvedSignerPath.protocol === "file:" ? path.resolve(resolvedSignerPath.pathname) : "";
    if (signerFsPath && (signerFsPath === root || signerFsPath.startsWith(`${root}${path.sep}`))) {
      throw new Error("Signer module must be stored outside the repository");
    }
    const signerExports = await import(resolvedSignerPath.href);
    const provided = signerExports.default ?? {};
    signer = signerExports.signer ?? provided.signer ?? signerExports.default;
    subject = signerExports.subject ?? signerExports.issuer ?? provided.subject ?? provided.issuer;
  }
  const controller = signer?.controller ?? (typeof signer?.getController === "function" ? await signer.getController() : undefined);
  subject ??= controller;
  if (!signer || !subject || typeof signer.signJamScriptAction !== "function" || !controller) {
    throw new Error(`${signerEnvName} must resolve to a protected Ownership signer and optional direct subject`);
  }
  encodeOwnership(subject);
  encodeOwnership(controller);
  if (requireTreasurySigner) {
    const exactEvmController = controller.version === curatedTreasuryOwnership.version
      && controller.kind === curatedTreasuryOwnership.kind
      && toHex(controller.public).toLowerCase() === toHex(curatedTreasuryOwnership.public).toLowerCase();
    if (!exactEvmController) {
      throw new Error("Treasury signer controller does not match the configured curated treasury Ownership");
    }
    const exactEvmSubject = subject.version === curatedTreasuryOwnership.version
      && subject.kind === curatedTreasuryOwnership.kind
      && toHex(subject.public).toLowerCase() === toHex(curatedTreasuryOwnership.public).toLowerCase();
    if (!exactEvmSubject) {
      throw new Error("Treasury pool actions require the treasury Ownership as the direct subject");
    }
    console.log("TREASURY_SIGNER_ADDRESS_MATCH=PASS");
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
