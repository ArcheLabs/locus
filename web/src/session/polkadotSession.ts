import {
  OWNERSHIP_KIND,
  decodePolkadotAccountId,
  type Ownership,
  type OwnershipSigner,
} from "@jamscript/client";
import { ed25519Verify, secp256k1Verify, sr25519Verify } from "@polkadot/util-crypto";
import type { LocusWebSession } from "./types.js";

export type PolkadotBrowserAccount = {
  address: string;
  publicKey?: Uint8Array;
  type?: string;
  name?: string;
  meta?: { name?: string; source?: string };
};

export type PolkadotInjector = {
  signer: { signRaw?: (input: { address: string; data: string; type: "bytes" }) => Promise<{ signature: string }> };
};

export type BrowserAccountOption = {
  id: string;
  label: string;
  description: string;
};

function shortAddress(value: string): string {
  return value.length > 14 ? `${value.slice(0, 8)}…${value.slice(-6)}` : value;
}

function asOwnership(value: Ownership): Ownership {
  return { ...value, public: value.public.slice() };
}

type PolkadotSignatureScheme = "ed25519" | "sr25519" | "ecdsa";

const POLKADOT_SCHEME_PREFIX: Record<PolkadotSignatureScheme, number> = {
  ed25519: 0,
  sr25519: 1,
  ecdsa: 2,
};
const SECP256K1_ORDER = BigInt("0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141");
const SECP256K1_HALF_ORDER = SECP256K1_ORDER >> 1n;

function bytesToHex(bytes: Uint8Array): string {
  return `0x${Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join("")}`;
}

function hexToBytes(value: string): Uint8Array {
  const hex = value.startsWith("0x") ? value.slice(2) : value;
  if (hex.length % 2 !== 0 || !/^[0-9a-f]+$/i.test(hex)) throw new Error("The wallet returned an invalid signature.");
  return Uint8Array.from(hex.match(/../g) ?? [], (pair) => Number.parseInt(pair, 16));
}

function wrappedSignRawMessage(message: Uint8Array): Uint8Array {
  const prefix = new TextEncoder().encode("<Bytes>");
  const suffix = new TextEncoder().encode("</Bytes>");
  const wrapped = new Uint8Array(prefix.length + message.length + suffix.length);
  wrapped.set(prefix);
  wrapped.set(message, prefix.length);
  wrapped.set(suffix, prefix.length + message.length);
  return wrapped;
}

function canonicalizeEcdsaSignature(signature: Uint8Array): Uint8Array | null {
  if (signature.length !== 65) return null;
  const recovery = signature[64] === 27 || signature[64] === 28 ? signature[64] - 27 : signature[64];
  if (recovery !== 0 && recovery !== 1) return null;

  let r = 0n;
  let s = 0n;
  for (const byte of signature.slice(0, 32)) r = (r << 8n) | BigInt(byte);
  for (const byte of signature.slice(32, 64)) s = (s << 8n) | BigInt(byte);
  if (r === 0n || r >= SECP256K1_ORDER || s === 0n || s >= SECP256K1_ORDER) return null;

  const canonical = signature.slice();
  if (s > SECP256K1_HALF_ORDER) {
    s = SECP256K1_ORDER - s;
    canonical[64] = recovery ^ 1;
  } else {
    canonical[64] = recovery;
  }
  for (let index = 63; index >= 32; index -= 1) {
    canonical[index] = Number(s & 0xffn);
    s >>= 8n;
  }
  return canonical;
}

type VerifiedPolkadotSignature = {
  scheme: PolkadotSignatureScheme;
  signature: Uint8Array;
  messageMode: "raw" | "bytes-wrapper";
};

function verifyWalletSignature(
  message: Uint8Array,
  signature: Uint8Array,
  accountId: Uint8Array,
  preferredScheme?: string,
): VerifiedPolkadotSignature | null {
  const available: PolkadotSignatureScheme[] = signature.length === 64
    ? ["ed25519", "sr25519"]
    : signature.length === 65
      ? ["ecdsa"]
      : [];
  const schemes = preferredScheme && available.includes(preferredScheme as PolkadotSignatureScheme)
    ? [preferredScheme as PolkadotSignatureScheme, ...available.filter((scheme) => scheme !== preferredScheme)]
    : available;

  for (const scheme of schemes) {
    const canonicalSignature = scheme === "ecdsa" ? canonicalizeEcdsaSignature(signature) : signature;
    if (!canonicalSignature) continue;
    const candidates = [
      ["raw", message],
      ["bytes-wrapper", wrappedSignRawMessage(message)],
    ] as const;
    for (const [messageMode, candidate] of candidates) {
      try {
        const valid = scheme === "ed25519"
          ? ed25519Verify(candidate, canonicalSignature, accountId)
          : scheme === "sr25519"
            ? sr25519Verify(candidate, canonicalSignature, accountId)
            : secp256k1Verify(candidate, canonicalSignature, accountId, "blake2", true);
        if (valid) return { scheme, signature: canonicalSignature, messageMode };
      } catch {
        // Try the other supported signRaw representation and scheme.
      }
    }
  }
  return null;
}

