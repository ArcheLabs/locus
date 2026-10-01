const NAME_LIMIT = 64;
const SYMBOL_LIMIT = 16;
function encode(value, label, limit) {
    const bytes = new TextEncoder().encode(value);
    if (bytes.length === 0 || bytes.length > limit) {
        throw new Error(`${label} must encode to between 1 and ${limit} UTF-8 bytes`);
    }
    return bytes;
}
function decode(value, label, limit) {
    if (!(value instanceof Uint8Array) || value.length === 0 || value.length > limit) {
        throw new Error(`${label} must contain between 1 and ${limit} bytes`);
    }
    return new TextDecoder("utf-8", { fatal: true }).decode(value);
}
export function encodeAssetName(value) {
    return encode(value, "asset name", NAME_LIMIT);
}
export function encodeAssetSymbol(value) {
    return encode(value, "asset symbol", SYMBOL_LIMIT);
}
export function decodeAssetName(value) {
    return decode(value, "asset name", NAME_LIMIT);
}
export function decodeAssetSymbol(value) {
    return decode(value, "asset symbol", SYMBOL_LIMIT);
}
