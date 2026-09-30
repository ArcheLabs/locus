import type { Eip1193Provider } from "@jamscript/client";
import type { LocusWebSession } from "./types.js";

type EvmEventProvider = Eip1193Provider & {
  on?: (event: string, listener: (...args: unknown[]) => void) => void;
  removeListener?: (event: string, listener: (...args: unknown[]) => void) => void;
};

type EventSource = Pick<EventTarget, "addEventListener" | "removeEventListener">;
type AccountHint = { address: string; revision: number };
const ACCOUNT_QUERY_TIMEOUT_MS = 2_500;
const EXISTING_ACCOUNT_FAST_PATH_MS = 650;

export type EvmSessionBridgeOptions = {
  getSession: () => LocusWebSession | null;
  commitSession: (session: LocusWebSession) => void;
  clearSession: () => void;
  createSession: (provider: Eip1193Provider, address: string) => Promise<LocusWebSession>;
  onError?: (error: Error) => void;
};

function isAddress(value: unknown): value is string {
  return typeof value === "string" && /^0x[0-9a-f]{40}$/i.test(value);
}

export function selectExposedEvmAccount(accounts: readonly unknown[], hint?: string | null, expected?: string | null): string | null {
  const exposed = accounts.filter(isAddress);
  if (expected) return exposed.find((address) => address.toLowerCase() === expected.toLowerCase()) ?? null;
  if (hint) {
    const matching = exposed.find((address) => address.toLowerCase() === hint.toLowerCase());
    if (matching) return matching;
  }
  return exposed.length === 1 ? exposed[0] : null;
}

export class EvmSessionBridge {
  private provider: EvmEventProvider | null = null;
  private committedProvider: EvmEventProvider | null = null;
  private verifiedAddress: string | null = null;
  private appKitHint: AccountHint | null = null;
  private providerHint: AccountHint | null = null;
  private hintRevision = 0;
  private selectionRevision = 0;
  private expectedAddress: string | null = null;
  private pending = false;
  private disposed = false;
  private inFlight: Promise<void> | null = null;
  private reconcileAgain = false;
  private successfulCommits = 0;
  private windowSource: EventSource | null = null;
  private documentSource: EventSource | null = null;
  private providerListeners: Array<[string, (...args: unknown[]) => void]> = [];
  private readonly options: EvmSessionBridgeOptions;

  constructor(options: EvmSessionBridgeOptions) {
    this.options = options;
  }

  start(windowSource?: EventSource, documentSource?: EventSource): () => void {
    // React StrictMode may exercise setup → cleanup → setup in development.
    this.disposed = false;
    this.windowSource = windowSource ?? null;
    this.documentSource = documentSource ?? null;
    this.windowSource?.addEventListener("focus", this.onForeground);
    this.windowSource?.addEventListener("pageshow", this.onForeground);
    this.documentSource?.addEventListener("visibilitychange", this.onVisibilityChange);
    return () => {
      this.disposed = true;
      this.windowSource?.removeEventListener("focus", this.onForeground);
      this.windowSource?.removeEventListener("pageshow", this.onForeground);
      this.documentSource?.removeEventListener("visibilitychange", this.onVisibilityChange);
      this.bindProvider(null);
    };
  }

  updateAppKit(provider: Eip1193Provider | undefined, address: string | undefined): void {
    const nextProvider = provider as EvmEventProvider | undefined;
    if (nextProvider !== this.provider) this.bindProvider(nextProvider ?? null);
    const nextAddress = isAddress(address) ? address : null;
    const previousAddress = this.appKitHint?.address ?? null;
    if (nextAddress?.toLowerCase() !== previousAddress?.toLowerCase()) {
      this.selectionRevision += 1;
      this.appKitHint = nextAddress ? { address: nextAddress, revision: ++this.hintRevision } : null;
    }
    void this.reconcile();
  }

  async beginConnection(): Promise<boolean> {
    this.pending = true;
    this.expectedAddress = null;
    this.verifiedAddress = null;
    const commitsBefore = this.successfulCommits;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    const fastPathMs = this.appKitHint ? ACCOUNT_QUERY_TIMEOUT_MS + 150 : EXISTING_ACCOUNT_FAST_PATH_MS;
    await Promise.race([
      this.reconcile(),
      new Promise<void>((resolve) => { timeout = setTimeout(resolve, fastPathMs); }),
    ]);
    if (timeout !== undefined) clearTimeout(timeout);
    const current = this.options.getSession();
    return this.successfulCommits > commitsBefore
      || (current?.kind === "evm" && this.hasVerifiedAddress(current.address));
  }

  beginRestore(address: string): void {
    this.pending = true;
    this.expectedAddress = address;
    void this.reconcile();
  }

  cancelConnection(): void {
    this.pending = false;
    this.expectedAddress = null;
    this.selectionRevision += 1;
  }

  explicitDisconnect(): void {
    this.pending = false;
    this.expectedAddress = null;
    this.committedProvider = null;
    this.verifiedAddress = null;
    this.selectionRevision += 1;
    this.options.clearSession();
  }

