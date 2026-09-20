import { AtSign, CircleDot, Code, Hash, Hexagon, Mail, MessageSquare, Send, Sparkles, type LucideProps } from "lucide-react";
import type { ComponentType } from "react";
import type { RecipientType } from "./recipients.js";

const icons: Record<RecipientType, ComponentType<LucideProps>> = {
  matrix: MessageSquare,
  telegram: Send,
  email: Mail,
  github: Code,
  evm: Hexagon,
  polkadot: CircleDot,
  solana: Sparkles,
  locus: Hash,
};

export function RecipientIcon({ type }: { type: RecipientType }) {
  const Icon = icons[type];
  return <Icon aria-hidden="true" size={16} strokeWidth={1.9} />;
}
