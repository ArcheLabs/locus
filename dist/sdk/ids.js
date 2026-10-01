export function randomAssetId() {
    const cryptoApi = globalThis.crypto;
    if (!cryptoApi || typeof cryptoApi.getRandomValues !== "function") {
        throw new Error("randomAssetId requires a Web Crypto secure random source");
    }
    const result = new Uint8Array(32);
    cryptoApi.getRandomValues(result);
    if (result.every((byte) => byte === 0))
        throw new Error("randomAssetId generated zero");
    return result;
}
export function isZeroId(value) {
    return value.length === 32 && value.every((byte) => byte === 0);
}
export function assertId(value, label) {
    if (!(value instanceof Uint8Array) || value.length !== 32 || isZeroId(value)) {
        throw new Error(`${label} must be a non-zero 32-byte identifier`);
    }
}
