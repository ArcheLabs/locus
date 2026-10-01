import {
  abort, applicationKeyV1, appliedResult, caughtResult, initializeStateView,
  stateDeleteRaw, stateGetRaw, stateHasRaw, stateSetRaw, verifyEd25519,
} from "./scriptc_runtime.js";
import {
  jamU8FromNumber, jamU16FromNumber, jamU32FromNumber,
  jamU8AddChecked, jamU8SubChecked, jamU8MulChecked, jamU8DivChecked, jamU8ModChecked, jamU8Compare,
  jamU16AddChecked, jamU16SubChecked, jamU16MulChecked, jamU16DivChecked, jamU16ModChecked, jamU16Compare,
  jamU32AddChecked, jamU32SubChecked, jamU32MulChecked, jamU32DivChecked, jamU32ModChecked, jamU32Compare,
  jamU64Const, jamU64Identity, jamU64Or, jamU64AddChecked, jamU64SubChecked, jamU64MulChecked,
  jamU64DivChecked, jamU64ModChecked, jamU64Compare, jamU64FromNumber,
  jamU64FromU128, jamU8FromU64, jamU16FromU64, jamU32FromU64,
  jamU128Const, jamU128Identity, jamU128Or, jamU128AddChecked, jamU128SubChecked, jamU128MulChecked,
  jamU128DivChecked, jamU128ModChecked, jamU128Compare, jamU128FromNumber, jamU128FromU64,
  jamU8FromU128, jamU16FromU128, jamU32FromU128, jamEncodeU64, jamEncodeU128,
  jamDecodeU64, jamDecodeU128,
} from "./jamscript_numeric_runtime.js";
export { abort };

type JamOwnership = { version: number; kind: number; public: Uint8Array };
import { decodeOwnershipAt, decodeOwnershipAuthContext, encodeOwnership, ownershipKey } from "./scriptc_runtime.js";

type JamCursor = { input: Uint8Array; offset: number };
type JamU64 = { w0: number; w1: number };
type JamU128 = { w0: number; w1: number; w2: number; w3: number };
function jamTake(cursor: JamCursor, length: number): Uint8Array { const end = cursor.offset + length; if (length < 0 || end < cursor.offset || end > cursor.input.length) throw new Error("invalid JAM bytes"); const value = cursor.input.slice(cursor.offset, end); cursor.offset = end; return value; }
function jamU8(cursor: JamCursor): number { return jamTake(cursor, 1)[0]; }
function jamU16(cursor: JamCursor): number { const b = jamTake(cursor, 2); return b[0] + b[1] * 256; }
function jamU32(cursor: JamCursor): number { const b = jamTake(cursor, 4); return b[0] + b[1] * 256 + b[2] * 65536 + b[3] * 16777216; }
function jamU64(cursor: JamCursor): JamU64 { const value = jamDecodeU64(cursor.input, cursor.offset); cursor.offset += 8; return value; }
function jamU128(cursor: JamCursor): JamU128 { const value = jamDecodeU128(cursor.input, cursor.offset); cursor.offset += 16; return value; }
function jamEncodeU8(value: number): Uint8Array { if (value < 0 || value > 255 || Math.floor(value) !== value) throw new Error("u8 out of range"); return new Uint8Array([value]); }
function jamEncodeU16(value: number): Uint8Array { if (value < 0 || value > 65535 || Math.floor(value) !== value) throw new Error("u16 out of range"); return new Uint8Array([value % 256, Math.floor(value / 256) % 256]); }
function jamEncodeU32(value: number): Uint8Array { if (value < 0 || value > 4294967295 || Math.floor(value) !== value) throw new Error("u32 out of range"); return new Uint8Array([value % 256, Math.floor(value / 256) % 256, Math.floor(value / 65536) % 256, Math.floor(value / 16777216) % 256]); }
function jamConcat(parts: Uint8Array[]): Uint8Array { let length = 0; for (const part of parts) length += part.length; const output = new Uint8Array(length); let offset = 0; for (const part of parts) { output.set(part, offset); offset += part.length; } return output; }
function jamNatural(cursor: JamCursor): number { const first = jamU8(cursor); if (first < 128) return first; let length = 0; while (length < 8 && (first & (128 >>> length)) !== 0) length += 1; if (length === 0 || length > 7) throw new Error("invalid JAM natural"); const low = jamTake(cursor, length); let multiplier = 1; let value = 0; for (let index = 0; index < length; index += 1) { value += low[index] * multiplier; multiplier *= 256; } return value + (first & (127 >>> length)) * multiplier; }
function jamEncodeNatural(value: number): Uint8Array { if (value < 0 || value > 4294967295 || Math.floor(value) !== value) throw new Error("natural out of range"); if (value < 128) return new Uint8Array([value]); let length = 1; let threshold = 16384; while (length < 4 && value >= threshold) { length += 1; threshold *= 128; } let divisor = 1; for (let index = 0; index < length; index += 1) divisor *= 256; const output = new Uint8Array(1 + length); output[0] = ((256 - (1 << (8 - length))) & 255) | (Math.floor(value / divisor) & (127 >>> length)); let multiplier = 1; for (let index = 0; index < length; index += 1) { output[index + 1] = Math.floor(value / multiplier) % 256; multiplier *= 256; } return output; }
function jamFixed(value: Uint8Array, length: number): Uint8Array { if (value.length !== length) throw new Error("fixed bytes length"); return value.slice(); }
function jamBounded(value: Uint8Array, max: number): Uint8Array { if (value.length > max) throw new Error("bounded bytes length"); return jamConcat([jamEncodeNatural(value.length), value]); }

/** Bounded byte-only Matrix proof parser shared with deterministic service adapters. */
function readerOffset(reader: Uint8Array): number {
    return reader[0] | (reader[1] << 8) | (reader[2] << 16) | (reader[3] << 24);
}

function setReaderOffset(reader: Uint8Array, offset: number): void {
    reader[0] = offset & 0xff;
    reader[1] = (offset >>> 8) & 0xff;
    reader[2] = (offset >>> 16) & 0xff;
    reader[3] = (offset >>> 24) & 0xff;
}

function take(reader: Uint8Array, length: number): Uint8Array {
    const offset = readerOffset(reader);
    const end = offset + length;
    if (end + 4 > reader.length)
        throw new Error("truncated Matrix proof");
    const value = reader.slice(offset + 4, end + 4);
    setReaderOffset(reader, end);
    return value;
}

function readTextBytes(reader: Uint8Array, limit: number): Uint8Array {
    const prefix = take(reader, 2);
    const length = prefix[0] | (prefix[1] << 8);
    if (length > limit)
        throw new Error("invalid Matrix text length");
    const value = take(reader, length);
    for (let index = 0; index < value.length; index += 1) {
        const byte = value[index];
        if (byte < 0x20 || byte > 0x7e || byte === 0x22 || byte === 0x5c) {
            throw new Error("invalid Matrix text byte");
        }
    }
    return value;
}

/** Decode the stable wire format into a compact, numeric-offset byte view. */
function decodeMatrixControlClaimProofV1Bytes(bytes: Uint8Array): Uint8Array {
    if (bytes.length > 2048)
        throw new Error("Matrix proof exceeds size limit");
    const reader = new Uint8Array(bytes.length + 4);
    reader.set(bytes, 4);
    if (take(reader, 1)[0] !== 1)
        throw new Error("unsupported Matrix proof version");
    const userId = readTextBytes(reader, 255);
    const selfSigningPublicKey = take(reader, 32);
    const masterSignature = take(reader, 64);
    const deviceId = readTextBytes(reader, 255);
    const algorithmCount = take(reader, 1)[0];
    if (algorithmCount > 8)
        throw new Error("too many Matrix algorithms");
    const algorithmBytes = new Uint8Array(8 * 131 - 1);
    let algorithmLength = 0;
    for (let index = 0; index < algorithmCount; index += 1) {
        const algorithm = readTextBytes(reader, 128);
        if (index > 0)
            algorithmBytes[algorithmLength++] = 44;
        algorithmBytes[algorithmLength++] = 34;
        for (let byteIndex = 0; byteIndex < algorithm.length; byteIndex += 1) {
            algorithmBytes[algorithmLength++] = algorithm[byteIndex];
        }
        algorithmBytes[algorithmLength++] = 34;
    }
    const deviceCurve25519Key = take(reader, 32);
    const deviceEd25519Key = take(reader, 32);
    const selfSigningSignature = take(reader, 64);
    if (readerOffset(reader) !== bytes.length)
        throw new Error("trailing Matrix proof bytes");
    const output = new Uint8Array(6 + userId.length + selfSigningPublicKey.length + masterSignature.length
        + deviceId.length + algorithmLength + deviceCurve25519Key.length
        + deviceEd25519Key.length + selfSigningSignature.length);
    output[0] = userId.length & 0xff;
    output[1] = userId.length >>> 8;
    output[2] = deviceId.length & 0xff;
    output[3] = deviceId.length >>> 8;
    output[4] = algorithmLength & 0xff;
    output[5] = algorithmLength >>> 8;
    let offset = 6;
    output.set(userId, offset);
    offset += userId.length;
    output.set(selfSigningPublicKey, offset);
    offset += selfSigningPublicKey.length;
    output.set(masterSignature, offset);
    offset += masterSignature.length;
    output.set(deviceId, offset);
    offset += deviceId.length;
    output.set(algorithmBytes.slice(0, algorithmLength), offset);
    offset += algorithmLength;
    output.set(deviceCurve25519Key, offset);
    offset += deviceCurve25519Key.length;
    output.set(deviceEd25519Key, offset);
    offset += deviceEd25519Key.length;
    output.set(selfSigningSignature, offset);
    return output;
}

