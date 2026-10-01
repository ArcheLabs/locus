import type { Ownership } from "@archelabs/locus";
import type { OwnershipSession } from "@archelabs/locus";
import type { LocusClient } from "@archelabs/locus";

export type SessionKind = "matrix" | "evm" | "polkadot" | "solana";

export type AccountAuthorizationState =
  | "NOT_STARTED" | "PREPARING" | "SUBMITTING" | "QUEUED" | "CONFIRMING"
  | "STATUS_UNKNOWN" | "RETRY_REQUIRED" | "READY" | "REJECTED" | "REVOKED";

export type SessionIdentityState = "CONNECTED" | "STATUS_UNKNOWN" | "REAUTH_REQUIRED" | "DISCONNECTED";

export type SessionAccessSnapshot = {
  identity: SessionIdentityState;
  authorization: AccountAuthorizationState;
  scopeKey?: string;
  sessionGeneration?: string;
  error?: string;
};

export type LocusAuthorizationScope = {
  key: string;
  networkId: string;
  networkDomain: string;
  serviceId: number;
  locus: LocusClient;
};

export type SessionAccessController = {
  getSnapshot: () => SessionAccessSnapshot;
  subscribe: (listener: (snapshot: SessionAccessSnapshot) => void) => () => void;
  adopt: () => void;
  setScope: (scope: LocusAuthorizationScope | null) => void;
  retry: () => Promise<void>;
  deactivate: () => void;
};

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
  access?: SessionAccessController;
  matrix?: {
    userId: string;
    deviceId: string;
    homeserver: string;
    subscribeSecurity?: (listener: (message: string) => void) => () => void;
  };
  cleanup?: () => void;
};
