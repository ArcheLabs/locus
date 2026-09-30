import { createAppKit } from "@reown/appkit/react";
import { WagmiAdapter } from "@reown/appkit-adapter-wagmi";
import { QueryClient } from "@tanstack/react-query";
import { defineChain } from "viem";
import { LOCUS_WEBSITE_URL } from "../navigation/links.js";

// MINI Genesis uses Reown AppKit for EVM wallet discovery and selection.
// Locus reuses that same wallet layer for EVM only; Polkadot stays on the
// extension-dapp raw-signature path used by OwnershipSigner.
const projectId = import.meta.env.VITE_REOWN_PROJECT_ID?.trim() || "65fcb5a5788f31332af2ca9bfabf4699";
const initialThemeMode = typeof document !== "undefined" && document.documentElement.dataset.theme === "dark" ? "dark" : "light";
const locusEvmNetwork = defineChain({
  id: 1,
  name: "Ethereum",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: ["https://cloudflare-eth.com"] } },
});

export const wagmiAdapter = new WagmiAdapter({ networks: [locusEvmNetwork], projectId, ssr: false });
export const queryClient = new QueryClient();

createAppKit({
  adapters: [wagmiAdapter],
  networks: [locusEvmNetwork],
  projectId,
  themeMode: initialThemeMode,
  metadata: {
    name: "Locus",
    description: "Ownership assets and identity",
    url: typeof window === "undefined" ? LOCUS_WEBSITE_URL : window.location.origin,
    icons: [],
  },
  features: { analytics: false, email: false, socials: false, swaps: false, onramp: false },
});
