import type { LocusWebSession } from "./types.js";

export const WALLET_SESSION_KEY = "locus.session.v1";
export const MANUAL_DISCONNECT_KEY = "locus.session.manual-disconnect.v1";
export const ACTIVE_SESSION_KIND_KEY = "locus.session.active-kind.v1";

export function setActiveSessionKind(storage: Pick<Storage, "setItem">, kind: LocusWebSession["kind"]): void {
  storage.setItem(ACTIVE_SESSION_KIND_KEY, kind);
}

export function persistWalletSession(storage: Pick<Storage, "setItem" | "removeItem">, session: LocusWebSession): void {
  setActiveSessionKind(storage, session.kind);
  if (session.kind === "matrix") {
    storage.removeItem(WALLET_SESSION_KEY);
    return;
  }
  storage.setItem(WALLET_SESSION_KEY, JSON.stringify({
    kind: session.kind,
    address: session.address,
    connectionId: session.connectionId,
  }));
}

export function clearPersistedWalletSession(storage: Pick<Storage, "removeItem">): void {
  storage.removeItem(WALLET_SESSION_KEY);
}

export function markSessionDisconnected(storage: Pick<Storage, "setItem">): void {
  storage.setItem(MANUAL_DISCONNECT_KEY, "true");
}

export function clearManualDisconnect(storage: Pick<Storage, "removeItem">): void {
  storage.removeItem(MANUAL_DISCONNECT_KEY);
}

export function hasManualDisconnect(storage: Pick<Storage, "getItem">): boolean {
  return storage.getItem(MANUAL_DISCONNECT_KEY) === "true";
}

export function activeSessionKind(storage: Pick<Storage, "getItem">): LocusWebSession["kind"] | null {
  const kind = storage.getItem(ACTIVE_SESSION_KIND_KEY);
  return kind === "matrix" || kind === "evm" || kind === "polkadot" || kind === "solana" ? kind : null;
}
