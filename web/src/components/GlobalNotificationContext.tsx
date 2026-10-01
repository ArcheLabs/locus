import { createContext, useContext, type PropsWithChildren } from "react";

const GlobalNotifyContext = createContext<(message: string) => void>(() => undefined);

export function GlobalNotificationProvider({ onNotify, children }: PropsWithChildren<{ onNotify: (message: string) => void }>) {
  return <GlobalNotifyContext.Provider value={onNotify}>{children}</GlobalNotifyContext.Provider>;
}

export function useGlobalNotify(): (message: string) => void {
  return useContext(GlobalNotifyContext);
}