  reconcile(): Promise<void> {
    if (this.disposed || (!this.pending && this.options.getSession()?.kind !== "evm")) return Promise.resolve();
    if (this.inFlight) {
      this.reconcileAgain = true;
      return this.inFlight;
    }
    this.inFlight = (async () => {
      do {
        this.reconcileAgain = false;
        await this.reconcileOnce();
      } while (this.reconcileAgain && !this.disposed);
    })().finally(() => { this.inFlight = null; });
    return this.inFlight;
  }

  private async reconcileOnce(): Promise<void> {
    const provider = this.provider;
    if (!provider) return;
    const revision = this.selectionRevision;
    const baseline = this.options.getSession();
    let exposed: string[];
    try {
      exposed = await this.readExposedAccounts(provider);
    } catch (cause) {
      if (provider !== this.provider || this.disposed || revision !== this.selectionRevision) return;
      const current = this.options.getSession();
      if (this.pending && this.expectedAddress) {
        this.options.onError?.(cause instanceof Error ? cause : new Error("Could not read accounts from the connected EVM wallet."));
      } else if (current?.kind === "evm" && this.hasDifferentHint(current.address)) {
        this.options.onError?.(new Error(`Could not switch account. ${cause instanceof Error ? cause.message : "The wallet did not return its accounts."}`));
      }
      return;
    }
    if (provider !== this.provider || this.disposed) return;
    if (revision !== this.selectionRevision) {
      this.reconcileAgain = true;
      return;
    }

    const current = this.options.getSession();
    if (current?.kind === "evm") {
      const target = this.targetAddress(exposed, current.address);
      if (target && target.toLowerCase() !== current.address.toLowerCase()) {
        if (!exposed.some((address) => address.toLowerCase() === target.toLowerCase())) return;
        await this.commitConfirmedAddress(provider, target, revision, current);
        return;
      }
      if (exposed.some((address) => address.toLowerCase() === current.address.toLowerCase())) {
        if (this.committedProvider === provider) {
          this.verifiedAddress = current.address;
          return;
        }
        await this.commitConfirmedAddress(provider, current.address, revision, current);
        return;
      }
      if (target && target.toLowerCase() !== current.address.toLowerCase()) return;
      if (exposed.length > 0) this.invalidateConfirmedSession();
      return;
    }

    if (!this.pending) return;
    if (this.expectedAddress) {
      if (exposed.length > 0 && !exposed.some((address) => address.toLowerCase() === this.expectedAddress!.toLowerCase())) {
        this.invalidateConfirmedSession();
        return;
      }
      const address = selectExposedEvmAccount(exposed, this.latestHint()?.address, this.expectedAddress);
      if (address) await this.commitConfirmedAddress(provider, address, revision, baseline);
      return;
    }
    const address = selectExposedEvmAccount(exposed, this.latestHint()?.address);
    if (address) await this.commitConfirmedAddress(provider, address, revision, baseline);
  }

  private async commitConfirmedAddress(provider: EvmEventProvider, address: string, revision: number, baseline: LocusWebSession | null): Promise<void> {
    let next: LocusWebSession;
    try {
      next = await this.options.createSession(provider, address);
    } catch (cause) {
      if (this.isCommitCurrent(provider, revision, baseline)) {
        const detail = cause instanceof Error ? cause.message : "The wallet session could not be created.";
        const current = this.options.getSession();
        this.options.onError?.(current?.kind === "evm" && current.address.toLowerCase() !== address.toLowerCase()
          ? new Error(`Could not switch account. ${detail}`)
          : cause instanceof Error ? cause : new Error("EVM wallet connection failed."));
      }
      return;
    }

    if (!this.isCommitCurrent(provider, revision, baseline)) {
      try { next.cleanup?.(); } catch { /* Discard stale signer sessions. */ }
      if (provider === this.provider && !this.disposed && revision !== this.selectionRevision) this.reconcileAgain = true;
      return;
    }

    let confirmed: string[];
    try {
      confirmed = await this.readExposedAccounts(provider);
    } catch (cause) {
      try { next.cleanup?.(); } catch { /* Keep the existing session if confirmation failed. */ }
      if (this.isCommitCurrent(provider, revision, baseline)) {
        const detail = cause instanceof Error ? cause.message : "The wallet did not return its accounts.";
        const current = this.options.getSession();
        this.options.onError?.(current?.kind === "evm" && current.address.toLowerCase() !== address.toLowerCase()
          ? new Error(`Could not switch account. ${detail}`)
          : cause instanceof Error ? cause : new Error("The EVM wallet account could not be confirmed."));
      }
      return;
    }
    if (!this.isCommitCurrent(provider, revision, baseline)) {
      try { next.cleanup?.(); } catch { /* Discard stale signer sessions. */ }
      if (provider === this.provider && !this.disposed && revision !== this.selectionRevision) this.reconcileAgain = true;
      return;
    }
    if (!confirmed.some((candidate) => candidate.toLowerCase() === address.toLowerCase())) {
      try { next.cleanup?.(); } catch { /* The wallet changed during session creation. */ }
      this.reconcileAgain = true;
      return;
    }

    this.options.commitSession(next);
    this.committedProvider = provider;
    this.verifiedAddress = address;
    this.successfulCommits += 1;
    this.pending = false;
    this.expectedAddress = null;
  }

