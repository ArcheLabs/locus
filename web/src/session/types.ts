import type { Ownership } from "@archelabs/locus";
import type { OwnershipSession } from "@archelabs/locus";

export type SessionKind = "evm" | "polkadot" | "solana";

export type LocusWebSession = {
  kind: SessionKind;
  owner: Ownership;
  ownershipSession: OwnershipSession;
  label: string;
  address: string;
  connectionId?: string;
};