/**
 * Build the two canonical signed objects used by the Matrix Ownership adapter.
 * The packed return value keeps this boundary usable by ScriptC without passing
 * a verifier callback (function values are not part of JamScript's crypto ABI).
 *
 * Layout: u16 masterMessageLength, u16 deviceMessageLength, masterMessage,
 * masterSignature[64], selfSigningPublicKey[32], deviceMessage,
 * selfSigningSignature[64]. An empty result means malformed or mismatched input.
 */
function matrixOwnershipVerificationPayload(subject: JamOwnership, controller: JamOwnership, encodedProof: Uint8Array): Uint8Array {
    if (!isEd25519Ownership(subject) || !isEd25519Ownership(controller))
        return new Uint8Array(0);
    try {
        const proof = decodeMatrixControlClaimProofV1Bytes(encodedProof);
        const userLength = matrixPayloadReadU16(proof, 0);
        const deviceLength = matrixPayloadReadU16(proof, 2);
        const algorithmsLength = matrixPayloadReadU16(proof, 4);
        let offset = 6;
        const userId = proof.slice(offset, offset + userLength);
        offset += userLength;
        const selfSigningKey = proof.slice(offset, offset + 32);
        offset += 32;
        const masterSignature = proof.slice(offset, offset + 64);
        offset += 64;
        const deviceId = proof.slice(offset, offset + deviceLength);
        offset += deviceLength;
        const algorithms = proof.slice(offset, offset + algorithmsLength);
        offset += algorithmsLength;
        const deviceCurve25519Key = proof.slice(offset, offset + 32);
        offset += 32;
        const deviceEd25519Key = proof.slice(offset, offset + 32);
        offset += 32;
        const selfSigningSignature = proof.slice(offset, offset + 64);
        if (!matrixSameBytes(deviceEd25519Key, controller.public))
            return new Uint8Array(0);
        const encodedSelfSigningKey = base64Bytes(selfSigningKey);
        const masterMessage = concatBytes(staticAscii([123, 34, 107, 101, 121, 115, 34, 58, 123, 34, 101, 100, 50, 53, 53, 49, 57, 58]), encodedSelfSigningKey, staticAscii([34, 58, 34]), encodedSelfSigningKey, staticAscii([34, 125, 44, 34, 117, 115, 97, 103, 101, 34, 58, 91, 34, 115, 101, 108, 102, 95, 115, 105, 103, 110, 105, 110, 103, 34, 93, 44, 34, 117, 115, 101, 114, 95, 105, 100, 34, 58, 34]), userId, staticAscii([34, 125]));
        const deviceMessage = concatBytes(staticAscii([123, 34, 97, 108, 103, 111, 114, 105, 116, 104, 109, 115, 34, 58, 91]), algorithms, staticAscii([93, 44, 34, 100, 101, 118, 105, 99, 101, 95, 105, 100, 34, 58, 34]), deviceId, staticAscii([34, 44, 34, 107, 101, 121, 115, 34, 58, 123, 34, 99, 117, 114, 118, 101, 50, 53, 53, 49, 57, 58]), deviceId, staticAscii([34, 58, 34]), base64Bytes(deviceCurve25519Key), staticAscii([34, 44, 34, 101, 100, 50, 53, 53, 49, 57, 58]), deviceId, staticAscii([34, 58, 34]), base64Bytes(deviceEd25519Key), staticAscii([34, 125, 44, 34, 117, 115, 101, 114, 95, 105, 100, 34, 58, 34]), userId, staticAscii([34, 125]));
        return packVerificationPayload(masterMessage, masterSignature, selfSigningKey, deviceMessage, selfSigningSignature);
    }
    catch {
        return new Uint8Array(0);
    }
}

function packVerificationPayload(masterMessage: Uint8Array, masterSignature: Uint8Array, selfSigningKey: Uint8Array, deviceMessage: Uint8Array, deviceSignature: Uint8Array): Uint8Array {
    const output = new Uint8Array(4 + masterMessage.length + 64 + 32 + deviceMessage.length + 64);
    writeU16(output, 0, masterMessage.length);
    writeU16(output, 2, deviceMessage.length);
    let offset = 4;
    output.set(masterMessage, offset);
    offset += masterMessage.length;
    output.set(masterSignature, offset);
    offset += 64;
    output.set(selfSigningKey, offset);
    offset += 32;
    output.set(deviceMessage, offset);
    offset += deviceMessage.length;
    output.set(deviceSignature, offset);
    return output;
}

function writeU16(target: Uint8Array, offset: number, value: number): void {
    target[offset] = value & 0xff;
    target[offset + 1] = value >>> 8;
}

function matrixPayloadReadU16(value: Uint8Array, offset: number): number {
    return value[offset] | (value[offset + 1] << 8);
}

function isEd25519Ownership(value: JamOwnership): boolean {
    return value.version === 1 && value.kind === 0 && value.public.length === 32;
}

function matrixSameBytes(left: Uint8Array, right: Uint8Array): boolean {
    if (left.length !== right.length)
        return false;
    for (let index = 0; index < left.length; index += 1)
        if (left[index] !== right[index])
            return false;
    return true;
}

function staticAscii(values: number[]): Uint8Array {
    const output = new Uint8Array(values.length);
    for (let index = 0; index < values.length; index += 1)
        output[index] = values[index];
    return output;
}

function concatBytes(...parts: Uint8Array[]): Uint8Array {
    let total = 0;
    for (let index = 0; index < parts.length; index += 1)
        total += parts[index].length;
    const output = new Uint8Array(total);
    let offset = 0;
    for (let index = 0; index < parts.length; index += 1) {
        output.set(parts[index], offset);
        offset += parts[index].length;
    }
    return output;
}

function base64Bytes(bytes: Uint8Array): Uint8Array {
    const output = new Uint8Array(Math.floor((bytes.length * 4 + 2) / 3));
    let outputIndex = 0;
    for (let offset = 0; offset < bytes.length; offset += 3) {
        const hasSecond = offset + 1 < bytes.length;
        const hasThird = offset + 2 < bytes.length;
        const first = bytes[offset];
        const second = hasSecond ? bytes[offset + 1] : 0;
        const third = hasThird ? bytes[offset + 2] : 0;
        output[outputIndex++] = base64Ascii(first >>> 2);
        output[outputIndex++] = base64Ascii(((first & 3) << 4) | (second >>> 4));
        if (hasSecond)
            output[outputIndex++] = base64Ascii(((second & 15) << 2) | (third >>> 6));
        if (hasThird)
            output[outputIndex++] = base64Ascii(third & 63);
    }
    return output;
}

function base64Ascii(index: number): number {
    if (index < 26)
        return index + 65;
    if (index < 52)
        return index - 26 + 97;
    if (index < 62)
        return index - 52 + 48;
    if (index === 62)
        return 43;
    return 47;
}

function verifyMatrixOwnershipAuthorizationScriptc(subject: JamOwnership, controller: JamOwnership, proof: Uint8Array): boolean {
    const payload = matrixOwnershipVerificationPayload(subject, controller, proof);
    if (payload.length < 4 + 64 + 32 + 64)
        return false;
    const masterMessageLength = matrixScriptcReadU16(payload, 0);
    const deviceMessageLength = matrixScriptcReadU16(payload, 2);
    const expectedLength = 4 + masterMessageLength + 64 + 32 + deviceMessageLength + 64;
    if (payload.length !== expectedLength)
        return false;
    let offset = 4;
    const masterMessage = payload.slice(offset, offset + masterMessageLength);
    offset += masterMessageLength;
    const masterSignature = payload.slice(offset, offset + 64);
    offset += 64;
    const selfSigningKey = payload.slice(offset, offset + 32);
    offset += 32;
    const deviceMessage = payload.slice(offset, offset + deviceMessageLength);
    offset += deviceMessageLength;
    const deviceSignature = payload.slice(offset, offset + 64);
    if (!verifyEd25519(subject.public, masterMessage, masterSignature))
        return false;
    return verifyEd25519(selfSigningKey, deviceMessage, deviceSignature);
}

function matrixScriptcReadU16(value: Uint8Array, offset: number): number {
    return value[offset] | (value[offset + 1] << 8);
}

function sameBytes(left: Uint8Array, right: Uint8Array): boolean {
    if (left.length !== right.length)
        return false;
    for (let index = 0; index < left.length; index += 1) {
        if (left[index] !== right[index])
            return false;
    }
    return true;
}

function sameOwnership(left: JamOwnership, right: JamOwnership): boolean {
    return left.version === right.version
        && left.kind === right.kind
        && sameBytes(left.public, right.public);
}

function isZeroBytes(value: Uint8Array): boolean {
    for (let index = 0; index < value.length; index += 1) {
        if (value[index] !== 0)
            return false;
    }
    return true;
}

function requireAssetId(assetId: Uint8Array): void {
    if (isZeroBytes(assetId))
        abort(2003);
}

function checkedAdd(left: JamU128, right: JamU128): JamU128 {
    if (jamU128Compare(right, jamU128SubChecked(jamU128Const("340282366920938463463374607431768211455"), left)) > 0)
        abort(3003);
    return jamU128AddChecked(left, right);
}

function checkedSub(left: JamU128, right: JamU128): JamU128 {
    if (jamU128Compare(right, left) > 0)
        abort(3002);
    return jamU128SubChecked(left, right);
}

function checkedMul(left: JamU128, right: JamU128): JamU128 {
    if (jamU128Compare(left, jamU128Const("0")) !== 0 && jamU128Compare(right, jamU128DivChecked(jamU128Const("340282366920938463463374607431768211455"), left)) > 0)
        abort(3003);
    return jamU128MulChecked(left, right);
}

function requirePoolReserve(value: JamU128): void {
    if (jamU128Compare(value, jamU128Const("18446744073709551615")) > 0)
        abort(6008);
}

function ceilDiv(value: JamU128, denominator: JamU128): JamU128 {
    let zero = jamU128Const("0");
    let one = jamU128Const("1");
    if (jamU128Compare(denominator, zero) === 0)
        abort(9001);
    if (jamU128Compare(value, zero) === 0)
        return zero;
    return jamU128AddChecked(one, jamU128DivChecked((jamU128SubChecked(value, one)), denominator));
}

