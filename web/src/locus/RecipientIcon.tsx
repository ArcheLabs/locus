import { IdentityIcon } from "../components/IdentityIcon.js";
import type { RecipientType } from "./recipients.js";

export function RecipientIcon({ type }: { type: RecipientType }) {
  return <IdentityIcon kind={type} size={20} />;
}
