const U128_MAX = (1n << 128n) - 1n;

export function validatePositiveAmount(value: string, decimals: number, balance: bigint | null): string | null {
  const amount = value.trim();
  if (!amount) return "Enter an amount.";
  if (/^[+-]/.test(amount) || /[,eE]/.test(amount) || !/^\d+(?:\.\d+)?$/.test(amount)) return "Enter a positive decimal amount.";
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 38) return "This asset has invalid decimal precision.";
  const [whole = "0", fraction = ""] = amount.split(".");
  if (fraction.length > decimals) return `This asset supports up to ${decimals} decimal places.`;
  const parsed = BigInt(whole) * 10n ** BigInt(decimals)
    + BigInt((fraction + "0".repeat(decimals)).slice(0, decimals) || "0");
  if (parsed > U128_MAX) return "Amount exceeds the maximum supported value.";
  if (parsed <= 0n) return "Amount must be greater than 0.";
  if (balance === null) return "Your balance is unavailable. Retry the balance before continuing.";
  if (parsed > balance) return "Amount exceeds your available balance.";
  return null;
}

export function validateRecipientText(value: string, type: string): string | null {
  const recipient = value.trim();
  if (!recipient) return "Enter a recipient.";
  if (type === "matrix" && !/^@[^:\s/]+:(?:\[[0-9A-Fa-f:.]+\]|[A-Za-z0-9.-]+)(?::\d{1,5})?$/.test(recipient)) {
    return "Enter a complete Matrix ID, for example @alice:matrix.org.";
  }
  return null;
}
