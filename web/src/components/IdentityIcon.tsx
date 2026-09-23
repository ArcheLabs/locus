import { Hash, Mail, type LucideProps } from "lucide-react";
import { SiEthereum, SiGithub, SiMatrix, SiPolkadot, SiSolana, SiTelegram } from "react-icons/si";
import type { ComponentType } from "react";
import type { SessionKind } from "../session/types.js";
import type { RecipientType } from "../locus/recipients.js";

type IdentityKind = SessionKind | RecipientType;
const icons: Record<IdentityKind, ComponentType<LucideProps>> = {
  matrix: SiMatrix, evm: SiEthereum, polkadot: SiPolkadot, solana: SiSolana,
  telegram: SiTelegram, email: Mail, github: SiGithub, locus: Hash,
};

export function IdentityIcon({ kind, size = 16 }: { kind: IdentityKind; size?: number }) {
  const Icon = icons[kind];
  return <Icon aria-hidden="true" size={size} strokeWidth={1.9} />;
}