function requireInitialShares(amountA: JamU128, amountB: JamU128, shares: JamU128): void {
    let zero = jamU128Const("0");
    const maxPoolReserve = jamU128Const("18446744073709551615");
    if (jamU128Compare(shares, zero) === 0)
        abort(6009);
    if (jamU128Compare(shares, maxPoolReserve) > 0)
        abort(6008);
    // Both reserves are checked against u64::MAX before this helper is called,
    // so all three products below fit in u128 without a division-based overflow check.
    const product = jamU128MulChecked(amountA, amountB);
    const sharesSquared = jamU128MulChecked(shares, shares);
    if (jamU128Compare(sharesSquared, product) > 0)
        abort(6009);
    if (jamU128Compare(shares, maxPoolReserve) < 0) {
        const nextShares = jamU128AddChecked(shares, jamU128Const("1"));
        if (jamU128Compare(jamU128MulChecked(nextShares, nextShares), product) <= 0)
            abort(6009);
    }
}

function requirePoolInvariant(totalShares: JamU128, reserve0: JamU128, reserve1: JamU128): void {
    let zero = jamU128Const("0");
    requirePoolReserve(totalShares);
    const empty = jamU128Compare(reserve0, zero) === 0 && jamU128Compare(reserve1, zero) === 0;
    if (jamU128Compare(totalShares, zero) === 0) {
        if (!empty)
            abort(9001);
    }
    else {
        if (empty || jamU128Compare(reserve0, zero) === 0 || jamU128Compare(reserve1, zero) === 0)
            abort(9001);
    }
}

function liquidityShareKey(assetA: Uint8Array, assetB: Uint8Array, owner: JamOwnership) {
    const poolKey = canonicalPoolKey(assetA, assetB);
    return { ...poolKey, ownerKey: ownerKey(owner) };
}

function ensureLiquidityPositionIndexed(poolKey: {
    asset0: Uint8Array;
    asset1: Uint8Array;
}, owner: JamOwnership): void {
    const key = liquidityShareKey(poolKey.asset0, poolKey.asset1, owner);
    if (liquidityShares.has(key))
        return;
    const ownerId = ownerKey(owner);
    const count = jamU64Or(liquidityPositionCount.get(ownerId), jamU64Const("0"));
    if (jamU64Compare(count, jamU64Const("18446744073709551615")) === 0)
        abort(3003);
    liquidityPositionByIndex.set({ ownerKey: ownerId, index: count }, poolKey);
    liquidityPositionCount.set(ownerId, jamU64AddChecked(count, jamU64Const("1")));
}

function exactInputAmountOut(reserveIn: JamU128, reserveOut: JamU128, amountIn: JamU128): JamU128 {
    const amountInAfterFee = jamU128DivChecked(checkedMul(amountIn, jamU128Const("9970")), jamU128Const("10000"));
    if (jamU128Compare(amountInAfterFee, jamU128Const("0")) === 0)
        abort(6004);
    return jamU128DivChecked(checkedMul(reserveOut, amountInAfterFee), checkedAdd(reserveIn, amountInAfterFee));
}

function compareAssetIds(left: Uint8Array, right: Uint8Array): number {
    for (let index = 0; index < 32; index += 1) {
        if (left[index] < right[index])
            return -1;
        if (left[index] > right[index])
            return 1;
    }
    return 0;
}

function canonicalPoolKey(assetA: Uint8Array, assetB: Uint8Array) {
    requireAssetId(assetA);
    requireAssetId(assetB);
    const order = compareAssetIds(assetA, assetB);
    if (order === 0)
        abort(6003);
    return order < 0 ? { asset0: assetA, asset1: assetB } : { asset0: assetB, asset1: assetA };
}

function poolValueForAsset(assetA: Uint8Array, asset0: Uint8Array, valueA: JamU128, valueB: JamU128): JamU128 {
    if (compareAssetIds(assetA, asset0) === 0)
        return valueA;
    return valueB;
}

function ownerKey(owner: JamOwnership): Uint8Array {
    return ownershipKey(owner);
}

function balanceKey(assetId: Uint8Array, owner: JamOwnership) {
    return { assetId, ownerKey: ownerKey(owner) };
}

function allowanceKey(assetId: Uint8Array, owner: JamOwnership, spender: JamOwnership) {
    return {
        assetId,
        ownerKey: ownerKey(owner),
        spenderKey: ownerKey(spender)
    };
}

function controllerKey(subject: JamOwnership, controller: JamOwnership) {
    return {
        subjectKey: ownerKey(subject),
        controllerKey: ownerKey(controller)
    };
}

function requireController(subject: JamOwnership, controller: JamOwnership): void {
    if (sameOwnership(subject, controller))
        return;
    const grant = controllerGrants.get(controllerKey(subject, controller)) ?? 0;
    if (jamU8Compare(grant, 1) !== 0)
        abort(5001);
}

function requireActiveController(subject: JamOwnership, controller: JamOwnership): void {
    if (jamU8Compare((controllerGrants.get(controllerKey(subject, controller)) ?? 0), 1) !== 0) {
        abort(5006);
    }
}

const namespace_assets = new Uint8Array([108, 111, 99, 117, 115, 46, 97, 115, 115, 101, 116, 46, 118, 50]);
function decode_assets_value(raw: Uint8Array): { version: number; issuer: JamOwnership; name: Uint8Array; symbol: Uint8Array; decimals: number; totalSupply: JamU128 } { const cursor: JamCursor = { input: raw, offset: 0 }; const v0 = jamU8(cursor); const v1 = decodeOwnershipAt(cursor); const v3 = jamNatural(cursor); if (v3 > 64) throw new Error("bound exceeded"); const v4 = jamTake(cursor, v3); const v2 = v4; const v6 = jamNatural(cursor); if (v6 > 16) throw new Error("bound exceeded"); const v7 = jamTake(cursor, v6); const v5 = v7; const v8 = jamU8(cursor); const v9 = jamU128(cursor); const result = { version: v0, issuer: v1, name: v2, symbol: v5, decimals: v8, totalSupply: v9 }; if (cursor.offset !== raw.length) throw new Error("trailing JAM bytes"); return result; }
function encode_assets_value(value: { version: number; issuer: JamOwnership; name: Uint8Array; symbol: Uint8Array; decimals: number; totalSupply: JamU128 }): Uint8Array { return jamConcat([jamEncodeU8(value.version), encodeOwnership(value.issuer), jamBounded(value.name, 64), jamBounded(value.symbol, 16), jamEncodeU8(value.decimals), jamEncodeU128(value.totalSupply)]); }
function key_assets(key: Uint8Array): Uint8Array { const canonical = jamFixed(key, 32); return applicationKeyV1(namespace_assets, canonical); }
const assets = {
  get(key: Uint8Array): { version: number; issuer: JamOwnership; name: Uint8Array; symbol: Uint8Array; decimals: number; totalSupply: JamU128 } | null { const raw = stateGetRaw(key_assets(key)); return raw === null ? null : decode_assets_value(raw); },
  has(key: Uint8Array): boolean { return stateHasRaw(key_assets(key)); },
  set(key: Uint8Array, value: { version: number; issuer: JamOwnership; name: Uint8Array; symbol: Uint8Array; decimals: number; totalSupply: JamU128 }): void { stateSetRaw(key_assets(key), encode_assets_value(value)); },
  delete(key: Uint8Array): void { stateDeleteRaw(key_assets(key)); },
};

const namespace_assetCount = new Uint8Array([108, 111, 99, 117, 115, 46, 97, 115, 115, 101, 116, 45, 99, 111, 117, 110, 116, 46, 118, 50]);
function decode_assetCount_value(raw: Uint8Array): JamU64 { const cursor: JamCursor = { input: raw, offset: 0 };  const result = jamU64(cursor); if (cursor.offset !== raw.length) throw new Error("trailing JAM bytes"); return result; }
function encode_assetCount_value(value: JamU64): Uint8Array { return jamEncodeU64(value); }
function key_assetCount(): Uint8Array { const canonical = new Uint8Array(0); return applicationKeyV1(namespace_assetCount, canonical); }
const assetCount = {
  get(): JamU64 | null { const raw = stateGetRaw(key_assetCount()); return raw === null ? null : decode_assetCount_value(raw); },
  has(): boolean { return stateHasRaw(key_assetCount()); },
  set(value: JamU64): void { stateSetRaw(key_assetCount(), encode_assetCount_value(value)); },
  delete(): void { stateDeleteRaw(key_assetCount()); },
};

const namespace_assetByIndex = new Uint8Array([108, 111, 99, 117, 115, 46, 97, 115, 115, 101, 116, 45, 105, 110, 100, 101, 120, 46, 118, 50]);
function decode_assetByIndex_value(raw: Uint8Array): Uint8Array { const cursor: JamCursor = { input: raw, offset: 0 };  const result = jamTake(cursor, 32); if (cursor.offset !== raw.length) throw new Error("trailing JAM bytes"); return result; }
function encode_assetByIndex_value(value: Uint8Array): Uint8Array { return jamFixed(value, 32); }
function key_assetByIndex(key: JamU64): Uint8Array { const canonical = jamEncodeU64(key); return applicationKeyV1(namespace_assetByIndex, canonical); }
const assetByIndex = {
  get(key: JamU64): Uint8Array | null { const raw = stateGetRaw(key_assetByIndex(key)); return raw === null ? null : decode_assetByIndex_value(raw); },
  has(key: JamU64): boolean { return stateHasRaw(key_assetByIndex(key)); },
  set(key: JamU64, value: Uint8Array): void { stateSetRaw(key_assetByIndex(key), encode_assetByIndex_value(value)); },
  delete(key: JamU64): void { stateDeleteRaw(key_assetByIndex(key)); },
};

