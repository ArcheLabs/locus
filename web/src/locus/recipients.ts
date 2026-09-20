import { evmOwnership, polkadotOwnership, type Ownership } from "@archelabs/locus";

export type RecipientType = "matrix" | "telegram" | "email" | "github" | "evm" | "polkadot" | "locus";

export const recipientLabels: Record<RecipientType, string> = {
  matrix: "Matrix",
  telegram: "Telegram",
  email: "Email",
  github: "GitHub",
  evm: "EVM Address",
  polkadot: "Polkadot Account",
  locus: "Locus ID",
};

export const recipientHints: Record<RecipientType, string> = {
  matrix: "@username:server",
  telegram: "@username",
  email: "user@example.com",
  github: "@username",
  evm: "0x…",
  polkadot: "1…",
  locus: "locus:…",
};

export function recipientIcon(type: RecipientType): string {
  return type === "matrix" ? "[m]" : type === "telegram" ? "➤" : type === "email" ? "✉" : type === "github" ? "⌘" : type === "evm" ? "◇" : type === "polkadot" ? "◎" : "#";
}

export type RecipientResolution = { ownership: Ownership | null; message: string; valid: boolean; configured: boolean };

export function resolveRecipient(type: RecipientType, value: string): RecipientResolution {
  const normalized = value.trim();
  if (!normalized) return { ownership: null, message: "Enter a recipient.", valid: false, configured: true };
  try {
    if (type === "evm") return { ownership: evmOwnership(normalized), message: "EVM Ownership resolved", valid: true, configured: true };
    if (type === "polkadot") return { ownership: polkadotOwnership(normalized), message: "Polkadot Ownership resolved", valid: true, configured: true };
  } catch {
    return { ownership: null, message: `Invalid ${recipientLabels[type]} value.`, valid: false, configured: true };
  }
  return { ownership: null, message: `${recipientLabels[type]} resolver is not configured yet.`, valid: false, configured: false };
}
