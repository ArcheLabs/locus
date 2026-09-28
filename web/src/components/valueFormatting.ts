export function compactValue(value: string): string {
  if (value.length <= 20) return value;
  if (/^0x[\da-f]{40}$/i.test(value)) return `${value.slice(0, 6)}…${value.slice(-4)}`;
  if (value.startsWith("locus:")) return `locus:${value.slice(6, 12)}…${value.slice(-4)}`;
  return `${value.slice(0, 7)}…${value.slice(-5)}`;
}
