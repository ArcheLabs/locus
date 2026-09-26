import { createContext, useCallback, useContext, useMemo, useState, type PropsWithChildren } from "react";
import type { LocusWebSession } from "./types.js";
import { clearPersistedWalletSession, persistWalletSession, WALLET_SESSION_KEY } from "./sessionPersistence.js";

export type SessionLifecycle = "restoring" | "connected" | "disconnected";
type SessionContextValue = {
  session: LocusWebSession | null;
  lifecycle: SessionLifecycle;
  restoreError: string;
  setSession: (session: LocusWebSession) => void;
  clearSession: () => void;
  finishRestore: (error?: string) => void;
};

const SessionContext = createContext<SessionContextValue | null>(null);

function hasStoredSession(): boolean {
  if (typeof window === "undefined") return false;
  return Boolean(window.localStorage.getItem(WALLET_SESSION_KEY) || window.localStorage.getItem("locus.matrix.session.v1"));
}

export function SessionProvider({ children, initialSession = null }: PropsWithChildren<{ initialSession?: LocusWebSession | null }>) {
  const [session, setSession] = useState<LocusWebSession | null>(initialSession);
  const [lifecycle, setLifecycle] = useState<SessionLifecycle>(initialSession ? "connected" : hasStoredSession() ? "restoring" : "disconnected");
  const [restoreError, setRestoreError] = useState("");
  const commitSession = useCallback((next: LocusWebSession) => {
    if (typeof window !== "undefined") persistWalletSession(window.localStorage, next);
    setSession(next);
    setLifecycle("connected");
    setRestoreError("");
  }, []);
  const clearSession = useCallback(() => {
    if (typeof window !== "undefined") clearPersistedWalletSession(window.localStorage);
    setSession(null);
    setLifecycle("disconnected");
    setRestoreError("");
  }, []);
  const finishRestore = useCallback((error = "") => {
    setRestoreError(error);
    setLifecycle((current) => current === "restoring" ? "disconnected" : current);
  }, []);
  const value = useMemo(() => ({ session, lifecycle, restoreError, setSession: commitSession, clearSession, finishRestore }), [clearSession, commitSession, finishRestore, lifecycle, restoreError, session]);
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionContextValue {
  const value = useContext(SessionContext);
  if (!value) throw new Error("useSession must be used inside SessionProvider");
  return value;
}
