import type { PropsWithChildren } from "react";
import { QueryClientProvider } from "@tanstack/react-query";
import { WagmiProvider } from "wagmi";
import { queryClient, wagmiAdapter } from "./appkit.js";

export function WalletProvider({ children }: PropsWithChildren) {
  return <WagmiProvider config={wagmiAdapter.wagmiConfig}><QueryClientProvider client={queryClient}>{children}</QueryClientProvider></WagmiProvider>;
}