  private async readExposedAccounts(provider: EvmEventProvider): Promise<string[]> {
    let timeout: ReturnType<typeof setTimeout> | undefined;
    let result: { timedOut: false; value: unknown } | { timedOut: true };
    try {
      result = await Promise.race([
        provider.request({ method: "eth_accounts" }).then((value) => ({ timedOut: false as const, value })),
        new Promise<{ timedOut: true }>((resolve) => {
          timeout = setTimeout(() => resolve({ timedOut: true }), ACCOUNT_QUERY_TIMEOUT_MS);
        }),
      ]);
    } finally {
      if (timeout !== undefined) clearTimeout(timeout);
    }
    if (result.timedOut) throw new Error("The EVM wallet did not respond while checking its accounts.");
    return Array.isArray(result.value) ? result.value.filter(isAddress) : [];
  }

  private isCommitCurrent(provider: EvmEventProvider, revision: number, baseline: LocusWebSession | null): boolean {
    return !this.disposed && provider === this.provider && revision === this.selectionRevision && this.options.getSession() === baseline;
  }

  private targetAddress(exposed: readonly string[], currentAddress: string): string | null {
    const hints = [this.appKitHint, this.providerHint].filter((hint): hint is AccountHint => hint !== null);
    const matching = hints.filter((hint) => exposed.some((address) => address.toLowerCase() === hint.address.toLowerCase()));
    const alternatives = matching.filter((hint) => hint.address.toLowerCase() !== currentAddress.toLowerCase());
    if (alternatives.length > 0) return alternatives.sort((a, b) => b.revision - a.revision)[0].address;
    if (exposed.some((address) => address.toLowerCase() === currentAddress.toLowerCase())) return currentAddress;

    const pendingAlternatives = hints.filter((hint) => hint.address.toLowerCase() !== currentAddress.toLowerCase());
    if (pendingAlternatives.length > 0) return pendingAlternatives.sort((a, b) => b.revision - a.revision)[0].address;
    return null;
  }

  private latestHint(): AccountHint | null {
    if (!this.appKitHint) return this.providerHint;
    if (!this.providerHint) return this.appKitHint;
    return this.appKitHint.revision > this.providerHint.revision ? this.appKitHint : this.providerHint;
  }

  private hasDifferentHint(address: string): boolean {
    return [this.appKitHint, this.providerHint].some((hint) => hint && hint.address.toLowerCase() !== address.toLowerCase());
  }

  private invalidateConfirmedSession(): void {
    const hadSession = this.options.getSession()?.kind === "evm";
    const restoringSavedSession = this.pending && this.expectedAddress !== null;
    this.pending = false;
    this.expectedAddress = null;
    this.committedProvider = null;
    this.verifiedAddress = null;
    if (hadSession || restoringSavedSession) this.options.clearSession();
  }

  private hasVerifiedAddress(address: string): boolean {
    return this.verifiedAddress?.toLowerCase() === address.toLowerCase();
  }

  private readonly onForeground = (): void => {
    if (!this.documentSource || (this.documentSource as Document).visibilityState === "visible") void this.reconcile();
  };

  private readonly onVisibilityChange = (): void => {
    if ((this.documentSource as Document | null)?.visibilityState === "visible") void this.reconcile();
  };

  private bindProvider(provider: EvmEventProvider | null): void {
    if (this.provider) {
      for (const [event, listener] of this.providerListeners) this.provider.removeListener?.(event, listener);
    }
    this.provider = provider;
    this.providerHint = null;
    this.verifiedAddress = null;
    this.selectionRevision += 1;
    this.providerListeners = [];
    if (!provider?.on) return;
    const accountsChanged = (...args: unknown[]) => {
      if (provider !== this.provider || this.disposed) return;
      const accounts = Array.isArray(args[0]) ? args[0].filter(isAddress) : [];
      this.selectionRevision += 1;
      this.providerHint = accounts[0] ? { address: accounts[0], revision: ++this.hintRevision } : null;
      if (accounts.length === 0) {
        this.invalidateConfirmedSession();
        return;
      }
      void this.reconcile();
    };
    const connected = () => { if (provider === this.provider && !this.disposed) void this.reconcile(); };
    const disconnected = () => {
      if (provider !== this.provider || this.disposed) return;
      this.selectionRevision += 1;
      this.providerHint = null;
      this.invalidateConfirmedSession();
    };
    provider.on("accountsChanged", accountsChanged);
    provider.on("connect", connected);
    provider.on("disconnect", disconnected);
    this.providerListeners.push(["accountsChanged", accountsChanged], ["connect", connected], ["disconnect", disconnected]);
  }
}
