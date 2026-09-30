import type { Eip1193Provider } from "@jamscript/client";
import type { LocusWebSession } from "./types.js";

type EvmEventProvider = Eip1193Provider & {
  on?: (event: string, listener: (...args: unknown[]) => void) => void;
  removeListener?: (event: string, listener: (...args: unknown[]) => void) => void;
};

type EventSource = Pick<EventTarget, "addEventListener" | "removeEventListener">;
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
  private addressHint: string | null = null;
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
    this.addressHint = address ?? null;
    void this.reconcile();
  }

  async beginConnection(): Promise<boolean> {
    this.pending = true;
    this.expectedAddress = null;
    const commitsBefore = this.successfulCommits;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    const fastPathMs = this.addressHint ? ACCOUNT_QUERY_TIMEOUT_MS + 150 : EXISTING_ACCOUNT_FAST_PATH_MS;
    await Promise.race([
      this.reconcile(),
      new Promise<void>((resolve) => { timeout = setTimeout(resolve, fastPathMs); }),
    ]);
    if (timeout !== undefined) clearTimeout(timeout);
    return this.options.getSession()?.kind === "evm" || this.successfulCommits > commitsBefore;
  }

  beginRestore(address: string): void {
    this.pending = true;
    this.expectedAddress = address;
    void this.reconcile();
  }

  cancelConnection(): void {
    this.pending = false;
    this.expectedAddress = null;
  }

  explicitDisconnect(): void {
    this.pending = false;
    this.expectedAddress = null;
    this.committedProvider = null;
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
    let accounts: unknown;
    try {
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
      if (result.timedOut) {
        if (this.pending && this.expectedAddress) this.options.onError?.(new Error("The EVM wallet did not respond while restoring this account. Reconnect it, then try again."));
        return;
      }
      accounts = result.value;
    } catch (cause) {
      if (this.pending && this.expectedAddress) this.options.onError?.(cause instanceof Error ? cause : new Error("Could not read accounts from the connected EVM wallet."));
      return;
    }
    if (provider !== this.provider || this.disposed) return;
    const exposed = Array.isArray(accounts) ? accounts.filter(isAddress) : [];
    const current = this.options.getSession();
    if (current?.kind === "evm") {
      // AppKit may publish an account hint before the provider has refreshed
      // its account list after returning from a wallet app. The provider's
      // eth_accounts result is authoritative; a transient hook mismatch alone
      // must not invalidate the signer.
      const hintedAccountIsExposed = !!this.addressHint && exposed.some((address) => address.toLowerCase() === this.addressHint!.toLowerCase());
      if ((hintedAccountIsExposed && this.addressHint!.toLowerCase() !== current.address.toLowerCase())
        || (exposed.length > 0 && !exposed.some((address) => address.toLowerCase() === current.address.toLowerCase()))) {
        this.invalidateConfirmedSession();
      } else if (exposed.some((address) => address.toLowerCase() === current.address.toLowerCase()) && this.committedProvider !== provider) {
        try {
          const refreshed = await this.options.createSession(provider, current.address);
          if (this.disposed || provider !== this.provider || this.options.getSession()?.address?.toLowerCase() !== current.address.toLowerCase()) return;
          this.options.commitSession(refreshed);
          this.committedProvider = provider;
          this.successfulCommits += 1;
        } catch (cause) {
          this.options.onError?.(cause instanceof Error ? cause : new Error("Could not refresh the EVM wallet session."));
        }
      }
      return;
    }
    if (!this.pending) return;
    if (this.expectedAddress && exposed.length > 0 && !exposed.some((address) => address.toLowerCase() === this.expectedAddress!.toLowerCase())) {
      this.invalidateConfirmedSession();
      return;
    }
    const address = selectExposedEvmAccount(exposed, this.addressHint, this.expectedAddress);
    if (!address) return;
    try {
      const session = await this.options.createSession(provider, address);
      if (this.disposed || provider !== this.provider || !this.pending) {
        try { session.cleanup?.(); } catch { /* The abandoned connection must not stay active in memory. */ }
        return;
      }
      this.options.commitSession(session);
      this.committedProvider = provider;
      this.successfulCommits += 1;
      this.pending = false;
      this.expectedAddress = null;
    } catch (cause) {
      if (this.pending) this.options.onError?.(cause instanceof Error ? cause : new Error("EVM wallet connection failed."));
    }
  }

  private invalidateConfirmedSession(): void {
    const hadSession = this.options.getSession()?.kind === "evm";
    const restoringSavedSession = this.pending && this.expectedAddress !== null;
    this.pending = false;
    this.expectedAddress = null;
    this.committedProvider = null;
    if (hadSession || restoringSavedSession) this.options.clearSession();
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
    this.providerListeners = [];
    if (!provider?.on) return;
    const accountsChanged = (...args: unknown[]) => {
      const accounts = Array.isArray(args[0]) ? args[0].filter(isAddress) : [];
      const current = this.options.getSession();
      // accountsChanged is an explicit provider signal, so an empty list or a
      // different selected account invalidates the old signer immediately.
      if (current?.kind === "evm" && accounts[0]?.toLowerCase() !== current.address.toLowerCase()) {
        this.invalidateConfirmedSession();
      } else if (this.pending && this.expectedAddress && accounts.length > 0
        && !accounts.some((address) => address.toLowerCase() === this.expectedAddress!.toLowerCase())) {
        this.invalidateConfirmedSession();
      } else {
        void this.reconcile();
      }
    };
    const connected = () => { void this.reconcile(); };
    provider.on("accountsChanged", accountsChanged);
    provider.on("connect", connected);
    this.providerListeners.push(["accountsChanged", accountsChanged], ["connect", connected]);
  }
}