const namespace_balances = new Uint8Array([108, 111, 99, 117, 115, 46, 98, 97, 108, 97, 110, 99, 101, 46, 118, 50]);
function decode_balances_value(raw: Uint8Array): JamU128 { const cursor: JamCursor = { input: raw, offset: 0 };  const result = jamU128(cursor); if (cursor.offset !== raw.length) throw new Error("trailing JAM bytes"); return result; }
function encode_balances_value(value: JamU128): Uint8Array { return jamEncodeU128(value); }
function key_balances(key: { assetId: Uint8Array; ownerKey: Uint8Array }): Uint8Array { const canonical = jamConcat([jamFixed(key.assetId, 32), jamFixed(key.ownerKey, 32)]); return applicationKeyV1(namespace_balances, canonical); }
const balances = {
  get(key: { assetId: Uint8Array; ownerKey: Uint8Array }): JamU128 | null { const raw = stateGetRaw(key_balances(key)); return raw === null ? null : decode_balances_value(raw); },
  has(key: { assetId: Uint8Array; ownerKey: Uint8Array }): boolean { return stateHasRaw(key_balances(key)); },
  set(key: { assetId: Uint8Array; ownerKey: Uint8Array }, value: JamU128): void { stateSetRaw(key_balances(key), encode_balances_value(value)); },
  delete(key: { assetId: Uint8Array; ownerKey: Uint8Array }): void { stateDeleteRaw(key_balances(key)); },
};

const namespace_allowances = new Uint8Array([108, 111, 99, 117, 115, 46, 97, 108, 108, 111, 119, 97, 110, 99, 101, 46, 118, 50]);
function decode_allowances_value(raw: Uint8Array): JamU128 { const cursor: JamCursor = { input: raw, offset: 0 };  const result = jamU128(cursor); if (cursor.offset !== raw.length) throw new Error("trailing JAM bytes"); return result; }
function encode_allowances_value(value: JamU128): Uint8Array { return jamEncodeU128(value); }
function key_allowances(key: { assetId: Uint8Array; ownerKey: Uint8Array; spenderKey: Uint8Array }): Uint8Array { const canonical = jamConcat([jamFixed(key.assetId, 32), jamFixed(key.ownerKey, 32), jamFixed(key.spenderKey, 32)]); return applicationKeyV1(namespace_allowances, canonical); }
const allowances = {
  get(key: { assetId: Uint8Array; ownerKey: Uint8Array; spenderKey: Uint8Array }): JamU128 | null { const raw = stateGetRaw(key_allowances(key)); return raw === null ? null : decode_allowances_value(raw); },
  has(key: { assetId: Uint8Array; ownerKey: Uint8Array; spenderKey: Uint8Array }): boolean { return stateHasRaw(key_allowances(key)); },
  set(key: { assetId: Uint8Array; ownerKey: Uint8Array; spenderKey: Uint8Array }, value: JamU128): void { stateSetRaw(key_allowances(key), encode_allowances_value(value)); },
  delete(key: { assetId: Uint8Array; ownerKey: Uint8Array; spenderKey: Uint8Array }): void { stateDeleteRaw(key_allowances(key)); },
};

const namespace_controllerGrants = new Uint8Array([108, 111, 99, 117, 115, 46, 99, 111, 110, 116, 114, 111, 108, 108, 101, 114, 45, 103, 114, 97, 110, 116, 46, 118, 49]);
function decode_controllerGrants_value(raw: Uint8Array): number { const cursor: JamCursor = { input: raw, offset: 0 };  const result = jamU8(cursor); if (cursor.offset !== raw.length) throw new Error("trailing JAM bytes"); return result; }
function encode_controllerGrants_value(value: number): Uint8Array { return jamEncodeU8(value); }
function key_controllerGrants(key: { subjectKey: Uint8Array; controllerKey: Uint8Array }): Uint8Array { const canonical = jamConcat([jamFixed(key.subjectKey, 32), jamFixed(key.controllerKey, 32)]); return applicationKeyV1(namespace_controllerGrants, canonical); }
const controllerGrants = {
  get(key: { subjectKey: Uint8Array; controllerKey: Uint8Array }): number | null { const raw = stateGetRaw(key_controllerGrants(key)); return raw === null ? null : decode_controllerGrants_value(raw); },
  has(key: { subjectKey: Uint8Array; controllerKey: Uint8Array }): boolean { return stateHasRaw(key_controllerGrants(key)); },
  set(key: { subjectKey: Uint8Array; controllerKey: Uint8Array }, value: number): void { stateSetRaw(key_controllerGrants(key), encode_controllerGrants_value(value)); },
  delete(key: { subjectKey: Uint8Array; controllerKey: Uint8Array }): void { stateDeleteRaw(key_controllerGrants(key)); },
};

const namespace_pools = new Uint8Array([108, 111, 99, 117, 115, 46, 112, 111, 111, 108, 46, 118, 50]);
function decode_pools_value(raw: Uint8Array): { version: number; reserve0: JamU128; reserve1: JamU128; totalShares: JamU128 } { const cursor: JamCursor = { input: raw, offset: 0 }; const v0 = jamU8(cursor); const v1 = jamU128(cursor); const v2 = jamU128(cursor); const v3 = jamU128(cursor); const result = { version: v0, reserve0: v1, reserve1: v2, totalShares: v3 }; if (cursor.offset !== raw.length) throw new Error("trailing JAM bytes"); return result; }
function encode_pools_value(value: { version: number; reserve0: JamU128; reserve1: JamU128; totalShares: JamU128 }): Uint8Array { return jamConcat([jamEncodeU8(value.version), jamEncodeU128(value.reserve0), jamEncodeU128(value.reserve1), jamEncodeU128(value.totalShares)]); }
function key_pools(key: { asset0: Uint8Array; asset1: Uint8Array }): Uint8Array { const canonical = jamConcat([jamFixed(key.asset0, 32), jamFixed(key.asset1, 32)]); return applicationKeyV1(namespace_pools, canonical); }
const pools = {
  get(key: { asset0: Uint8Array; asset1: Uint8Array }): { version: number; reserve0: JamU128; reserve1: JamU128; totalShares: JamU128 } | null { const raw = stateGetRaw(key_pools(key)); return raw === null ? null : decode_pools_value(raw); },
  has(key: { asset0: Uint8Array; asset1: Uint8Array }): boolean { return stateHasRaw(key_pools(key)); },
  set(key: { asset0: Uint8Array; asset1: Uint8Array }, value: { version: number; reserve0: JamU128; reserve1: JamU128; totalShares: JamU128 }): void { stateSetRaw(key_pools(key), encode_pools_value(value)); },
  delete(key: { asset0: Uint8Array; asset1: Uint8Array }): void { stateDeleteRaw(key_pools(key)); },
};

const namespace_poolCount = new Uint8Array([108, 111, 99, 117, 115, 46, 112, 111, 111, 108, 45, 99, 111, 117, 110, 116, 46, 118, 50]);
function decode_poolCount_value(raw: Uint8Array): JamU64 { const cursor: JamCursor = { input: raw, offset: 0 };  const result = jamU64(cursor); if (cursor.offset !== raw.length) throw new Error("trailing JAM bytes"); return result; }
function encode_poolCount_value(value: JamU64): Uint8Array { return jamEncodeU64(value); }
function key_poolCount(): Uint8Array { const canonical = new Uint8Array(0); return applicationKeyV1(namespace_poolCount, canonical); }
const poolCount = {
  get(): JamU64 | null { const raw = stateGetRaw(key_poolCount()); return raw === null ? null : decode_poolCount_value(raw); },
  has(): boolean { return stateHasRaw(key_poolCount()); },
  set(value: JamU64): void { stateSetRaw(key_poolCount(), encode_poolCount_value(value)); },
  delete(): void { stateDeleteRaw(key_poolCount()); },
};

const namespace_poolByIndex = new Uint8Array([108, 111, 99, 117, 115, 46, 112, 111, 111, 108, 45, 105, 110, 100, 101, 120, 46, 118, 50]);
function decode_poolByIndex_value(raw: Uint8Array): { asset0: Uint8Array; asset1: Uint8Array } { const cursor: JamCursor = { input: raw, offset: 0 }; const v0 = jamTake(cursor, 32); const v1 = jamTake(cursor, 32); const result = { asset0: v0, asset1: v1 }; if (cursor.offset !== raw.length) throw new Error("trailing JAM bytes"); return result; }
function encode_poolByIndex_value(value: { asset0: Uint8Array; asset1: Uint8Array }): Uint8Array { return jamConcat([jamFixed(value.asset0, 32), jamFixed(value.asset1, 32)]); }
function key_poolByIndex(key: JamU64): Uint8Array { const canonical = jamEncodeU64(key); return applicationKeyV1(namespace_poolByIndex, canonical); }
const poolByIndex = {
  get(key: JamU64): { asset0: Uint8Array; asset1: Uint8Array } | null { const raw = stateGetRaw(key_poolByIndex(key)); return raw === null ? null : decode_poolByIndex_value(raw); },
  has(key: JamU64): boolean { return stateHasRaw(key_poolByIndex(key)); },
  set(key: JamU64, value: { asset0: Uint8Array; asset1: Uint8Array }): void { stateSetRaw(key_poolByIndex(key), encode_poolByIndex_value(value)); },
  delete(key: JamU64): void { stateDeleteRaw(key_poolByIndex(key)); },
};

