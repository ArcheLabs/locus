import { Hash, Mail, type LucideProps } from "lucide-react";
import { SiEthereum, SiGithub, SiMatrix, SiPolkadot, SiSolana, SiTelegram } from "react-icons/si";
import type { ComponentType } from "react";
import type { RecipientType } from "./recipients.js";

const icons: Record<RecipientType, ComponentType<LucideProps>> = {
  matrix: SiMatrix,
  telegram: SiTelegram,
  email: Mail,
  github: SiGithub,
  evm: SiEthereum,
  polkadot: SiPolkadot,
  solana: SiSolana,
  locus: Hash,
};

export function RecipientIcon({ type }: { type: RecipientType }) {
  const Icon = icons[type];
  return <Icon aria-hidden="true" size={16} strokeWidth={1.9} />;
}
