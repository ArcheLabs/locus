import {
  EvmOwnershipSigner,
  PolkadotOwnershipSigner,
  SolanaOwnershipSigner,
  decodePolkadotAccountId,
  type Ownership,
  type Eip1193Provider,
} from "@jamscript/client";
import { SolanaSignMessage, type SolanaSignMessageFeature } from "@solana/wallet-standard-features";
import type { Wallet, WalletAccount } from "@wallet-standard/base";
import type { LocusWebSession, SessionKind } from "./types.js";

type PolkadotAccount = {
  address: string;
  publicKey?: Uint8Array;
  type?: string;
  name?: string;
  meta?: { name?: string };
};

type PolkadotInjection = {
  accounts: { get(): Promise<readonly PolkadotAccount[]> };
  signer: { signRaw(input: { address: string; data: string; type: "bytes" }): Promise<{ signature: string }> };
};

type WindowWithWallets = Window & {
  ethereum?: Eip1193Provider;
  injectedWeb3?: Record<string, { enable(name: string): Promise<PolkadotInjection> }>;
};

type StandardConnectFeature = {
  connect(options?: { silent?: boolean }): Promise<{ accounts: readonly WalletAccount[] }>;
};

function browserWindow(): WindowWithWallets {
  if (typeof window === "undefined") throw new Error("browser wallet access is unavailable");
  return window as WindowWithWallets;
}

function shortAddress(value: string): string {
  return value.length > 14 ? `${value.slice(0, 8)}…${value.slice(-6)}` : value;
}

function asOwnership(value: Ownership): Ownership {
  return { ...value, public: value.public.slice() };
}

export type ConnectorInfo = {
  kind: SessionKind;
  label: string;
  description: string;
};

export const connectorInfo: readonly ConnectorInfo[] = [
  { kind: "evm", label: "EVM wallet", description: "Sign with an injected EIP-1193 wallet" },
  { kind: "polkadot", label: "Polkadot extension", description: "Use an injected Polkadot account" },
  { kind: "solana", label: "Solana wallet", description: "Use a Wallet Standard message signer" },
];

export function hasEvmWallet(): boolean {
  return Boolean(browserWindow().ethereum);
}

export function hasPolkadotWallet(): boolean {
  return Object.keys(browserWindow().injectedWeb3 ?? {}).length > 0;
}

async function connectEvm(): Promise<LocusWebSession> {
  const provider = browserWindow().ethereum;
  if (!provider) throw new Error("No EVM wallet was detected in this browser.");
  const result = await provider.request({ method: "eth_requestAccounts" });
  const accounts = Array.isArray(result) ? result.filter((value): value is string => typeof value === "string") : [];
  const address = accounts[0];
  if (!address) throw new Error("The EVM wallet did not return an account.");
  const signer = new EvmOwnershipSigner(provider, address);
  return {
    kind: "evm",
    owner: asOwnership(await signer.getController()),
    ownershipSession: { signer },
    label: `EVM ${shortAddress(address)}`,
    address,
  };
}

function polkadotScheme(account: PolkadotAccount): "ed25519" | "sr25519" | "ecdsa" {
  if (account.type === "ed25519" || account.type === "sr25519" || account.type === "ecdsa") return account.type;
  return "sr25519";
}

async function connectPolkadot(): Promise<LocusWebSession> {
  const extensions = Object.values(browserWindow().injectedWeb3 ?? {});
  if (extensions.length === 0) throw new Error("No Polkadot extension was detected in this browser.");
  const injection = await extensions[0].enable("Locus");
  const accounts = await injection.accounts.get();
  const account = accounts[0];
  if (!account) throw new Error("The Polkadot extension did not return an account.");
  const accountId = account.publicKey ? Uint8Array.from(account.publicKey) : decodePolkadotAccountId(account.address);
  const signer = new PolkadotOwnershipSigner({
    accountId,
    address: account.address,
    scheme: polkadotScheme(account),
    signer: injection.signer,
  });
  return {
    kind: "polkadot",
    owner: asOwnership(await signer.getController()),
    ownershipSession: { signer },
    label: `Polkadot ${shortAddress(account.address)}`,
    address: account.address,
  };
}

function discoverStandardWallets(): Promise<Wallet[]> {
  const found: Wallet[] = [];
  const register = (wallet: Wallet): (() => void) => {
    if (!found.some((entry) => entry === wallet || entry.name === wallet.name)) found.push(wallet);
    return () => {
      const index = found.indexOf(wallet);
      if (index >= 0) found.splice(index, 1);
    };
  };
  const onRegister = (event: Event) => {
    const callback = (event as CustomEvent<(api: { register(wallet: Wallet): () => void }) => void>).detail;
    if (typeof callback === "function") callback({ register });
  };
  const target = browserWindow();
  target.addEventListener("wallet-standard:register-wallet", onRegister);
  target.dispatchEvent(new CustomEvent("wallet-standard:app-ready", { detail: { register } }));
  const legacyWallets = (target.navigator as Navigator & { wallets?: { push(callback: (api: { register(...wallets: Wallet[]): void }) => void): void } }).wallets;
  legacyWallets?.push((api) => api.register(...found));
  return new Promise((resolve) => {
    window.setTimeout(() => {
      target.removeEventListener("wallet-standard:register-wallet", onRegister);
      resolve(found);
    }, 50);
  });
}

async function connectSolana(): Promise<LocusWebSession> {
  const wallets = await discoverStandardWallets();
  const wallet = wallets.find((candidate) => {
    const hasSolanaChain = candidate.chains.some((chain) => chain.startsWith("solana:"));
    return hasSolanaChain || Boolean(candidate.features[SolanaSignMessage]);
  });
  if (!wallet) throw new Error("No Solana Wallet Standard wallet was detected in this browser.");
  let account = wallet.accounts.find((candidate) => candidate.chains.some((chain) => chain.startsWith("solana:")));
  if (!account) {
    const connect = wallet.features["standard:connect"] as StandardConnectFeature | undefined;
    if (!connect) throw new Error("The Solana wallet does not expose a connect feature.");
    const result = await connect.connect({ silent: false });
    account = result.accounts.find((candidate) => candidate.chains.some((chain) => chain.startsWith("solana:")));
  }
  if (!account) throw new Error("The Solana wallet did not return an account.");
  const signMessage = wallet.features[SolanaSignMessage] as SolanaSignMessageFeature | undefined;
  if (!signMessage) throw new Error("The Solana wallet does not support message signing.");
  const signer = new SolanaOwnershipSigner(account, signMessage);
  return {
    kind: "solana",
    owner: asOwnership(await signer.getController()),
    ownershipSession: { signer },
    label: `Solana ${shortAddress(account.address)}`,
    address: account.address,
  };
}

export async function connectBrowserSession(kind: SessionKind): Promise<LocusWebSession> {
  if (kind === "evm") return connectEvm();
  if (kind === "polkadot") return connectPolkadot();
  return connectSolana();
}