const namespace_liquidityShares = new Uint8Array([108, 111, 99, 117, 115, 46, 108, 105, 113, 117, 105, 100, 105, 116, 121, 45, 115, 104, 97, 114, 101, 46, 118, 49]);
function decode_liquidityShares_value(raw: Uint8Array): JamU128 { const cursor: JamCursor = { input: raw, offset: 0 };  const result = jamU128(cursor); if (cursor.offset !== raw.length) throw new Error("trailing JAM bytes"); return result; }
function encode_liquidityShares_value(value: JamU128): Uint8Array { return jamEncodeU128(value); }
function key_liquidityShares(key: { asset0: Uint8Array; asset1: Uint8Array; ownerKey: Uint8Array }): Uint8Array { const canonical = jamConcat([jamFixed(key.asset0, 32), jamFixed(key.asset1, 32), jamFixed(key.ownerKey, 32)]); return applicationKeyV1(namespace_liquidityShares, canonical); }
const liquidityShares = {
  get(key: { asset0: Uint8Array; asset1: Uint8Array; ownerKey: Uint8Array }): JamU128 | null { const raw = stateGetRaw(key_liquidityShares(key)); return raw === null ? null : decode_liquidityShares_value(raw); },
  has(key: { asset0: Uint8Array; asset1: Uint8Array; ownerKey: Uint8Array }): boolean { return stateHasRaw(key_liquidityShares(key)); },
  set(key: { asset0: Uint8Array; asset1: Uint8Array; ownerKey: Uint8Array }, value: JamU128): void { stateSetRaw(key_liquidityShares(key), encode_liquidityShares_value(value)); },
  delete(key: { asset0: Uint8Array; asset1: Uint8Array; ownerKey: Uint8Array }): void { stateDeleteRaw(key_liquidityShares(key)); },
};

const namespace_liquidityPositionCount = new Uint8Array([108, 111, 99, 117, 115, 46, 108, 105, 113, 117, 105, 100, 105, 116, 121, 45, 112, 111, 115, 105, 116, 105, 111, 110, 45, 99, 111, 117, 110, 116, 46, 118, 49]);
function decode_liquidityPositionCount_value(raw: Uint8Array): JamU64 { const cursor: JamCursor = { input: raw, offset: 0 };  const result = jamU64(cursor); if (cursor.offset !== raw.length) throw new Error("trailing JAM bytes"); return result; }
function encode_liquidityPositionCount_value(value: JamU64): Uint8Array { return jamEncodeU64(value); }
function key_liquidityPositionCount(key: Uint8Array): Uint8Array { const canonical = jamFixed(key, 32); return applicationKeyV1(namespace_liquidityPositionCount, canonical); }
const liquidityPositionCount = {
  get(key: Uint8Array): JamU64 | null { const raw = stateGetRaw(key_liquidityPositionCount(key)); return raw === null ? null : decode_liquidityPositionCount_value(raw); },
  has(key: Uint8Array): boolean { return stateHasRaw(key_liquidityPositionCount(key)); },
  set(key: Uint8Array, value: JamU64): void { stateSetRaw(key_liquidityPositionCount(key), encode_liquidityPositionCount_value(value)); },
  delete(key: Uint8Array): void { stateDeleteRaw(key_liquidityPositionCount(key)); },
};

const namespace_liquidityPositionByIndex = new Uint8Array([108, 111, 99, 117, 115, 46, 108, 105, 113, 117, 105, 100, 105, 116, 121, 45, 112, 111, 115, 105, 116, 105, 111, 110, 45, 105, 110, 100, 101, 120, 46, 118, 49]);
function decode_liquidityPositionByIndex_value(raw: Uint8Array): { asset0: Uint8Array; asset1: Uint8Array } { const cursor: JamCursor = { input: raw, offset: 0 }; const v0 = jamTake(cursor, 32); const v1 = jamTake(cursor, 32); const result = { asset0: v0, asset1: v1 }; if (cursor.offset !== raw.length) throw new Error("trailing JAM bytes"); return result; }
function encode_liquidityPositionByIndex_value(value: { asset0: Uint8Array; asset1: Uint8Array }): Uint8Array { return jamConcat([jamFixed(value.asset0, 32), jamFixed(value.asset1, 32)]); }
function key_liquidityPositionByIndex(key: { ownerKey: Uint8Array; index: JamU64 }): Uint8Array { const canonical = jamConcat([jamFixed(key.ownerKey, 32), jamEncodeU64(key.index)]); return applicationKeyV1(namespace_liquidityPositionByIndex, canonical); }
const liquidityPositionByIndex = {
  get(key: { ownerKey: Uint8Array; index: JamU64 }): { asset0: Uint8Array; asset1: Uint8Array } | null { const raw = stateGetRaw(key_liquidityPositionByIndex(key)); return raw === null ? null : decode_liquidityPositionByIndex_value(raw); },
  has(key: { ownerKey: Uint8Array; index: JamU64 }): boolean { return stateHasRaw(key_liquidityPositionByIndex(key)); },
  set(key: { ownerKey: Uint8Array; index: JamU64 }, value: { asset0: Uint8Array; asset1: Uint8Array }): void { stateSetRaw(key_liquidityPositionByIndex(key), encode_liquidityPositionByIndex_value(value)); },
  delete(key: { ownerKey: Uint8Array; index: JamU64 }): void { stateDeleteRaw(key_liquidityPositionByIndex(key)); },
};

function decode_authorizeMatrixController_input(raw: Uint8Array): { subject: JamOwnership; proof: Uint8Array } { const cursor: JamCursor = { input: raw, offset: 0 }; const v0 = decodeOwnershipAt(cursor); const v2 = jamNatural(cursor); if (v2 > 4096) throw new Error("bound exceeded"); const v3 = jamTake(cursor, v2); const v1 = v3; const result = { subject: v0, proof: v1 }; if (cursor.offset !== raw.length) throw new Error("trailing JAM bytes"); return result; }
function execute_authorizeMatrixController(ctx: { owner: JamOwnership; controller: JamOwnership }, input: { subject: JamOwnership; proof: Uint8Array }): void {
    const key = controllerKey(input.subject, ctx.controller);
    const existingGrant = controllerGrants.get(key) ?? 0;
    if (jamU8Compare(existingGrant, 1) === 0)
        return;
    if (controllerGrants.has(key))
        abort(5003);
    if (input.subject.kind !== 0 || ctx.controller.kind !== 0)
        abort(5005);
    if (!verifyMatrixOwnershipAuthorizationScriptc(input.subject, ctx.controller, input.proof))
        abort(5005);
    controllerGrants.set(key, 1);
}
export function __jamscript_action_authorizeMatrixController_v1(payload: Uint8Array, sender: Uint8Array, stateView: Uint8Array): Uint8Array { try { initializeStateView(stateView); const context = decodeOwnershipAuthContext(sender); const input = decode_authorizeMatrixController_input(payload); execute_authorizeMatrixController(context, input); return appliedResult(); } catch (error) { return caughtResult(error); } }

function decode_addController_input(raw: Uint8Array): { subject: JamOwnership; controller: JamOwnership } { const cursor: JamCursor = { input: raw, offset: 0 }; const v0 = decodeOwnershipAt(cursor); const v1 = decodeOwnershipAt(cursor); const result = { subject: v0, controller: v1 }; if (cursor.offset !== raw.length) throw new Error("trailing JAM bytes"); return result; }
function execute_addController(ctx: { owner: JamOwnership; controller: JamOwnership }, input: { subject: JamOwnership; controller: JamOwnership }): void {
    requireController(input.subject, ctx.controller);
    const key = controllerKey(input.subject, input.controller);
    if (jamU8Compare((controllerGrants.get(key) ?? 0), 1) === 0)
        abort(5002);
    if (controllerGrants.has(key))
        abort(5003);
    controllerGrants.set(key, 1);
}
export function __jamscript_action_addController_v1(payload: Uint8Array, sender: Uint8Array, stateView: Uint8Array): Uint8Array { try { initializeStateView(stateView); const context = decodeOwnershipAuthContext(sender); const input = decode_addController_input(payload); execute_addController(context, input); return appliedResult(); } catch (error) { return caughtResult(error); } }

function decode_revokeController_input(raw: Uint8Array): { subject: JamOwnership; controller: JamOwnership } { const cursor: JamCursor = { input: raw, offset: 0 }; const v0 = decodeOwnershipAt(cursor); const v1 = decodeOwnershipAt(cursor); const result = { subject: v0, controller: v1 }; if (cursor.offset !== raw.length) throw new Error("trailing JAM bytes"); return result; }
function execute_revokeController(ctx: { owner: JamOwnership; controller: JamOwnership }, input: { subject: JamOwnership; controller: JamOwnership }): void {
    requireController(input.subject, ctx.controller);
    requireActiveController(input.subject, input.controller);
    controllerGrants.set(controllerKey(input.subject, input.controller), 0);
}
export function __jamscript_action_revokeController_v1(payload: Uint8Array, sender: Uint8Array, stateView: Uint8Array): Uint8Array { try { initializeStateView(stateView); const context = decodeOwnershipAuthContext(sender); const input = decode_revokeController_input(payload); execute_revokeController(context, input); return appliedResult(); } catch (error) { return caughtResult(error); } }

