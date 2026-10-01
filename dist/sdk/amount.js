const U128_MAX = (1n << 128n) - 1n;
export function parseAmount(text, decimals) {
    if (!Number.isInteger(decimals) || decimals < 0 || decimals > 38) {
        throw new RangeError("decimals must be an integer between 0 and 38");
    }
    const normalized = text.trim();
    if (!/^\d+(?:\.\d+)?$/.test(normalized))
        throw new Error("invalid amount");
    const [whole, fraction = ""] = normalized.split(".");
    if (fraction.length > decimals)
        throw new Error("amount has too many decimal places");
    const value = BigInt(whole) * 10n ** BigInt(decimals)
        + BigInt((fraction + "0".repeat(decimals)).slice(0, decimals) || "0");
    if (value > U128_MAX)
        throw new RangeError("amount exceeds u128");
    return value;
}
export function formatAmount(amount, decimals) {
    if (amount < 0n || amount > U128_MAX)
        throw new RangeError("amount exceeds u128");
    if (!Number.isInteger(decimals) || decimals < 0 || decimals > 38) {
        throw new RangeError("decimals must be an integer between 0 and 38");
    }
    if (decimals === 0)
        return amount.toString();
    const scale = 10n ** BigInt(decimals);
    const whole = amount / scale;
    const fraction = amount % scale;
    if (fraction === 0n)
        return whole.toString();
    return `${whole}.${fraction.toString().padStart(decimals, "0").replace(/0+$/, "")}`;
}
export const parseUnits = parseAmount;
export const formatUnits = formatAmount;
