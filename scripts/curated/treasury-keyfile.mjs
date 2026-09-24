import fs from "node:fs/promises";
import path from "node:path";
import { EvmOwnershipSigner } from "@jamscript/client";
import { keccakAsU8a, secp256k1Expand, secp256k1PairFromSeed, secp256k1Sign } from "@polkadot/util-crypto";

const DOMAIN_TYPE = "EIP712Domain(string name,string version,bytes32 salt)";
const ACTION_TYPE = "JamScriptAction(bytes32 commitment)";
const DOMAIN_FIELDS = [
  { name: "name", type: "string" },
  { name: "version", type: "string" },
  { name: "salt", type: "bytes32" },
];
const ACTION_FIELDS = [{ name: "commitment", type: "bytes32" }];

function equalJson(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function fixedHex(value, byteLength, label) {
  if (typeof value !== "string" || !new RegExp(`^0x[0-9a-fA-F]{${byteLength * 2}}$`).test(value)) {
    throw new Error(`Treasury signer received invalid ${label}`);
  }
  return Buffer.from(value.slice(2), "hex");
}

function uint8Array(value) {
  return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
}

export function parseTreasuryPrivateKeyFile(contents) {
  const text = Buffer.from(contents).toString("ascii").trim();
  if (!/^(?:0x)?[0-9a-fA-F]{64}$/.test(text)) {
    throw new Error("Treasury key file must contain exactly one 32-byte hex private key");
  }
  return Buffer.from(text.replace(/^0x/i, ""), "hex");
}

export function evmAddressFromPrivateKey(privateKey) {
  if (!(privateKey instanceof Uint8Array) || privateKey.length !== 32) {
    throw new Error("Treasury key must be 32 bytes");
  }
  const pair = secp256k1PairFromSeed(privateKey);
  const publicKey = secp256k1Expand(pair.publicKey);
  const hash = keccakAsU8a(publicKey);
  return `0x${Buffer.from(hash.slice(-20)).toString("hex")}`;
}

export function jamScriptEip712Preimage(typedData) {
  if (!typedData || typedData.primaryType !== "JamScriptAction"
      || !equalJson(typedData.types?.EIP712Domain, DOMAIN_FIELDS)
      || !equalJson(typedData.types?.JamScriptAction, ACTION_FIELDS)
      || typedData.domain?.name !== "JamScript" || typedData.domain?.version !== "1"
      || Object.keys(typedData.message ?? {}).join(",") !== "commitment") {
    throw new Error("Treasury signer only accepts JamScriptAction EIP-712 requests");
  }

  const salt = fixedHex(typedData.domain.salt, 32, "network domain");
  const commitment = fixedHex(typedData.message.commitment, 32, "action commitment");
  const domainSeparator = keccakAsU8a(Buffer.concat([
    Buffer.from(keccakAsU8a(Buffer.from(DOMAIN_TYPE, "utf8"))),
    Buffer.from(keccakAsU8a(Buffer.from(typedData.domain.name, "utf8"))),
    Buffer.from(keccakAsU8a(Buffer.from(typedData.domain.version, "utf8"))),
    salt,
  ]));
  const structHash = keccakAsU8a(Buffer.concat([
    Buffer.from(keccakAsU8a(Buffer.from(ACTION_TYPE, "utf8"))),
    commitment,
  ]));
  return uint8Array(Buffer.concat([Buffer.from([0x19, 0x01]), Buffer.from(domainSeparator), Buffer.from(structHash)]));
}

async function readProtectedKeyFile(filePath, repositoryRoot) {
  const absolute = path.resolve(filePath);
  const root = path.resolve(repositoryRoot);
  if (absolute === root || absolute.startsWith(`${root}${path.sep}`)) {
    throw new Error("Treasury key file must be outside the repository");
  }
  const metadata = await fs.lstat(absolute);
  if (!metadata.isFile() || metadata.isSymbolicLink()) throw new Error("Treasury key path must be a regular, non-symlink file");
  if ((metadata.mode & 0o077) !== 0) throw new Error("Treasury key file permissions are too broad; set mode 0600");
  if (typeof process.getuid === "function" && metadata.uid !== process.getuid()) {
    throw new Error("Treasury key file must be owned by the current operating-system user");
  }
  if (metadata.size < 64 || metadata.size > 67) throw new Error("Treasury key file must contain a 32-byte hex key and optional newline");
  const contents = await fs.readFile(absolute);
  try {
    return parseTreasuryPrivateKeyFile(contents);
  } finally {
    contents.fill(0);
  }
}

export async function createTreasurySignerFromKeyFile(filePath, expectedAddress, repositoryRoot) {
  if (typeof filePath !== "string" || filePath.length === 0) {
    throw new Error("Set LOCUS_TREASURY_KEY_FILE to the protected Treasury signer file path");
  }
  const privateKey = await readProtectedKeyFile(filePath, repositoryRoot);
  let pair;
  try {
    pair = secp256k1PairFromSeed(privateKey);
  } catch {
    privateKey.fill(0);
    throw new Error("Treasury key file does not contain a valid secp256k1 private key");
  }
  const derivedAddress = evmAddressFromPrivateKey(privateKey);
  if (derivedAddress.toLowerCase() !== expectedAddress.toLowerCase()) {
    privateKey.fill(0);
    throw new Error(`Treasury signer address mismatch: expected ${expectedAddress}, derived ${derivedAddress}`);
  }

  const provider = {
    async request({ method, params }) {
      if (method !== "eth_signTypedData_v4" || !Array.isArray(params) || params.length !== 2
          || typeof params[0] !== "string" || params[0].toLowerCase() !== derivedAddress.toLowerCase()
          || typeof params[1] !== "string") {
        throw new Error("Treasury signer rejected an unsupported signing request");
      }
      let typedData;
      try {
        typedData = JSON.parse(params[1]);
      } catch {
        throw new Error("Treasury signer received malformed EIP-712 data");
      }
      const preimage = jamScriptEip712Preimage(typedData);
      const signature = secp256k1Sign(preimage, pair, "keccak");
      return `0x${Buffer.from(signature).toString("hex")}`;
    },
  };
  const signer = new EvmOwnershipSigner(provider, derivedAddress);
  const subject = await signer.getController();
  process.once("exit", () => privateKey.fill(0));
  return { signer, subject, address: derivedAddress };
}
