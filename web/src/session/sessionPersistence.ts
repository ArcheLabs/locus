import type { LocusWebSession } from "./types.js";

export const WALLET_SESSION_KEY = "locus.session.v1";

export function persistWalletSession(storage: Pick<Storage, "setItem" | "removeItem">, session: LocusWebSession): void {
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
