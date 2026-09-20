import type { LocusNetworkId } from "./types.js";

export function selectNetwork(
  query: unknown,
  stored: unknown,
  envDefault: unknown,
  configDefault: LocusNetworkId = "local",
): LocusNetworkId {
  for (const value of [query, stored, envDefault, configDefault]) {
    if (value === "local" || value === "testnet") return value;
  }
  return "local";
}
