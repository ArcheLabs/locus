import type { Ownership } from "@archelabs/locus";
import type { OwnershipSession } from "@archelabs/locus";

export type LocusWebSession = {
  owner: Ownership;
  ownershipSession: OwnershipSession;
  label: string;
};