function decode_createAsset_input(raw: Uint8Array): { subject: JamOwnership; assetId: Uint8Array; name: Uint8Array; symbol: Uint8Array; decimals: number; initialSupply: JamU128; initialHolder: JamOwnership } { const cursor: JamCursor = { input: raw, offset: 0 }; const v0 = decodeOwnershipAt(cursor); const v1 = jamTake(cursor, 32); const v3 = jamNatural(cursor); if (v3 > 64) throw new Error("bound exceeded"); const v4 = jamTake(cursor, v3); const v2 = v4; const v6 = jamNatural(cursor); if (v6 > 16) throw new Error("bound exceeded"); const v7 = jamTake(cursor, v6); const v5 = v7; const v8 = jamU8(cursor); const v9 = jamU128(cursor); const v10 = decodeOwnershipAt(cursor); const result = { subject: v0, assetId: v1, name: v2, symbol: v5, decimals: v8, initialSupply: v9, initialHolder: v10 }; if (cursor.offset !== raw.length) throw new Error("trailing JAM bytes"); return result; }
function execute_createAsset(ctx: { owner: JamOwnership; controller: JamOwnership }, input: { subject: JamOwnership; assetId: Uint8Array; name: Uint8Array; symbol: Uint8Array; decimals: number; initialSupply: JamU128; initialHolder: JamOwnership }): void {
    requireController(input.subject, ctx.controller);
    requireAssetId(input.assetId);
    if (assets.has(input.assetId))
        abort(2002);
    if (input.name.length === 0)
        abort(2004);
    if (input.symbol.length === 0)
        abort(2005);
    if (jamU8Compare(input.decimals, 38) > 0)
        abort(2006);
    assets.set(input.assetId, {
        version: 2,
        issuer: input.subject,
        name: input.name,
        symbol: input.symbol,
        decimals: input.decimals,
        totalSupply: input.initialSupply
    });
    if (jamU128Compare(input.initialSupply, jamU128Const("0")) > 0) {
        balances.set(balanceKey(input.assetId, input.initialHolder), input.initialSupply);
    }
    const count = jamU64Or(assetCount.get(), jamU64Const("0"));
    if (jamU64Compare(count, jamU64Const("18446744073709551615")) === 0)
        abort(3003);
    assetByIndex.set(count, input.assetId);
    assetCount.set(jamU64AddChecked(count, jamU64Const("1")));
}
export function __jamscript_action_createAsset_v1(payload: Uint8Array, sender: Uint8Array, stateView: Uint8Array): Uint8Array { try { initializeStateView(stateView); const context = decodeOwnershipAuthContext(sender); const input = decode_createAsset_input(payload); execute_createAsset(context, input); return appliedResult(); } catch (error) { return caughtResult(error); } }

function decode_createPool_input(raw: Uint8Array): { subject: JamOwnership; assetA: Uint8Array; assetB: Uint8Array; amountA: JamU128; amountB: JamU128; initialShares: JamU128 } { const cursor: JamCursor = { input: raw, offset: 0 }; const v0 = decodeOwnershipAt(cursor); const v1 = jamTake(cursor, 32); const v2 = jamTake(cursor, 32); const v3 = jamU128(cursor); const v4 = jamU128(cursor); const v5 = jamU128(cursor); const result = { subject: v0, assetA: v1, assetB: v2, amountA: v3, amountB: v4, initialShares: v5 }; if (cursor.offset !== raw.length) throw new Error("trailing JAM bytes"); return result; }
function execute_createPool(ctx: { owner: JamOwnership; controller: JamOwnership }, input: { subject: JamOwnership; assetA: Uint8Array; assetB: Uint8Array; amountA: JamU128; amountB: JamU128; initialShares: JamU128 }): void {
    requireController(input.subject, ctx.controller);
    if (!assets.has(input.assetA) || !assets.has(input.assetB))
        abort(2001);
    if (jamU128Compare(input.amountA, jamU128Const("0")) === 0 || jamU128Compare(input.amountB, jamU128Const("0")) === 0)
        abort(6009);
    requirePoolReserve(input.amountA);
    requirePoolReserve(input.amountB);
    const key = canonicalPoolKey(input.assetA, input.assetB);
    if (pools.has(key))
        abort(6002);
    const ownerId = ownerKey(input.subject);
    const balanceAKey = { assetId: input.assetA, ownerKey: ownerId };
    const balanceBKey = { assetId: input.assetB, ownerKey: ownerId };
    const shareKey = { asset0: key.asset0, asset1: key.asset1, ownerKey: ownerId };
    let amount0 = input.amountA;
    let amount1 = input.amountB;
    if (compareAssetIds(input.assetA, key.asset0) !== 0) {
        amount0 = input.amountB;
        amount1 = input.amountA;
    }
    const balanceA = jamU128Or(balances.get(balanceAKey), jamU128Const("0"));
    const balanceB = jamU128Or(balances.get(balanceBKey), jamU128Const("0"));
    if (jamU128Compare(balanceA, input.amountA) < 0 || jamU128Compare(balanceB, input.amountB) < 0)
        abort(3002);
    requireInitialShares(input.amountA, input.amountB, input.initialShares);
    const existingShares = liquidityShares.has(shareKey);
    const positionCount = jamU64Or(liquidityPositionCount.get(ownerId), jamU64Const("0"));
    if (!existingShares && jamU64Compare(positionCount, jamU64Const("18446744073709551615")) === 0)
        abort(3003);
    const count = jamU64Or(poolCount.get(), jamU64Const("0"));
    if (jamU64Compare(count, jamU64Const("18446744073709551615")) === 0)
        abort(3003);
    balances.set(balanceAKey, checkedSub(balanceA, input.amountA));
    balances.set(balanceBKey, checkedSub(balanceB, input.amountB));
    pools.set(key, { version: 2, reserve0: amount0, reserve1: amount1, totalShares: input.initialShares });
    if (!existingShares) {
        liquidityPositionByIndex.set({ ownerKey: ownerId, index: positionCount }, key);
        liquidityPositionCount.set(ownerId, jamU64AddChecked(positionCount, jamU64Const("1")));
    }
    liquidityShares.set(shareKey, input.initialShares);
    poolByIndex.set(count, key);
    poolCount.set(jamU64AddChecked(count, jamU64Const("1")));
}
export function __jamscript_action_createPool_v1(payload: Uint8Array, sender: Uint8Array, stateView: Uint8Array): Uint8Array { try { initializeStateView(stateView); const context = decodeOwnershipAuthContext(sender); const input = decode_createPool_input(payload); execute_createPool(context, input); return appliedResult(); } catch (error) { return caughtResult(error); } }

function decode_addPoolLiquidity_input(raw: Uint8Array): { subject: JamOwnership; assetA: Uint8Array; assetB: Uint8Array; maxAmountA: JamU128; maxAmountB: JamU128; amountAUsed: JamU128; amountBUsed: JamU128; sharesMinted: JamU128; minShares: JamU128; initialShares: JamU128 } { const cursor: JamCursor = { input: raw, offset: 0 }; const v0 = decodeOwnershipAt(cursor); const v1 = jamTake(cursor, 32); const v2 = jamTake(cursor, 32); const v3 = jamU128(cursor); const v4 = jamU128(cursor); const v5 = jamU128(cursor); const v6 = jamU128(cursor); const v7 = jamU128(cursor); const v8 = jamU128(cursor); const v9 = jamU128(cursor); const result = { subject: v0, assetA: v1, assetB: v2, maxAmountA: v3, maxAmountB: v4, amountAUsed: v5, amountBUsed: v6, sharesMinted: v7, minShares: v8, initialShares: v9 }; if (cursor.offset !== raw.length) throw new Error("trailing JAM bytes"); return result; }
function execute_addPoolLiquidity(ctx: { owner: JamOwnership; controller: JamOwnership }, input: { subject: JamOwnership; assetA: Uint8Array; assetB: Uint8Array; maxAmountA: JamU128; maxAmountB: JamU128; amountAUsed: JamU128; amountBUsed: JamU128; sharesMinted: JamU128; minShares: JamU128; initialShares: JamU128 }): void {
    requireController(input.subject, ctx.controller);
    const key = canonicalPoolKey(input.assetA, input.assetB);
    const pool = pools.get(key);
    if (!pool)
        abort(6001);
    requirePoolInvariant(pool.totalShares, pool.reserve0, pool.reserve1);
    if (jamU128Compare(input.maxAmountA, jamU128Const("0")) === 0 || jamU128Compare(input.maxAmountB, jamU128Const("0")) === 0
        || jamU128Compare(input.amountAUsed, jamU128Const("0")) === 0 || jamU128Compare(input.amountBUsed, jamU128Const("0")) === 0
        || jamU128Compare(input.sharesMinted, jamU128Const("0")) === 0)
        abort(6009);
    requirePoolReserve(input.maxAmountA);
    requirePoolReserve(input.maxAmountB);
    requirePoolReserve(input.amountAUsed);
    requirePoolReserve(input.amountBUsed);
    requirePoolReserve(input.sharesMinted);
    const reserveA = poolValueForAsset(input.assetA, key.asset0, pool.reserve0, pool.reserve1);
    const reserveB = poolValueForAsset(input.assetB, key.asset0, pool.reserve0, pool.reserve1);
    const usedA = input.amountAUsed;
    const usedB = input.amountBUsed;
    const mintedShares = input.sharesMinted;
    if (jamU128Compare(pool.totalShares, jamU128Const("0")) === 0) {
        requireInitialShares(input.maxAmountA, input.maxAmountB, input.initialShares);
        if (jamU128Compare(usedA, input.maxAmountA) !== 0 || jamU128Compare(usedB, input.maxAmountB) !== 0
            || jamU128Compare(mintedShares, input.initialShares) !== 0)
            abort(6009);
    }
    else {
        if (jamU128Compare(input.initialShares, jamU128Const("0")) !== 0)
            abort(9001);
        const maxSharesProductA = jamU128MulChecked(input.maxAmountA, pool.totalShares);
        const maxSharesProductB = jamU128MulChecked(input.maxAmountB, pool.totalShares);
        const mintedReserveA = jamU128MulChecked(mintedShares, reserveA);
        const mintedReserveB = jamU128MulChecked(mintedShares, reserveB);
        if (jamU128Compare(mintedReserveA, maxSharesProductA) > 0 || jamU128Compare(mintedReserveB, maxSharesProductB) > 0)
            abort(6011);
        if (jamU128Compare(jamU128MulChecked(usedA, pool.totalShares), mintedReserveA) < 0 || jamU128Compare(jamU128MulChecked(usedB, pool.totalShares), mintedReserveB) < 0)
            abort(6011);
    }
    if (jamU128Compare(mintedShares, input.minShares) < 0)
        abort(6011);
    if (jamU128Compare(usedA, input.maxAmountA) > 0 || jamU128Compare(usedB, input.maxAmountB) > 0)
        abort(9001);
    const nextA = checkedAdd(reserveA, usedA);
    const nextB = checkedAdd(reserveB, usedB);
    requirePoolReserve(nextA);
    requirePoolReserve(nextB);
    const nextTotalShares = checkedAdd(pool.totalShares, mintedShares);
    const ownerId = ownerKey(input.subject);
    const balanceAKey = { assetId: input.assetA, ownerKey: ownerId };
    const balanceBKey = { assetId: input.assetB, ownerKey: ownerId };
    const balanceA = jamU128Or(balances.get(balanceAKey), jamU128Const("0"));
    const balanceB = jamU128Or(balances.get(balanceBKey), jamU128Const("0"));
    if (jamU128Compare(balanceA, usedA) < 0 || jamU128Compare(balanceB, usedB) < 0)
        abort(3002);
    const shareKey = { asset0: key.asset0, asset1: key.asset1, ownerKey: ownerId };
    const hasPosition = liquidityShares.has(shareKey);
    let ownerShares = jamU128Const("0");
    if (hasPosition)
        ownerShares = jamU128Or(liquidityShares.get(shareKey), jamU128Const("0"));
    const nextOwnerShares = checkedAdd(ownerShares, mintedShares);
    let positionCount = jamU64Const("0");
    if (!hasPosition) {
        positionCount = jamU64Or(liquidityPositionCount.get(ownerId), jamU64Const("0"));
        if (jamU64Compare(positionCount, jamU64Const("18446744073709551615")) === 0)
            abort(3003);
    }
    balances.set(balanceAKey, checkedSub(balanceA, usedA));
    balances.set(balanceBKey, checkedSub(balanceB, usedB));
    pools.set(key, compareAssetIds(input.assetA, key.asset0) === 0
        ? { version: 2, reserve0: nextA, reserve1: nextB, totalShares: nextTotalShares }
        : { version: 2, reserve0: nextB, reserve1: nextA, totalShares: nextTotalShares });
    if (!hasPosition) {
        liquidityPositionByIndex.set({ ownerKey: ownerId, index: positionCount }, key);
        liquidityPositionCount.set(ownerId, jamU64AddChecked(positionCount, jamU64Const("1")));
    }
    liquidityShares.set(shareKey, nextOwnerShares);
}
export function __jamscript_action_addPoolLiquidity_v1(payload: Uint8Array, sender: Uint8Array, stateView: Uint8Array): Uint8Array { try { initializeStateView(stateView); const context = decodeOwnershipAuthContext(sender); const input = decode_addPoolLiquidity_input(payload); execute_addPoolLiquidity(context, input); return appliedResult(); } catch (error) { return caughtResult(error); } }

