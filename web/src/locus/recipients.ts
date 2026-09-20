import { evmOwnership, parseLocusId, polkadotOwnership, type Ownership } from "@archelabs/locus";

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

export type RecipientResolution = { ownership: Ownership | null; message: string; valid: boolean; configured: boolean; detectedType?: RecipientType };

export function resolveRecipient(type: RecipientType, value: string): RecipientResolution {
  const normalized = value.trim();
  if (!normalized) return { ownership: null, message: "Enter a recipient.", valid: false, configured: true };
  try {
    if (type === "evm") return { ownership: evmOwnership(normalized), message: "EVM Ownership resolved", valid: true, configured: true, detectedType: type };
    if (type === "polkadot") return { ownership: polkadotOwnership(normalized), message: "Polkadot Ownership resolved", valid: true, configured: true, detectedType: type };
    if (type === "locus") return { ownership: parseLocusId(normalized), message: "Locus Ownership resolved", valid: true, configured: true, detectedType: type };
    if (type === "matrix" && /^@[A-Za-z0-9._=-]+:[^\s:]+$/.test(normalized)) {
      return { ownership: null, message: "Matrix resolver is not configured for this network.", valid: false, configured: false };
    }
  } catch {
    return { ownership: null, message: `Invalid ${recipientLabels[type]} value.`, valid: false, configured: true };
  }
  return { ownership: null, message: `${recipientLabels[type]} resolver is not configured yet.`, valid: false, configured: false };
}

export function detectRecipientType(value: string): RecipientType | null {
  const normalized = value.trim();
  if (!normalized) return null;
  if (/^locus:/i.test(normalized)) return "locus";
  if (/^0x[0-9a-fA-F]{40}$/.test(normalized)) return "evm";
  if (/^@[A-Za-z0-9._=-]+:[^\s:]+$/.test(normalized)) return "matrix";
  try {
    polkadotOwnership(normalized);
    return "polkadot";
  } catch {
    return null;
  }
}
