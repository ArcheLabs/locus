import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type PropsWithChildren } from "react";
import type { LocusWebSession } from "./types.js";
import type { SessionAccessSnapshot } from "./types.js";
import { activeSessionKind, clearManualDisconnect, clearPersistedWalletSession, hasManualDisconnect, persistWalletSession, WALLET_SESSION_KEY } from "./sessionPersistence.js";

export type SessionLifecycle = "restoring" | "connected" | "disconnected";
type SessionContextValue = {
  session: LocusWebSession | null;
  lifecycle: SessionLifecycle;
  restoreError: string;
  access: SessionAccessSnapshot | null;
  setSession: (session: LocusWebSession) => void;
  clearSession: () => void;
  finishRestore: (error?: string) => void;
  retryAuthorization: () => Promise<void>;
};

const SessionContext = createContext<SessionContextValue | null>(null);

function hasStoredSession(): boolean {
  if (typeof window === "undefined") return false;
  if (hasManualDisconnect(window.localStorage)) return false;
  const active = activeSessionKind(window.localStorage);
  if (active === "matrix") return Boolean(window.localStorage.getItem("locus.matrix.session.v1"));
  if (active) return Boolean(window.localStorage.getItem(WALLET_SESSION_KEY));
  return Boolean(window.localStorage.getItem(WALLET_SESSION_KEY) || window.localStorage.getItem("locus.matrix.session.v1"));
}

export function SessionProvider({ children, initialSession = null }: PropsWithChildren<{ initialSession?: LocusWebSession | null }>) {
  const [session, setSession] = useState<LocusWebSession | null>(initialSession);
  const sessionRef = useRef(session);
  const [access, setAccess] = useState<SessionAccessSnapshot | null>(() => initialSession?.access?.getSnapshot() ?? null);
  const [lifecycle, setLifecycle] = useState<SessionLifecycle>(initialSession ? "connected" : hasStoredSession() ? "restoring" : "disconnected");
  const [restoreError, setRestoreError] = useState("");
  const commitSession = useCallback((next: LocusWebSession) => {
    if (typeof window !== "undefined") {
      persistWalletSession(window.localStorage, next);
      clearManualDisconnect(window.localStorage);
    }
    const previous = sessionRef.current;
    if (previous && previous !== next) {
      previous.access?.deactivate();
      try { previous.cleanup?.(); } catch { /* Retire the old identity even if its adapter cleanup fails. */ }
    }
    sessionRef.current = next;
    setAccess(next.access?.getSnapshot() ?? null);
    next.access?.adopt();
    setSession(next);
    setLifecycle("connected");
    setRestoreError("");
  }, []);
  const clearSession = useCallback(() => {
    if (typeof window !== "undefined") clearPersistedWalletSession(window.localStorage);
    try { sessionRef.current?.cleanup?.(); } catch { /* Session data is cleared even if a wallet adapter cannot clean up. */ }
    sessionRef.current?.access?.deactivate();
    sessionRef.current = null;
    setAccess(null);
    setSession(null);
    setLifecycle("disconnected");
    setRestoreError("");
  }, []);
  const retryAuthorization = useCallback(async () => {
    await sessionRef.current?.access?.retry();
  }, []);
  const finishRestore = useCallback((error = "") => {
    setRestoreError(error);
    setLifecycle((current) => current === "restoring" ? "disconnected" : current);
  }, []);
  useEffect(() => {
    const controller = session?.access;
    if (!controller) { setAccess(null); return; }
    controller.adopt();
    setAccess(controller.getSnapshot());
    return controller.subscribe(setAccess);
  }, [session]);
  const value = useMemo(() => ({ session, lifecycle, restoreError, access, setSession: commitSession, clearSession, finishRestore, retryAuthorization }), [access, clearSession, commitSession, finishRestore, lifecycle, restoreError, retryAuthorization, session]);
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionContextValue {
  const value = useContext(SessionContext);
  if (!value) throw new Error("useSession must be used inside SessionProvider");
  return value;
}