function decode_removePoolLiquidity_input(raw: Uint8Array): { subject: JamOwnership; assetA: Uint8Array; assetB: Uint8Array; shares: JamU128; amountAOut: JamU128; amountBOut: JamU128; minAmountA: JamU128; minAmountB: JamU128 } { const cursor: JamCursor = { input: raw, offset: 0 }; const v0 = decodeOwnershipAt(cursor); const v1 = jamTake(cursor, 32); const v2 = jamTake(cursor, 32); const v3 = jamU128(cursor); const v4 = jamU128(cursor); const v5 = jamU128(cursor); const v6 = jamU128(cursor); const v7 = jamU128(cursor); const result = { subject: v0, assetA: v1, assetB: v2, shares: v3, amountAOut: v4, amountBOut: v5, minAmountA: v6, minAmountB: v7 }; if (cursor.offset !== raw.length) throw new Error("trailing JAM bytes"); return result; }
function execute_removePoolLiquidity(ctx: { owner: JamOwnership; controller: JamOwnership }, input: { subject: JamOwnership; assetA: Uint8Array; assetB: Uint8Array; shares: JamU128; amountAOut: JamU128; amountBOut: JamU128; minAmountA: JamU128; minAmountB: JamU128 }): void {
    requireController(input.subject, ctx.controller);
    const key = canonicalPoolKey(input.assetA, input.assetB);
    const pool = pools.get(key);
    if (!pool)
        abort(6001);
    requirePoolInvariant(pool.totalShares, pool.reserve0, pool.reserve1);
    if (jamU128Compare(input.shares, jamU128Const("0")) === 0)
        abort(6009);
    const ownerId = ownerKey(input.subject);
    const shareKey = { asset0: key.asset0, asset1: key.asset1, ownerKey: ownerId };
    const ownerShares = jamU128Or(liquidityShares.get(shareKey), jamU128Const("0"));
    if (jamU128Compare(input.shares, ownerShares) > 0 || jamU128Compare(input.shares, pool.totalShares) > 0)
        abort(6010);
    const assetAIs0 = compareAssetIds(input.assetA, key.asset0) === 0;
    const reserveA = poolValueForAsset(input.assetA, key.asset0, pool.reserve0, pool.reserve1);
    const reserveB = poolValueForAsset(input.assetB, key.asset0, pool.reserve0, pool.reserve1);
    const amountA = input.amountAOut;
    const amountB = input.amountBOut;
    requirePoolReserve(amountA);
    requirePoolReserve(amountB);
    // The SDK computes floor(shares * reserve / totalShares). These
    // multiplication-only bounds ensure the signed quote never overpays,
    // while avoiding u128 division in the service execution plan.
    if (jamU128Compare(jamU128MulChecked(amountA, pool.totalShares), jamU128MulChecked(input.shares, reserveA)) > 0 || jamU128Compare(jamU128MulChecked(amountB, pool.totalShares), jamU128MulChecked(input.shares, reserveB)) > 0)
        abort(6011);
    if (jamU128Compare(amountA, input.minAmountA) < 0 || jamU128Compare(amountB, input.minAmountB) < 0)
        abort(6011);
    const balanceAKey = { assetId: input.assetA, ownerKey: ownerId };
    const balanceBKey = { assetId: input.assetB, ownerKey: ownerId };
    const balanceA = jamU128Or(balances.get(balanceAKey), jamU128Const("0"));
    const balanceB = jamU128Or(balances.get(balanceBKey), jamU128Const("0"));
    const nextBalanceA = checkedAdd(balanceA, amountA);
    const nextBalanceB = checkedAdd(balanceB, amountB);
    const nextReserveA = checkedSub(reserveA, amountA);
    const nextReserveB = checkedSub(reserveB, amountB);
    const nextTotalShares = checkedSub(pool.totalShares, input.shares);
    balances.set(balanceAKey, nextBalanceA);
    balances.set(balanceBKey, nextBalanceB);
    pools.set(key, assetAIs0
        ? { version: 2, reserve0: nextReserveA, reserve1: nextReserveB, totalShares: nextTotalShares }
        : { version: 2, reserve0: nextReserveB, reserve1: nextReserveA, totalShares: nextTotalShares });
    liquidityShares.set(shareKey, checkedSub(ownerShares, input.shares));
}
export function __jamscript_action_removePoolLiquidity_v1(payload: Uint8Array, sender: Uint8Array, stateView: Uint8Array): Uint8Array { try { initializeStateView(stateView); const context = decodeOwnershipAuthContext(sender); const input = decode_removePoolLiquidity_input(payload); execute_removePoolLiquidity(context, input); return appliedResult(); } catch (error) { return caughtResult(error); } }

function decode_swapExactIn_input(raw: Uint8Array): { subject: JamOwnership; assetIn: Uint8Array; assetOut: Uint8Array; amountIn: JamU128; minAmountOut: JamU128 } { const cursor: JamCursor = { input: raw, offset: 0 }; const v0 = decodeOwnershipAt(cursor); const v1 = jamTake(cursor, 32); const v2 = jamTake(cursor, 32); const v3 = jamU128(cursor); const v4 = jamU128(cursor); const result = { subject: v0, assetIn: v1, assetOut: v2, amountIn: v3, minAmountOut: v4 }; if (cursor.offset !== raw.length) throw new Error("trailing JAM bytes"); return result; }
function execute_swapExactIn(ctx: { owner: JamOwnership; controller: JamOwnership }, input: { subject: JamOwnership; assetIn: Uint8Array; assetOut: Uint8Array; amountIn: JamU128; minAmountOut: JamU128 }): void {
    requireController(input.subject, ctx.controller);
    if (!assets.has(input.assetIn) || !assets.has(input.assetOut))
        abort(2001);
    if (jamU128Compare(input.amountIn, jamU128Const("0")) === 0)
        abort(6004);
    requirePoolReserve(input.amountIn);
    const key = canonicalPoolKey(input.assetIn, input.assetOut);
    const pool = pools.get(key);
    if (!pool)
        abort(6001);
    requirePoolInvariant(pool.totalShares, pool.reserve0, pool.reserve1);
    const assetInIs0 = compareAssetIds(input.assetIn, key.asset0) === 0;
    const reserveIn = poolValueForAsset(input.assetIn, key.asset0, pool.reserve0, pool.reserve1);
    const reserveOut = poolValueForAsset(input.assetOut, key.asset0, pool.reserve0, pool.reserve1);
    if (jamU128Compare(reserveIn, jamU128Const("0")) === 0 || jamU128Compare(reserveOut, jamU128Const("0")) === 0)
        abort(6005);
    const balanceInKey = balanceKey(input.assetIn, input.subject);
    const balanceOutKey = balanceKey(input.assetOut, input.subject);
    const balanceIn = jamU128Or(balances.get(balanceInKey), jamU128Const("0"));
    const balanceOut = jamU128Or(balances.get(balanceOutKey), jamU128Const("0"));
    if (jamU128Compare(balanceIn, input.amountIn) < 0)
        abort(3002);
    const amountOut = exactInputAmountOut(reserveIn, reserveOut, input.amountIn);
    if (jamU128Compare(amountOut, jamU128Const("0")) === 0 || jamU128Compare(amountOut, reserveOut) >= 0)
        abort(6005);
    if (jamU128Compare(amountOut, input.minAmountOut) < 0)
        abort(6006);
    const nextReserveIn = checkedAdd(reserveIn, input.amountIn);
    requirePoolReserve(nextReserveIn);
    const nextBalanceIn = checkedSub(balanceIn, input.amountIn);
    const nextBalanceOut = checkedAdd(balanceOut, amountOut);
    balances.set(balanceInKey, nextBalanceIn);
    balances.set(balanceOutKey, nextBalanceOut);
    pools.set(key, assetInIs0
        ? { version: 2, reserve0: nextReserveIn, reserve1: checkedSub(reserveOut, amountOut), totalShares: pool.totalShares }
        : { version: 2, reserve0: checkedSub(reserveOut, amountOut), reserve1: nextReserveIn, totalShares: pool.totalShares });
}
export function __jamscript_action_swapExactIn_v1(payload: Uint8Array, sender: Uint8Array, stateView: Uint8Array): Uint8Array { try { initializeStateView(stateView); const context = decodeOwnershipAuthContext(sender); const input = decode_swapExactIn_input(payload); execute_swapExactIn(context, input); return appliedResult(); } catch (error) { return caughtResult(error); } }

