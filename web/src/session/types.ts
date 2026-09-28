import type { Ownership } from "@archelabs/locus";
import type { OwnershipSession } from "@archelabs/locus";

export type SessionKind = "matrix" | "evm" | "polkadot" | "solana";

export type LocusWebSession = {
  kind: SessionKind;
  /** Effective Ownership subject used by Locus actions. */
  owner: Ownership;
  /** Cryptographic controller that actually signs the action. */
  controller: Ownership;
  ownershipSession: OwnershipSession;
  label: string;
  address: string;
  connectionId?: string;
  matrix?: {
    userId: string;
    deviceId: string;
    homeserver: string;
  };
  cleanup?: () => void;
};
