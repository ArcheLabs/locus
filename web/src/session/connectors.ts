import { web3Accounts, web3AccountsSubscribe, web3Enable, web3FromAddress } from "@polkadot/extension-dapp";
import { getWallets } from "@wallet-standard/app";
import {
  EvmOwnershipSigner,
  SolanaOwnershipSigner,
  type Ownership,
  type Eip1193Provider,
} from "@jamscript/client";
import { SolanaSignMessage, type SolanaSignMessageFeature } from "@solana/wallet-standard-features";
import type { Wallet, WalletAccount } from "@wallet-standard/base";
import type { LocusWebSession, SessionKind } from "./types.js";
import { connectPolkadotAccount, polkadotAccountOptions, requirePolkadotAccount, type BrowserAccountOption, type PolkadotBrowserAccount } from "./polkadotSession.js";
export { connectPolkadotAccount, polkadotAccountOptions, requirePolkadotAccount } from "./polkadotSession.js";
export type { BrowserAccountOption, PolkadotBrowserAccount } from "./polkadotSession.js";

type WindowWithEthereum = Window & { ethereum?: Eip1193Provider };

type StandardConnectFeature = {
  connect(options?: { silent?: boolean }): Promise<{ accounts: readonly WalletAccount[] }>;
};

type EventProvider = Eip1193Provider & {
  on?: (event: string, listener: (...args: unknown[]) => void) => void;
  removeListener?: (event: string, listener: (...args: unknown[]) => void) => void;
};

function browserWindow(): WindowWithEthereum {
  if (typeof window === "undefined") throw new Error("browser wallet access is unavailable");
  return window as WindowWithEthereum;
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
  { kind: "polkadot", label: "Polkadot extension", description: "Choose an account from an enabled extension" },
  { kind: "solana", label: "Solana wallet", description: "Choose a Wallet Standard message signer" },
];

export function hasEvmWallet(): boolean {
  return Boolean(browserWindow().ethereum);
}

export function hasSolanaWallet(): boolean {
  return getWallets().get().some((wallet) => wallet.chains.some((chain) => chain.startsWith("solana:")) || Boolean(wallet.features[SolanaSignMessage]));
}

async function evmAccounts(): Promise<BrowserAccountOption[]> {
  const provider = browserWindow().ethereum;
  if (!provider) throw new Error("No EVM wallet was detected in this browser.");
  const result = await provider.request({ method: "eth_requestAccounts" });
  const accounts = Array.isArray(result) ? result.filter((value): value is string => typeof value === "string") : [];
  return accounts.map((address) => ({ id: address, label: shortAddress(address), description: address }));
}

async function polkadotAccounts(): Promise<{ account: PolkadotBrowserAccount; option: BrowserAccountOption }[]> {
  const extensions = await web3Enable("Locus");
  if (extensions.length === 0) throw new Error("No Polkadot extension was detected in this browser.");
  const accounts = await web3Accounts() as PolkadotBrowserAccount[];
  const options = polkadotAccountOptions(accounts);
  return accounts.map((account) => ({
    account,
    option: options.find((option) => option.id === account.address)!,
  }));
}

function solanaWallets(): readonly Wallet[] {
  return getWallets().get().filter((wallet) => wallet.chains.some((chain) => chain.startsWith("solana:")) || Boolean(wallet.features[SolanaSignMessage]));
}

function walletAccountOption(wallet: Wallet, account: WalletAccount): BrowserAccountOption {
  return {
    id: `${wallet.name}::${account.address}`,
    label: account.label || wallet.name,
    description: `${wallet.name} · ${shortAddress(account.address)}`,
  };
}

async function solanaAccounts(): Promise<BrowserAccountOption[]> {
  const options: BrowserAccountOption[] = [];
  for (const wallet of solanaWallets()) {
    const accounts = wallet.accounts.filter((account) => account.chains.some((chain) => chain.startsWith("solana:")));
    if (accounts.length > 0) {
      options.push(...accounts.map((account) => walletAccountOption(wallet, account)));
      continue;
    }
    if (wallet.features["standard:connect"]) {
      options.push({ id: `${wallet.name}::connect`, label: wallet.name, description: "Connect this wallet" });
    }
  }
  if (options.length === 0) throw new Error("No Solana Wallet Standard wallet was detected in this browser.");
  return options;
}

export async function listBrowserAccounts(kind: SessionKind): Promise<BrowserAccountOption[]> {
  if (kind === "matrix") throw new Error("Matrix uses its login dialog rather than a browser wallet account picker.");
  if (kind === "evm") return evmAccounts();
  if (kind === "polkadot") return (await polkadotAccounts()).map(({ option }) => option);
  return solanaAccounts();
}

async function connectEvm(selectedId: string): Promise<LocusWebSession> {
  const provider = browserWindow().ethereum;
  if (!provider) throw new Error("No EVM wallet was detected in this browser.");
  const accounts = await evmAccounts();
  const address = accounts.find((account) => account.id === selectedId)?.id ?? selectedId;
  if (!address) throw new Error("The EVM wallet did not return an account.");
  const signer = new EvmOwnershipSigner(provider, address);
  return {
    kind: "evm",
    owner: asOwnership(await signer.getController()),
    controller: asOwnership(await signer.getController()),
    ownershipSession: { signer, subject: asOwnership(await signer.getController()) },
    label: `EVM ${shortAddress(address)}`,
    address,
    connectionId: address,
  };
}

