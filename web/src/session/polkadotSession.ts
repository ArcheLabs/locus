import {
  PolkadotOwnershipSigner,
  decodePolkadotAccountId,
  type Ownership,
} from "@jamscript/client";
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

function polkadotScheme(account: PolkadotBrowserAccount): "ed25519" | "sr25519" | "ecdsa" {
  if (account.type === "ed25519" || account.type === "sr25519" || account.type === "ecdsa") return account.type;
  throw new Error("The Polkadot extension did not provide a supported signature scheme for this account.");
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
  const accountId = account.publicKey ? Uint8Array.from(account.publicKey) : decodePolkadotAccountId(account.address);
  const signer = new PolkadotOwnershipSigner({
    accountId,
    address: account.address,
    scheme: polkadotScheme(account),
    signer: { signRaw: (input) => injector.signer.signRaw!(input) },
  });
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
