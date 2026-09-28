import { IdentityIcon } from "../components/IdentityIcon.js";
import type { RecipientType } from "./recipients.js";

export function RecipientIcon({ type, size = 24, className }: { type: RecipientType; size?: number; className?: string }) {
  return <IdentityIcon kind={type} size={size} className={className} />;
}