export async function connectEvmProvider(provider: Eip1193Provider, address: string): Promise<LocusWebSession> {
  if (!/^0x[0-9a-f]{40}$/i.test(address)) throw new Error("The EVM wallet returned an invalid account.");
  const signer = new EvmOwnershipSigner(provider, address);
  const controller = asOwnership(await signer.getController());
  return {
    kind: "evm",
    owner: controller,
    controller,
    ownershipSession: { signer, subject: controller },
    label: `EVM ${shortAddress(address)}`,
    address,
    connectionId: address,
  };
}

async function connectPolkadot(selectedId: string): Promise<LocusWebSession> {
  const accounts = await polkadotAccounts();
  const account = requirePolkadotAccount(accounts.map(({ account }) => account), selectedId);
  return connectPolkadotAccount(account, await web3FromAddress(account.address));
}

async function connectSolana(selectedId: string): Promise<LocusWebSession> {
  const separator = selectedId.indexOf("::");
  const walletName = separator < 0 ? selectedId : selectedId.slice(0, separator);
  const requestedAddress = separator < 0 ? "" : selectedId.slice(separator + 2);
  const wallet = solanaWallets().find((candidate) => candidate.name === walletName);
  if (!wallet) throw new Error("The selected Solana wallet is no longer available.");
  let account = wallet.accounts.find((candidate) => candidate.address === requestedAddress);
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
    controller: asOwnership(await signer.getController()),
    ownershipSession: { signer, subject: asOwnership(await signer.getController()) },
    label: `Solana ${shortAddress(account.address)}`,
    address: account.address,
    connectionId: `${wallet.name}::${account.address}`,
  };
}

export async function connectBrowserSession(kind: SessionKind, selectedId: string): Promise<LocusWebSession> {
  if (kind === "matrix") throw new Error("Matrix sessions must be created through the Matrix login dialog.");
  if (kind === "evm") return connectEvm(selectedId);
  if (kind === "polkadot") return connectPolkadot(selectedId);
  return connectSolana(selectedId);
}

/** Restore only an account that a wallet has already exposed to this origin. */
export async function restoreBrowserSession(kind: Exclude<SessionKind, "matrix">, selectedId: string): Promise<LocusWebSession> {
  if (kind === "evm") {
    const provider = browserWindow().ethereum;
    if (!provider) throw new Error("The saved EVM wallet is not available.");
    const result = await provider.request({ method: "eth_accounts" });
    const address = Array.isArray(result) ? result.find((value) => typeof value === "string" && value.toLowerCase() === selectedId.toLowerCase()) : undefined;
    if (typeof address !== "string") throw new Error("The saved EVM account is not connected to this site.");
    return connectEvmProvider(provider, address);
  }
  if (kind === "polkadot") {
    const accounts = await polkadotAccounts();
    let account: PolkadotBrowserAccount;
    try { account = requirePolkadotAccount(accounts.map(({ account }) => account), selectedId); }
    catch { throw new Error("The saved Polkadot account is not enabled for this site."); }
    return connectPolkadotAccount(account, await web3FromAddress(account.address));
  }
  const separator = selectedId.indexOf("::");
  const walletName = separator < 0 ? selectedId : selectedId.slice(0, separator);
  const requestedAddress = separator < 0 ? "" : selectedId.slice(separator + 2);
  const wallet = solanaWallets().find((candidate) => candidate.name === walletName);
  const account = wallet?.accounts.find((candidate) => candidate.address === requestedAddress);
  const signMessage = wallet?.features[SolanaSignMessage] as SolanaSignMessageFeature | undefined;
  if (!wallet || !account || !signMessage) throw new Error("The saved Solana wallet account is not available.");
  const signer = new SolanaOwnershipSigner(account, signMessage);
  const controller = asOwnership(await signer.getController());
  return { kind: "solana", owner: controller, controller, ownershipSession: { signer, subject: controller }, label: `Solana ${shortAddress(account.address)}`, address: account.address, connectionId: selectedId };
}

/** Keep a connected browser session from signing with an account that the wallet has replaced. */
export function watchBrowserSession(session: LocusWebSession, onAccountChanged: (address: string | null) => void): () => void {
  if (session.kind === "evm") {
    const provider = browserWindow().ethereum as EventProvider | undefined;
    if (!provider?.on) return () => undefined;
    const listener = (...args: unknown[]) => {
      const accounts = Array.isArray(args[0]) ? args[0].filter((value): value is string => typeof value === "string") : [];
      onAccountChanged(accounts[0] ?? null);
    };
    provider.on("accountsChanged", listener);
    return () => provider.removeListener?.("accountsChanged", listener);
  }
  if (session.kind === "polkadot") {
    let stopped = false;
    let unsubscribe: (() => void) | undefined;
    void web3Enable("Locus").then(() => web3AccountsSubscribe((accounts) => {
      if (stopped) return;
      const selected = (accounts as PolkadotBrowserAccount[]).some((account) => account.address === session.address);
      onAccountChanged(selected ? session.address : null);
    })).then((off) => {
      if (stopped) off();
      else unsubscribe = off;
    }).catch(() => onAccountChanged(null));
    return () => { stopped = true; unsubscribe?.(); };
  }
  if (session.kind === "solana") {
    const separator = session.connectionId?.indexOf("::") ?? -1;
    const walletName = separator < 0 ? "" : session.connectionId!.slice(0, separator);
    const wallet = solanaWallets().find((candidate) => candidate.name === walletName);
    const events = wallet?.features["standard:events"] as { on?: (event: "change", listener: (properties: { accounts?: readonly WalletAccount[] }) => void) => () => void } | undefined;
    if (!events?.on) return () => undefined;
    return events.on("change", (properties) => {
      const selected = properties.accounts?.some((account) => account.address === session.address) ?? false;
      onAccountChanged(selected ? session.address : null);
    });
  }
  return () => undefined;
}
