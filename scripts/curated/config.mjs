import { blake2AsU8a } from "@polkadot/util-crypto";
import { evmOwnership } from "../../dist/sdk/index.js";

export const CURATED_TREASURY_EVM = "0x78B02E176e587E163661fBe70232CCDDEb11759e";
export const curatedTreasuryOwnership = evmOwnership(CURATED_TREASURY_EVM);

const equityDisclosure = "Demo representation only. This asset does not represent equity ownership, voting rights, dividends, custody, or redemption rights.";

export const CURATED_ASSETS = [
  { key: "dot", seed: "DOT", name: "Polkadot", symbol: "DOT", decimals: 10, wholeSupply: 1_000_000n, class: "crypto", status: "test", icon: "dot", disclosure: "Test representation on MiniJAM. It is not native DOT and is not redeemable for DOT." },
  { key: "mini", seed: "MINI", name: "MiniJAM", symbol: "MINI", decimals: 6, wholeSupply: 100_000_000n, class: "crypto", status: "test", icon: "mini", disclosure: "Development inventory for testing on MiniJAM." },
  { key: "usdt", seed: "USDT", name: "Tether USD", symbol: "USDT", decimals: 6, wholeSupply: 10_000_000n, class: "crypto", status: "test", icon: "usdt", disclosure: "Test representation only. It is not issued or redeemable by Tether." },
  { key: "aapl", seed: "AAPL", name: "Apple Demo Equity", symbol: "AAPL", decimals: 4, wholeSupply: 1_000_000n, class: "equity-demo", status: "demo", icon: "ticker", unit: "shares", disclosure: equityDisclosure },
  { key: "nvda", seed: "NVDA", name: "NVIDIA Demo Equity", symbol: "NVDA", decimals: 4, wholeSupply: 1_000_000n, class: "equity-demo", status: "demo", icon: "ticker", unit: "shares", disclosure: equityDisclosure },
  { key: "tsla", seed: "TSLA", name: "Tesla Demo Equity", symbol: "TSLA", decimals: 4, wholeSupply: 1_000_000n, class: "equity-demo", status: "demo", icon: "ticker", unit: "shares", disclosure: equityDisclosure },
].map((asset) => ({
  ...asset,
  assetId: blake2AsU8a(`locus:curated:${asset.seed}:v1`, 256),
  initialSupply: asset.wholeSupply * (10n ** BigInt(asset.decimals)),
}));

export const DEMO_POOL_CONFIG_PATH = new URL("./pools.json", import.meta.url);