function decode_transfer_input(raw: Uint8Array): { subject: JamOwnership; assetId: Uint8Array; to: JamOwnership; amount: JamU128 } { const cursor: JamCursor = { input: raw, offset: 0 }; const v0 = decodeOwnershipAt(cursor); const v1 = jamTake(cursor, 32); const v2 = decodeOwnershipAt(cursor); const v3 = jamU128(cursor); const result = { subject: v0, assetId: v1, to: v2, amount: v3 }; if (cursor.offset !== raw.length) throw new Error("trailing JAM bytes"); return result; }
function execute_transfer(ctx: { owner: JamOwnership; controller: JamOwnership }, input: { subject: JamOwnership; assetId: Uint8Array; to: JamOwnership; amount: JamU128 }): void {
    requireController(input.subject, ctx.controller);
    const asset = assets.get(input.assetId);
    if (!asset)
        abort(2001);
    const fromKey = balanceKey(input.assetId, input.subject);
    const fromBalance = jamU128Or(balances.get(fromKey), jamU128Const("0"));
    if (jamU128Compare(fromBalance, input.amount) < 0)
        abort(3002);
    if (!sameOwnership(input.subject, input.to)) {
        const toKey = balanceKey(input.assetId, input.to);
        const toBalance = jamU128Or(balances.get(toKey), jamU128Const("0"));
        balances.set(fromKey, jamU128SubChecked(fromBalance, input.amount));
        balances.set(toKey, checkedAdd(toBalance, input.amount));
    }
}
export function __jamscript_action_transfer_v1(payload: Uint8Array, sender: Uint8Array, stateView: Uint8Array): Uint8Array { try { initializeStateView(stateView); const context = decodeOwnershipAuthContext(sender); const input = decode_transfer_input(payload); execute_transfer(context, input); return appliedResult(); } catch (error) { return caughtResult(error); } }

function decode_approve_input(raw: Uint8Array): { subject: JamOwnership; assetId: Uint8Array; spender: JamOwnership; amount: JamU128 } { const cursor: JamCursor = { input: raw, offset: 0 }; const v0 = decodeOwnershipAt(cursor); const v1 = jamTake(cursor, 32); const v2 = decodeOwnershipAt(cursor); const v3 = jamU128(cursor); const result = { subject: v0, assetId: v1, spender: v2, amount: v3 }; if (cursor.offset !== raw.length) throw new Error("trailing JAM bytes"); return result; }
function execute_approve(ctx: { owner: JamOwnership; controller: JamOwnership }, input: { subject: JamOwnership; assetId: Uint8Array; spender: JamOwnership; amount: JamU128 }): void {
    requireController(input.subject, ctx.controller);
    if (!assets.has(input.assetId))
        abort(2001);
    allowances.set(allowanceKey(input.assetId, input.subject, input.spender), input.amount);
}
export function __jamscript_action_approve_v1(payload: Uint8Array, sender: Uint8Array, stateView: Uint8Array): Uint8Array { try { initializeStateView(stateView); const context = decodeOwnershipAuthContext(sender); const input = decode_approve_input(payload); execute_approve(context, input); return appliedResult(); } catch (error) { return caughtResult(error); } }

function decode_transferFrom_input(raw: Uint8Array): { subject: JamOwnership; assetId: Uint8Array; from: JamOwnership; to: JamOwnership; amount: JamU128 } { const cursor: JamCursor = { input: raw, offset: 0 }; const v0 = decodeOwnershipAt(cursor); const v1 = jamTake(cursor, 32); const v2 = decodeOwnershipAt(cursor); const v3 = decodeOwnershipAt(cursor); const v4 = jamU128(cursor); const result = { subject: v0, assetId: v1, from: v2, to: v3, amount: v4 }; if (cursor.offset !== raw.length) throw new Error("trailing JAM bytes"); return result; }
function execute_transferFrom(ctx: { owner: JamOwnership; controller: JamOwnership }, input: { subject: JamOwnership; assetId: Uint8Array; from: JamOwnership; to: JamOwnership; amount: JamU128 }): void {
    requireController(input.subject, ctx.controller);
    if (!assets.has(input.assetId))
        abort(2001);
    const fromOwnerKey = ownerKey(input.from);
    const spenderKey = ownerKey(input.subject);
    const key = {
        assetId: input.assetId,
        ownerKey: fromOwnerKey,
        spenderKey
    };
    const allowance = jamU128Or(allowances.get(key), jamU128Const("0"));
    if (jamU128Compare(allowance, input.amount) < 0)
        abort(4002);
    const fromKey = { assetId: input.assetId, ownerKey: fromOwnerKey };
    const fromBalance = jamU128Or(balances.get(fromKey), jamU128Const("0"));
    if (jamU128Compare(fromBalance, input.amount) < 0)
        abort(3002);
    if (!sameOwnership(input.from, input.to)) {
        const toKey = balanceKey(input.assetId, input.to);
        const toBalance = jamU128Or(balances.get(toKey), jamU128Const("0"));
        balances.set(fromKey, jamU128SubChecked(fromBalance, input.amount));
        balances.set(toKey, checkedAdd(toBalance, input.amount));
    }
    allowances.set(key, jamU128SubChecked(allowance, input.amount));
}
export function __jamscript_action_transferFrom_v1(payload: Uint8Array, sender: Uint8Array, stateView: Uint8Array): Uint8Array { try { initializeStateView(stateView); const context = decodeOwnershipAuthContext(sender); const input = decode_transferFrom_input(payload); execute_transferFrom(context, input); return appliedResult(); } catch (error) { return caughtResult(error); } }

function decode_mint_input(raw: Uint8Array): { subject: JamOwnership; assetId: Uint8Array; to: JamOwnership; amount: JamU128 } { const cursor: JamCursor = { input: raw, offset: 0 }; const v0 = decodeOwnershipAt(cursor); const v1 = jamTake(cursor, 32); const v2 = decodeOwnershipAt(cursor); const v3 = jamU128(cursor); const result = { subject: v0, assetId: v1, to: v2, amount: v3 }; if (cursor.offset !== raw.length) throw new Error("trailing JAM bytes"); return result; }
function execute_mint(ctx: { owner: JamOwnership; controller: JamOwnership }, input: { subject: JamOwnership; assetId: Uint8Array; to: JamOwnership; amount: JamU128 }): void {
    requireController(input.subject, ctx.controller);
    const asset = assets.get(input.assetId);
    if (!asset)
        abort(2001);
    if (!sameOwnership(asset.issuer, input.subject))
        abort(2007);
    const key = balanceKey(input.assetId, input.to);
    const balance = jamU128Or(balances.get(key), jamU128Const("0"));
    assets.set(input.assetId, {
        version: 2,
        issuer: asset.issuer,
        name: asset.name,
        symbol: asset.symbol,
        decimals: asset.decimals,
        totalSupply: checkedAdd(asset.totalSupply, input.amount)
    });
    balances.set(key, checkedAdd(balance, input.amount));
}
export function __jamscript_action_mint_v1(payload: Uint8Array, sender: Uint8Array, stateView: Uint8Array): Uint8Array { try { initializeStateView(stateView); const context = decodeOwnershipAuthContext(sender); const input = decode_mint_input(payload); execute_mint(context, input); return appliedResult(); } catch (error) { return caughtResult(error); } }

function decode_burn_input(raw: Uint8Array): { subject: JamOwnership; assetId: Uint8Array; amount: JamU128 } { const cursor: JamCursor = { input: raw, offset: 0 }; const v0 = decodeOwnershipAt(cursor); const v1 = jamTake(cursor, 32); const v2 = jamU128(cursor); const result = { subject: v0, assetId: v1, amount: v2 }; if (cursor.offset !== raw.length) throw new Error("trailing JAM bytes"); return result; }
function execute_burn(ctx: { owner: JamOwnership; controller: JamOwnership }, input: { subject: JamOwnership; assetId: Uint8Array; amount: JamU128 }): void {
    requireController(input.subject, ctx.controller);
    const asset = assets.get(input.assetId);
    if (!asset)
        abort(2001);
    const key = balanceKey(input.assetId, input.subject);
    const balance = jamU128Or(balances.get(key), jamU128Const("0"));
    if (jamU128Compare(balance, input.amount) < 0 || jamU128Compare(asset.totalSupply, input.amount) < 0)
        abort(3002);
    balances.set(key, jamU128SubChecked(balance, input.amount));
    assets.set(input.assetId, {
        version: 2,
        issuer: asset.issuer,
        name: asset.name,
        symbol: asset.symbol,
        decimals: asset.decimals,
        totalSupply: jamU128SubChecked(asset.totalSupply, input.amount)
    });
}
export function __jamscript_action_burn_v1(payload: Uint8Array, sender: Uint8Array, stateView: Uint8Array): Uint8Array { try { initializeStateView(stateView); const context = decodeOwnershipAuthContext(sender); const input = decode_burn_input(payload); execute_burn(context, input); return appliedResult(); } catch (error) { return caughtResult(error); } }
