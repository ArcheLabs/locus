export const LOCUS_ERROR_CODES = {
  ASSET_NOT_FOUND: 2001,
  ASSET_ALREADY_EXISTS: 2002,
  INVALID_ASSET_ID: 2003,
  INVALID_ASSET_NAME: 2004,
  INVALID_ASSET_SYMBOL: 2005,
  INVALID_DECIMALS: 2006,
  NOT_ASSET_ISSUER: 2007,

  INSUFFICIENT_BALANCE: 3002,
  AMOUNT_OVERFLOW: 3003,

  INSUFFICIENT_ALLOWANCE: 4002,
  STATE_INVARIANT_VIOLATION: 9001,
} as const;

export type LocusErrorCode = (typeof LOCUS_ERROR_CODES)[keyof typeof LOCUS_ERROR_CODES];

const names: Record<number, string> = Object.fromEntries(
  Object.entries(LOCUS_ERROR_CODES).map(([name, code]) => [code, name]),
);

export class LocusError extends Error {
  readonly code: number | undefined;
  readonly locusName: string | undefined;

  constructor(message: string, code?: number, cause?: unknown) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = "LocusError";
    this.code = code;
    this.locusName = code === undefined ? undefined : names[code];
  }
}

function codeFrom(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isInteger(value)) return value;
  if (typeof value === "string" && /^\d+$/.test(value)) return Number(value);
  return undefined;
}

export function normalizeLocusError(error: unknown): LocusError | null {
  if (error instanceof LocusError) return error;
  if (!error || typeof error !== "object") return null;
  const candidate = error as { code?: unknown; error?: { code?: unknown }; message?: unknown };
  const code = codeFrom(candidate.code) ?? codeFrom(candidate.error?.code);
  if (code === undefined || names[code] === undefined) return null;
  return new LocusError(
    typeof candidate.message === "string" ? candidate.message : names[code],
    code,
    error,
  );
}

export function locusError(code: LocusErrorCode, message = names[code]): LocusError {
  return new LocusError(message, code);
}