function createPolkadotOwnershipSigner(
  account: PolkadotBrowserAccount,
  accountId: Uint8Array,
  signRaw: NonNullable<PolkadotInjector["signer"]["signRaw"]>,
): OwnershipSigner {
  const ownership: Ownership = {
    version: 1,
    kind: OWNERSHIP_KIND.MULTICRYPTO_ACCOUNT32,
    public: accountId.slice(),
  };

  return {
    async getController() {
      return asOwnership(ownership);
    },
    async signJamScriptAction(request) {
      const result = await signRaw({ address: account.address, data: bytesToHex(request.message), type: "bytes" });
      let signature: Uint8Array;
      try {
        signature = hexToBytes(result.signature);
      } catch (cause) {
        console.info("[Locus Polkadot signRaw diagnostic]", {
          timestamp: new Date().toISOString(),
          address: account.address,
          accountIdHex: bytesToHex(accountId),
          walletScheme: account.type ?? null,
          messageHex: bytesToHex(request.message),
          messageText: new TextDecoder().decode(request.message),
          signatureHex: result.signature,
          localVerification: "failed",
          verificationError: cause instanceof Error ? cause.message : String(cause),
        });
        throw cause;
      }
      const verified = verifyWalletSignature(request.message, signature, accountId, account.type);
      const authorizationProof = verified
        ? Uint8Array.of(POLKADOT_SCHEME_PREFIX[verified.scheme], ...verified.signature)
        : null;
      console.info("[Locus Polkadot signRaw diagnostic]", {
        timestamp: new Date().toISOString(),
        address: account.address,
        accountIdHex: bytesToHex(accountId),
        walletScheme: account.type ?? null,
        messageHex: bytesToHex(request.message),
        messageText: new TextDecoder().decode(request.message),
        signatureLength: signature.length,
        signatureHex: bytesToHex(signature),
        localVerification: verified ? "passed" : "failed",
        verifiedScheme: verified?.scheme ?? null,
        verifiedMessageMode: verified?.messageMode ?? null,
        authorizationProofHex: authorizationProof ? bytesToHex(authorizationProof) : null,
      });
      if (!verified) {
        throw new Error(`The wallet signature (${account.type ?? "unknown scheme"}, ${signature.length} bytes) does not match this SS58 account. No transaction was submitted; reconnect the account or choose another wallet.`);
      }
      return authorizationProof!;
    },
  };
}

export function polkadotAccountOptions(accounts: readonly PolkadotBrowserAccount[]): BrowserAccountOption[] {
  return accounts.map((account) => ({
    id: account.address,
    label: account.meta?.name ?? account.name ?? shortAddress(account.address),
    description: `${account.meta?.source ?? "Polkadot extension"} · ${account.type ?? "scheme unavailable"}`,
  }));
}

export function requirePolkadotAccount(accounts: readonly PolkadotBrowserAccount[], address: string): PolkadotBrowserAccount {
  const selected = accounts.find((account) => account.address === address);
  if (!selected) throw new Error("The selected Polkadot account is no longer available.");
  return selected;
}

export async function connectPolkadotAccount(account: PolkadotBrowserAccount, injector: PolkadotInjector): Promise<LocusWebSession> {
  if (!injector.signer.signRaw) throw new Error("The selected Polkadot extension cannot sign raw messages.");
  const accountId = decodePolkadotAccountId(account.address);
  if (account.publicKey?.length === 32 && account.publicKey.some((byte, index) => byte !== accountId[index])) {
    throw new Error("The Polkadot extension returned an account key that does not match its SS58 address.");
  }
  const signer = createPolkadotOwnershipSigner(account, accountId, injector.signer.signRaw);
  const controller = asOwnership(await signer.getController());
  return {
    kind: "polkadot",
    owner: controller,
    controller,
    ownershipSession: { signer, subject: controller },
    label: `Polkadot ${shortAddress(account.address)}`,
    address: account.address,
    connectionId: account.address,
  };
}

export async function switchPolkadotSession(
  current: LocusWebSession,
  address: string,
  getCurrent: () => LocusWebSession | null,
  prepare: (address: string) => Promise<LocusWebSession>,
  commit: (session: LocusWebSession) => void,
): Promise<void> {
  if (current.kind !== "polkadot") throw new Error("Only a Polkadot session can switch Polkadot accounts.");
  if (current.address === address) return;
  const next = await prepare(address);
  if (next.kind !== "polkadot" || next.address !== address) {
    try { next.cleanup?.(); } catch { /* Keep the current session if a mismatched account was prepared. */ }
    throw new Error("The extension did not create a session for the selected account.");
  }
  if (getCurrent() !== current) {
    try { next.cleanup?.(); } catch { /* Do not replace a session that changed while the signer was prepared. */ }
    throw new Error("The current account changed before the new signer was ready. The existing session was kept.");
  }
  commit(next);
}
