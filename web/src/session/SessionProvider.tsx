import { createContext, useContext, useMemo, useState, type PropsWithChildren } from "react";
import type { LocusWebSession } from "./types.js";

type SessionContextValue = {
  session: LocusWebSession | null;
  setSession: (session: LocusWebSession | null) => void;
};

const SessionContext = createContext<SessionContextValue | null>(null);

export function SessionProvider({ children, initialSession = null }: PropsWithChildren<{ initialSession?: LocusWebSession | null }>) {
  const [session, setSession] = useState<LocusWebSession | null>(initialSession);
  const value = useMemo(() => ({ session, setSession }), [session]);
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionContextValue {
  const value = useContext(SessionContext);
  if (!value) throw new Error("useSession must be used inside SessionProvider");
  return value;
}
