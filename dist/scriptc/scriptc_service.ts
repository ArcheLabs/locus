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
  if (end + 4 > reader.length) throw new Error("truncated Matrix proof");
  const value = reader.slice(offset + 4, end + 4);
  setReaderOffset(reader, end);
  return value;
}

function readTextBytes(reader: Uint8Array, limit: number): Uint8Array {
  const prefix = take(reader, 2);
  const length = prefix[0] | (prefix[1] << 8);
  if (length > limit) throw new Error("invalid Matrix text length");
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
  if (bytes.length > 2048) throw new Error("Matrix proof exceeds size limit");
  const reader = new Uint8Array(bytes.length + 4);
  reader.set(bytes, 4);
  if (take(reader, 1)[0] !== 1) throw new Error("unsupported Matrix proof version");
  const userId = readTextBytes(reader, 255);
  const selfSigningPublicKey = take(reader, 32);
  const masterSignature = take(reader, 64);
  const deviceId = readTextBytes(reader, 255);
  const algorithmCount = take(reader, 1)[0];
  if (algorithmCount > 8) throw new Error("too many Matrix algorithms");
  const algorithmBytes = new Uint8Array(8 * 131 - 1);
  let algorithmLength = 0;
  for (let index = 0; index < algorithmCount; index += 1) {
    const algorithm = readTextBytes(reader, 128);
    if (index > 0) algorithmBytes[algorithmLength++] = 44;
    algorithmBytes[algorithmLength++] = 34;
    for (let byteIndex = 0; byteIndex < algorithm.length; byteIndex += 1) {
      algorithmBytes[algorithmLength++] = algorithm[byteIndex];
    }
    algorithmBytes[algorithmLength++] = 34;
  }
  const deviceCurve25519Key = take(reader, 32);
  const deviceEd25519Key = take(reader, 32);
  const selfSigningSignature = take(reader, 64);
  if (readerOffset(reader) !== bytes.length) throw new Error("trailing Matrix proof bytes");

  const output = new Uint8Array(
    6 + userId.length + selfSigningPublicKey.length + masterSignature.length
      + deviceId.length + algorithmLength + deviceCurve25519Key.length
      + deviceEd25519Key.length + selfSigningSignature.length,
  );
  output[0] = userId.length & 0xff;
  output[1] = userId.length >>> 8;
  output[2] = deviceId.length & 0xff;
  output[3] = deviceId.length >>> 8;
  output[4] = algorithmLength & 0xff;
  output[5] = algorithmLength >>> 8;
  let offset = 6;
  output.set(userId, offset); offset += userId.length;
  output.set(selfSigningPublicKey, offset); offset += selfSigningPublicKey.length;
  output.set(masterSignature, offset); offset += masterSignature.length;
  output.set(deviceId, offset); offset += deviceId.length;
  output.set(algorithmBytes.slice(0, algorithmLength), offset); offset += algorithmLength;
  output.set(deviceCurve25519Key, offset); offset += deviceCurve25519Key.length;
  output.set(deviceEd25519Key, offset); offset += deviceEd25519Key.length;
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
 function matrixOwnershipVerificationPayload(
  subject: JamOwnership,
  controller: JamOwnership,
  encodedProof: Uint8Array,
): Uint8Array {
  if (!isEd25519Ownership(subject) || !isEd25519Ownership(controller)) return new Uint8Array(0);

  try {
    const proof = decodeMatrixControlClaimProofV1Bytes(encodedProof);
    const userLength = matrixPayloadReadU16(proof, 0);
    const deviceLength = matrixPayloadReadU16(proof, 2);
    const algorithmsLength = matrixPayloadReadU16(proof, 4);
    let offset = 6;
    const userId = proof.slice(offset, offset + userLength); offset += userLength;
    const selfSigningKey = proof.slice(offset, offset + 32); offset += 32;
    const masterSignature = proof.slice(offset, offset + 64); offset += 64;
    const deviceId = proof.slice(offset, offset + deviceLength); offset += deviceLength;
    const algorithms = proof.slice(offset, offset + algorithmsLength); offset += algorithmsLength;
    const deviceCurve25519Key = proof.slice(offset, offset + 32); offset += 32;
    const deviceEd25519Key = proof.slice(offset, offset + 32); offset += 32;
    const selfSigningSignature = proof.slice(offset, offset + 64);
    if (!matrixSameBytes(deviceEd25519Key, controller.public)) return new Uint8Array(0);

    const encodedSelfSigningKey = base64Bytes(selfSigningKey);
    const masterMessage = concatBytes(
      staticAscii([123, 34, 107, 101, 121, 115, 34, 58, 123, 34, 101, 100, 50, 53, 53, 49, 57, 58]),
      encodedSelfSigningKey,
      staticAscii([34, 58, 34]),
      encodedSelfSigningKey,
      staticAscii([34, 125, 44, 34, 117, 115, 97, 103, 101, 34, 58, 91, 34, 115, 101, 108, 102, 95, 115, 105, 103, 110, 105, 110, 103, 34, 93, 44, 34, 117, 115, 101, 114, 95, 105, 100, 34, 58, 34]),
      userId,
      staticAscii([34, 125]),
    );
    const deviceMessage = concatBytes(
      staticAscii([123, 34, 97, 108, 103, 111, 114, 105, 116, 104, 109, 115, 34, 58, 91]),
      algorithms,
      staticAscii([93, 44, 34, 100, 101, 118, 105, 99, 101, 95, 105, 100, 34, 58, 34]),
      deviceId,
      staticAscii([34, 44, 34, 107, 101, 121, 115, 34, 58, 123, 34, 99, 117, 114, 118, 101, 50, 53, 53, 49, 57, 58]),
      deviceId,
      staticAscii([34, 58, 34]),
      base64Bytes(deviceCurve25519Key),
      staticAscii([34, 44, 34, 101, 100, 50, 53, 53, 49, 57, 58]),
      deviceId,
      staticAscii([34, 58, 34]),
      base64Bytes(deviceEd25519Key),
      staticAscii([34, 125, 44, 34, 117, 115, 101, 114, 95, 105, 100, 34, 58, 34]),
      userId,
      staticAscii([34, 125]),
    );
    return packVerificationPayload(masterMessage, masterSignature, selfSigningKey, deviceMessage, selfSigningSignature);
  } catch {
    return new Uint8Array(0);
  }
}

function packVerificationPayload(
  masterMessage: Uint8Array,
  masterSignature: Uint8Array,
  selfSigningKey: Uint8Array,
  deviceMessage: Uint8Array,
  deviceSignature: Uint8Array,
): Uint8Array {
  const output = new Uint8Array(4 + masterMessage.length + 64 + 32 + deviceMessage.length + 64);
  writeU16(output, 0, masterMessage.length);
  writeU16(output, 2, deviceMessage.length);
  let offset = 4;
  output.set(masterMessage, offset); offset += masterMessage.length;
  output.set(masterSignature, offset); offset += 64;
  output.set(selfSigningKey, offset); offset += 32;
  output.set(deviceMessage, offset); offset += deviceMessage.length;
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
  if (left.length !== right.length) return false;
  for (let index = 0; index < left.length; index += 1) if (left[index] !== right[index]) return false;
  return true;
}

function staticAscii(values: number[]): Uint8Array {
  const output = new Uint8Array(values.length);
  for (let index = 0; index < values.length; index += 1) output[index] = values[index];
  return output;
}

function concatBytes(...parts: Uint8Array[]): Uint8Array {
  let total = 0;
  for (let index = 0; index < parts.length; index += 1) total += parts[index].length;
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
    if (hasSecond) output[outputIndex++] = base64Ascii(((second & 15) << 2) | (third >>> 6));
    if (hasThird) output[outputIndex++] = base64Ascii(third & 63);
  }
  return output;
}

function base64Ascii(index: number): number {
  if (index < 26) return index + 65;
  if (index < 52) return index - 26 + 97;
  if (index < 62) return index - 52 + 48;
  if (index === 62) return 43;
  return 47;
}




 function verifyMatrixOwnershipAuthorizationScriptc(
  subject: JamOwnership,
  controller: JamOwnership,
  proof: Uint8Array,
): boolean {
  const payload = matrixOwnershipVerificationPayload(subject, controller, proof);
  if (payload.length < 4 + 64 + 32 + 64) return false;
  const masterMessageLength = matrixScriptcReadU16(payload, 0);
  const deviceMessageLength = matrixScriptcReadU16(payload, 2);
  const expectedLength = 4 + masterMessageLength + 64 + 32 + deviceMessageLength + 64;
  if (payload.length !== expectedLength) return false;

  let offset = 4;
  const masterMessage = payload.slice(offset, offset + masterMessageLength); offset += masterMessageLength;
  const masterSignature = payload.slice(offset, offset + 64); offset += 64;
  const selfSigningKey = payload.slice(offset, offset + 32); offset += 32;
  const deviceMessage = payload.slice(offset, offset + deviceMessageLength); offset += deviceMessageLength;
  const deviceSignature = payload.slice(offset, offset + 64);
  if (!verifyEd25519(subject.public, masterMessage, masterSignature)) return false;
  return verifyEd25519(selfSigningKey, deviceMessage, deviceSignature);
}

function matrixScriptcReadU16(value: Uint8Array, offset: number): number {
  return value[offset] | (value[offset + 1] << 8);
}


import {
  action,
  abort,
  ownership,
  state,
  stateMap,
  query,
  fixedBytes,
  bytes,
  record,
  u8,
  u64,
  u128,
  ownershipKey,
  verifyEd25519,
} from "jam";

const AssetId = fixedBytes(32);
const OwnerKey = fixedBytes(32);


const AssetV2 = record({
  version: u8,
  issuer: ownership,
  name: bytes(64),
  symbol: bytes(16),
  decimals: u8,
  totalSupply: u128,
});

const BalanceKey = record({
  assetId: AssetId,
  ownerKey: OwnerKey,
});

const AllowanceKey = record({
  assetId: AssetId,
  ownerKey: OwnerKey,
  spenderKey: OwnerKey,
});

const ControllerGrantKey = record({
  subjectKey: OwnerKey,
  controllerKey: OwnerKey,
});

const PoolKey = record({
  asset0: AssetId,
  asset1: AssetId,
});

const PoolV2 = record({
  version: u8,
  reserve0: u128,
  reserve1: u128,
  totalShares: u128,
});

const LiquidityShareKey = record({
  asset0: AssetId,
  asset1: AssetId,
  ownerKey: OwnerKey,
});

const OwnerPoolIndexKey = record({
  ownerKey: OwnerKey,
  index: u64,
});

const assets = stateMap({
  schema: "locus.asset.v2",
  key: AssetId,
  value: AssetV2,
});

const assetCount = state({
  schema: "locus.asset-count.v2",
  value: u64,
});

const assetByIndex = stateMap({
  schema: "locus.asset-index.v2",
  key: u64,
  value: AssetId,
});

const balances = stateMap({
  schema: "locus.balance.v2",
  key: BalanceKey,
  value: u128,
});

const allowances = stateMap({
  schema: "locus.allowance.v2",
  key: AllowanceKey,
  value: u128,
});

const controllerGrants = stateMap({
  schema: "locus.controller-grant.v1",
  key: ControllerGrantKey,
  value: u8,
});

const pools = stateMap({
  schema: "locus.pool.v2",
  key: PoolKey,
  value: PoolV2,
});

const poolCount = state({
  schema: "locus.pool-count.v2",
  value: u64,
});

const poolByIndex = stateMap({
  schema: "locus.pool-index.v2",
  key: u64,
  value: PoolKey,
});

const liquidityShares = stateMap({
  schema: "locus.liquidity-share.v1",
  key: LiquidityShareKey,
  value: u128,
});

const liquidityPositionCount = stateMap({
  schema: "locus.liquidity-position-count.v1",
  key: OwnerKey,
  value: u64,
});

const liquidityPositionByIndex = stateMap({
  schema: "locus.liquidity-position-index.v1",
  key: OwnerPoolIndexKey,
  value: PoolKey,
});

function sameBytes(left: Uint8Array, right: Uint8Array): boolean {
  if (left.length !== right.length) return false;
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) return false;
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
    if (value[index] !== 0) return false;
  }
  return true;
}

function requireAssetId(assetId: Uint8Array): void {
  if (isZeroBytes(assetId)) abort(2003);
}

function checkedAdd(left: u128, right: u128): u128 {
  if (right > 340282366920938463463374607431768211455n - left) abort(3003);
  return left + right;
}

function checkedSub(left: u128, right: u128): u128 {
  if (right > left) abort(3002);
  return left - right;
}

function checkedMul(left: u128, right: u128): u128 {
  if (left !== 0n && right > 340282366920938463463374607431768211455n / left) abort(3003);
  return left * right;
}

function requirePoolReserve(value: u128): void {
  if (value > 18446744073709551615n) abort(6008);
}

function ceilDiv(value: u128, denominator: u128): u128 {
  let zero: u128 = 0n;
  let one: u128 = 1n;
  if (denominator === zero) abort(9001);
  if (value === zero) return zero;
  return one + (value - one) / denominator;
}

function requireInitialShares(amountA: u128, amountB: u128, shares: u128): void {
  let zero: u128 = 0n;
  const maxPoolReserve: u128 = 18446744073709551615n;
  if (shares === zero) abort(6009);
  if (shares > maxPoolReserve) abort(6008);

  // Both reserves are checked against u64::MAX before this helper is called,
  // so all three products below fit in u128 without a division-based overflow check.
  const product = amountA * amountB;
  const sharesSquared = shares * shares;
  if (sharesSquared > product) abort(6009);
  if (shares < maxPoolReserve) {
    const nextShares = shares + 1n;
    if (nextShares * nextShares <= product) abort(6009);
  }
}

function requirePoolInvariant(totalShares: u128, reserve0: u128, reserve1: u128): void {
  let zero: u128 = 0n;
  requirePoolReserve(totalShares);
  const empty = reserve0 === zero && reserve1 === zero;
  if (totalShares === zero) {
    if (!empty) abort(9001);
  } else {
    if (empty || reserve0 === zero || reserve1 === zero) abort(9001);
  }
}

function liquidityShareKey(assetA: Uint8Array, assetB: Uint8Array, owner: JamOwnership) {
  const poolKey = canonicalPoolKey(assetA, assetB);
  return { ...poolKey, ownerKey: ownerKey(owner) };
}

function ensureLiquidityPositionIndexed(poolKey: { asset0: Uint8Array; asset1: Uint8Array }, owner: JamOwnership): void {
  const key = liquidityShareKey(poolKey.asset0, poolKey.asset1, owner);
  if (liquidityShares.has(key)) return;
  const ownerId = ownerKey(owner);
  const count = liquidityPositionCount.get(ownerId) ?? 0n;
  if (count === 18446744073709551615n) abort(3003);
  liquidityPositionByIndex.set({ ownerKey: ownerId, index: count }, poolKey);
  liquidityPositionCount.set(ownerId, count + 1n);
}

function exactInputAmountOut(reserveIn: u128, reserveOut: u128, amountIn: u128): u128 {
  const amountInAfterFee = checkedMul(amountIn, 9970n) / 10000n;
  if (amountInAfterFee === 0n) abort(6004);
  return checkedMul(reserveOut, amountInAfterFee)
    / checkedAdd(reserveIn, amountInAfterFee);
}

function compareAssetIds(left: Uint8Array, right: Uint8Array): number {
  for (let index = 0; index < 32; index += 1) {
    if (left[index] < right[index]) return -1;
    if (left[index] > right[index]) return 1;
  }
  return 0;
}

function canonicalPoolKey(assetA: Uint8Array, assetB: Uint8Array) {
  requireAssetId(assetA);
  requireAssetId(assetB);
  const order = compareAssetIds(assetA, assetB);
  if (order === 0) abort(6003);
  return order < 0 ? { asset0: assetA, asset1: assetB } : { asset0: assetB, asset1: assetA };
}

function poolValueForAsset(assetA: Uint8Array, asset0: Uint8Array, valueA: u128, valueB: u128): u128 {
  if (compareAssetIds(assetA, asset0) === 0) return valueA;
  return valueB;
}

function ownerKey(owner: JamOwnership): Uint8Array {
  return ownershipKey(owner);
}

function balanceKey(assetId: Uint8Array, owner: JamOwnership) {
  return { assetId, ownerKey: ownerKey(owner) };
}

function allowanceKey(
  assetId: Uint8Array,
  owner: JamOwnership,
  spender: JamOwnership,
) {
  return {
    assetId,
    ownerKey: ownerKey(owner),
    spenderKey: ownerKey(spender),
  };
}

function controllerKey(
  subject: JamOwnership,
  controller: JamOwnership,
) {
  return {
    subjectKey: ownerKey(subject),
    controllerKey: ownerKey(controller),
  };
}

function requireController(
  subject: JamOwnership,
  controller: JamOwnership,
): void {
  if (sameOwnership(subject, controller)) return;
  const grant = controllerGrants.get(controllerKey(subject, controller)) ?? 0;
  if (grant !== 1) abort(5001);
}

function requireActiveController(
  subject: JamOwnership,
  controller: JamOwnership,
): void {
  if ((controllerGrants.get(controllerKey(subject, controller)) ?? 0) !== 1) {
    abort(5006);
  }
}

export const authorizeMatrixController = action({
  auth: ownership(),
  input: {
    subject: ownership,
    proof: bytes(4096),
  },
  execute(ctx, input) {
    const key = controllerKey(input.subject, ctx.controller);
    const existingGrant = controllerGrants.get(key) ?? 0;
    if (existingGrant === 1) return;
    if (controllerGrants.has(key)) abort(5003);
    if (input.subject.kind !== 0 || ctx.controller.kind !== 0) abort(5005);
    if (!verifyMatrixOwnershipAuthorizationScriptc(input.subject, ctx.controller, input.proof)) abort(5005);

    controllerGrants.set(key, 1);
  },
});

export const addController = action({
  auth: ownership(),
  input: {
    subject: ownership,
    controller: ownership,
  },
  execute(ctx, input) {
    requireController(input.subject, ctx.controller);
    const key = controllerKey(input.subject, input.controller);
    if ((controllerGrants.get(key) ?? 0) === 1) abort(5002);
    if (controllerGrants.has(key)) abort(5003);
    controllerGrants.set(key, 1);
  },
});

export const revokeController = action({
  auth: ownership(),
  input: {
    subject: ownership,
    controller: ownership,
  },
  execute(ctx, input) {
    requireController(input.subject, ctx.controller);
    requireActiveController(input.subject, input.controller);
    controllerGrants.set(controllerKey(input.subject, input.controller), 0);
  },
});

export const createAsset = action({
  auth: ownership(),
  input: {
    subject: ownership,
    assetId: AssetId,
    name: bytes(64),
    symbol: bytes(16),
    decimals: u8,
    initialSupply: u128,
    initialHolder: ownership,
  },
  execute(ctx, input) {
    requireController(input.subject, ctx.controller);
    requireAssetId(input.assetId);
    if (assets.has(input.assetId)) abort(2002);
    if (input.name.length === 0) abort(2004);
    if (input.symbol.length === 0) abort(2005);
    if (input.decimals > 38) abort(2006);

    assets.set(input.assetId, {
      version: 2,
      issuer: input.subject,
      name: input.name,
      symbol: input.symbol,
      decimals: input.decimals,
      totalSupply: input.initialSupply,
    });

    if (input.initialSupply > 0n) {
      balances.set(balanceKey(input.assetId, input.initialHolder), input.initialSupply);
    }

    const count = assetCount.get() ?? 0n;
    if (count === 18446744073709551615n) abort(3003);
    assetByIndex.set(count, input.assetId);
    assetCount.set(count + 1n);
  },
});

export const createPool = action({
  auth: ownership(),
  input: {
    subject: ownership,
    assetA: AssetId,
    assetB: AssetId,
    amountA: u128,
    amountB: u128,
    initialShares: u128,
  },
  execute(ctx, input) {
    requireController(input.subject, ctx.controller);
    if (!assets.has(input.assetA) || !assets.has(input.assetB)) abort(2001);
    if (input.amountA === 0n || input.amountB === 0n) abort(6009);
    requirePoolReserve(input.amountA);
    requirePoolReserve(input.amountB);

    const key = canonicalPoolKey(input.assetA, input.assetB);
    if (pools.has(key)) abort(6002);
    const ownerId = ownerKey(input.subject);
    const balanceAKey = { assetId: input.assetA, ownerKey: ownerId };
    const balanceBKey = { assetId: input.assetB, ownerKey: ownerId };
    const shareKey = { asset0: key.asset0, asset1: key.asset1, ownerKey: ownerId };
    let amount0: u128 = input.amountA;
    let amount1: u128 = input.amountB;
    if (compareAssetIds(input.assetA, key.asset0) !== 0) {
      amount0 = input.amountB;
      amount1 = input.amountA;
    }
    const balanceA = balances.get(balanceAKey) ?? 0n;
    const balanceB = balances.get(balanceBKey) ?? 0n;
    if (balanceA < input.amountA || balanceB < input.amountB) abort(3002);
    requireInitialShares(input.amountA, input.amountB, input.initialShares);
    const existingShares = liquidityShares.has(shareKey);
    const positionCount = liquidityPositionCount.get(ownerId) ?? 0n;
    if (!existingShares && positionCount === 18446744073709551615n) abort(3003);
    const count = poolCount.get() ?? 0n;
    if (count === 18446744073709551615n) abort(3003);

    balances.set(balanceAKey, checkedSub(balanceA, input.amountA));
    balances.set(balanceBKey, checkedSub(balanceB, input.amountB));
    pools.set(key, { version: 2, reserve0: amount0, reserve1: amount1, totalShares: input.initialShares });
    if (!existingShares) {
      liquidityPositionByIndex.set({ ownerKey: ownerId, index: positionCount }, key);
      liquidityPositionCount.set(ownerId, positionCount + 1n);
    }
    liquidityShares.set(shareKey, input.initialShares);
    poolByIndex.set(count, key);
    poolCount.set(count + 1n);
  },
});

export const addPoolLiquidity = action({
  auth: ownership(),
  input: {
    subject: ownership,
    assetA: AssetId,
    assetB: AssetId,
    maxAmountA: u128,
    maxAmountB: u128,
    amountAUsed: u128,
    amountBUsed: u128,
    sharesMinted: u128,
    minShares: u128,
    initialShares: u128,
  },
  execute(ctx, input) {
    requireController(input.subject, ctx.controller);
    const key = canonicalPoolKey(input.assetA, input.assetB);
    const pool = pools.get(key);
    if (!pool) abort(6001);
    requirePoolInvariant(pool.totalShares, pool.reserve0, pool.reserve1);
    if (input.maxAmountA === 0n || input.maxAmountB === 0n
      || input.amountAUsed === 0n || input.amountBUsed === 0n
      || input.sharesMinted === 0n) abort(6009);
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
    if (pool.totalShares === 0n) {
      requireInitialShares(input.maxAmountA, input.maxAmountB, input.initialShares);
      if (usedA !== input.maxAmountA || usedB !== input.maxAmountB
        || mintedShares !== input.initialShares) abort(6009);
    } else {
      if (input.initialShares !== 0n) abort(9001);
      const maxSharesProductA = input.maxAmountA * pool.totalShares;
      const maxSharesProductB = input.maxAmountB * pool.totalShares;
      const mintedReserveA = mintedShares * reserveA;
      const mintedReserveB = mintedShares * reserveB;
      if (mintedReserveA > maxSharesProductA || mintedReserveB > maxSharesProductB) abort(6011);
      if (usedA * pool.totalShares < mintedReserveA
        || usedB * pool.totalShares < mintedReserveB) abort(6011);
    }
    if (mintedShares < input.minShares) abort(6011);
    if (usedA > input.maxAmountA || usedB > input.maxAmountB) abort(9001);
    const nextA = checkedAdd(reserveA, usedA);
    const nextB = checkedAdd(reserveB, usedB);
    requirePoolReserve(nextA);
    requirePoolReserve(nextB);
    const nextTotalShares = checkedAdd(pool.totalShares, mintedShares);
    const ownerId = ownerKey(input.subject);
    const balanceAKey = { assetId: input.assetA, ownerKey: ownerId };
    const balanceBKey = { assetId: input.assetB, ownerKey: ownerId };
    const balanceA = balances.get(balanceAKey) ?? 0n;
    const balanceB = balances.get(balanceBKey) ?? 0n;
    if (balanceA < usedA || balanceB < usedB) abort(3002);
    const shareKey = { asset0: key.asset0, asset1: key.asset1, ownerKey: ownerId };
    const hasPosition = liquidityShares.has(shareKey);
    let ownerShares: u128 = 0n;
    if (hasPosition) ownerShares = liquidityShares.get(shareKey) ?? 0n;
    const nextOwnerShares = checkedAdd(ownerShares, mintedShares);
    let positionCount: u64 = 0n;
    if (!hasPosition) {
      positionCount = liquidityPositionCount.get(ownerId) ?? 0n;
      if (positionCount === 18446744073709551615n) abort(3003);
    }

    balances.set(balanceAKey, checkedSub(balanceA, usedA));
    balances.set(balanceBKey, checkedSub(balanceB, usedB));
    pools.set(key, compareAssetIds(input.assetA, key.asset0) === 0
      ? { version: 2, reserve0: nextA, reserve1: nextB, totalShares: nextTotalShares }
      : { version: 2, reserve0: nextB, reserve1: nextA, totalShares: nextTotalShares });
    if (!hasPosition) {
      liquidityPositionByIndex.set({ ownerKey: ownerId, index: positionCount }, key);
      liquidityPositionCount.set(ownerId, positionCount + 1n);
    }
    liquidityShares.set(shareKey, nextOwnerShares);
  },
});

export const removePoolLiquidity = action({
  auth: ownership(),
  input: {
    subject: ownership,
    assetA: AssetId,
    assetB: AssetId,
    shares: u128,
    amountAOut: u128,
    amountBOut: u128,
    minAmountA: u128,
    minAmountB: u128,
  },
  execute(ctx, input) {
    requireController(input.subject, ctx.controller);
    const key = canonicalPoolKey(input.assetA, input.assetB);
    const pool = pools.get(key);
    if (!pool) abort(6001);
    requirePoolInvariant(pool.totalShares, pool.reserve0, pool.reserve1);
    if (input.shares === 0n) abort(6009);
    const ownerId = ownerKey(input.subject);
    const shareKey = { asset0: key.asset0, asset1: key.asset1, ownerKey: ownerId };
    const ownerShares = liquidityShares.get(shareKey) ?? 0n;
    if (input.shares > ownerShares || input.shares > pool.totalShares) abort(6010);
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
    if (amountA * pool.totalShares > input.shares * reserveA
      || amountB * pool.totalShares > input.shares * reserveB) abort(6011);
    if (amountA < input.minAmountA || amountB < input.minAmountB) abort(6011);
    const balanceAKey = { assetId: input.assetA, ownerKey: ownerId };
    const balanceBKey = { assetId: input.assetB, ownerKey: ownerId };
    const balanceA = balances.get(balanceAKey) ?? 0n;
    const balanceB = balances.get(balanceBKey) ?? 0n;
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
  },
});

export const swapExactIn = action({
  auth: ownership(),
  input: {
    subject: ownership,
    assetIn: AssetId,
    assetOut: AssetId,
    amountIn: u128,
    minAmountOut: u128,
  },
  execute(ctx, input) {
    requireController(input.subject, ctx.controller);
    if (!assets.has(input.assetIn) || !assets.has(input.assetOut)) abort(2001);
    if (input.amountIn === 0n) abort(6004);
    requirePoolReserve(input.amountIn);
    const key = canonicalPoolKey(input.assetIn, input.assetOut);
    const pool = pools.get(key);
    if (!pool) abort(6001);
    requirePoolInvariant(pool.totalShares, pool.reserve0, pool.reserve1);
    const assetInIs0 = compareAssetIds(input.assetIn, key.asset0) === 0;
    const reserveIn = poolValueForAsset(input.assetIn, key.asset0, pool.reserve0, pool.reserve1);
    const reserveOut = poolValueForAsset(input.assetOut, key.asset0, pool.reserve0, pool.reserve1);
    if (reserveIn === 0n || reserveOut === 0n) abort(6005);
    const balanceInKey = balanceKey(input.assetIn, input.subject);
    const balanceOutKey = balanceKey(input.assetOut, input.subject);
    const balanceIn = balances.get(balanceInKey) ?? 0n;
    const balanceOut = balances.get(balanceOutKey) ?? 0n;
    if (balanceIn < input.amountIn) abort(3002);

    const amountOut = exactInputAmountOut(reserveIn, reserveOut, input.amountIn);
    if (amountOut === 0n || amountOut >= reserveOut) abort(6005);
    if (amountOut < input.minAmountOut) abort(6006);

    const nextReserveIn = checkedAdd(reserveIn, input.amountIn);
    requirePoolReserve(nextReserveIn);
    const nextBalanceIn = checkedSub(balanceIn, input.amountIn);
    const nextBalanceOut = checkedAdd(balanceOut, amountOut);
    balances.set(balanceInKey, nextBalanceIn);
    balances.set(balanceOutKey, nextBalanceOut);
    pools.set(key, assetInIs0
      ? { version: 2, reserve0: nextReserveIn, reserve1: checkedSub(reserveOut, amountOut), totalShares: pool.totalShares }
      : { version: 2, reserve0: checkedSub(reserveOut, amountOut), reserve1: nextReserveIn, totalShares: pool.totalShares });
  },
});

export const transfer = action({
  auth: ownership(),
  input: {
    subject: ownership,
    assetId: AssetId,
    to: ownership,
    amount: u128,
  },
  execute(ctx, input) {
    requireController(input.subject, ctx.controller);
    const asset = assets.get(input.assetId);
    if (!asset) abort(2001);

    const fromKey = balanceKey(input.assetId, input.subject);
    const fromBalance = balances.get(fromKey) ?? 0n;
    if (fromBalance < input.amount) abort(3002);

    if (!sameOwnership(input.subject, input.to)) {
      const toKey = balanceKey(input.assetId, input.to);
      const toBalance = balances.get(toKey) ?? 0n;
      balances.set(fromKey, fromBalance - input.amount);
      balances.set(toKey, checkedAdd(toBalance, input.amount));
    }
  },
});

export const approve = action({
  auth: ownership(),
  input: {
    subject: ownership,
    assetId: AssetId,
    spender: ownership,
    amount: u128,
  },
  execute(ctx, input) {
    requireController(input.subject, ctx.controller);
    if (!assets.has(input.assetId)) abort(2001);
    allowances.set(allowanceKey(input.assetId, input.subject, input.spender), input.amount);
  },
});

export const transferFrom = action({
  auth: ownership(),
  input: {
    subject: ownership,
    assetId: AssetId,
    from: ownership,
    to: ownership,
    amount: u128,
  },
  execute(ctx, input) {
    requireController(input.subject, ctx.controller);
    if (!assets.has(input.assetId)) abort(2001);

    const fromOwnerKey = ownerKey(input.from);
    const spenderKey = ownerKey(input.subject);
    const key = {
      assetId: input.assetId,
      ownerKey: fromOwnerKey,
      spenderKey,
    };
    const allowance = allowances.get(key) ?? 0n;
    if (allowance < input.amount) abort(4002);

    const fromKey = { assetId: input.assetId, ownerKey: fromOwnerKey };
    const fromBalance = balances.get(fromKey) ?? 0n;
    if (fromBalance < input.amount) abort(3002);

    if (!sameOwnership(input.from, input.to)) {
      const toKey = balanceKey(input.assetId, input.to);
      const toBalance = balances.get(toKey) ?? 0n;
      balances.set(fromKey, fromBalance - input.amount);
      balances.set(toKey, checkedAdd(toBalance, input.amount));
    }
    allowances.set(key, allowance - input.amount);
  },
});

export const mint = action({
  auth: ownership(),
  input: {
    subject: ownership,
    assetId: AssetId,
    to: ownership,
    amount: u128,
  },
  execute(ctx, input) {
    requireController(input.subject, ctx.controller);
    const asset = assets.get(input.assetId);
    if (!asset) abort(2001);
    if (!sameOwnership(asset.issuer, input.subject)) abort(2007);

    const key = balanceKey(input.assetId, input.to);
    const balance = balances.get(key) ?? 0n;
    assets.set(input.assetId, {
      version: 2,
      issuer: asset.issuer,
      name: asset.name,
      symbol: asset.symbol,
      decimals: asset.decimals,
      totalSupply: checkedAdd(asset.totalSupply, input.amount),
    });
    balances.set(key, checkedAdd(balance, input.amount));
  },
});

export const burn = action({
  auth: ownership(),
  input: {
    subject: ownership,
    assetId: AssetId,
    amount: u128,
  },
  execute(ctx, input) {
    requireController(input.subject, ctx.controller);
    const asset = assets.get(input.assetId);
    if (!asset) abort(2001);
    const key = balanceKey(input.assetId, input.subject);
    const balance = balances.get(key) ?? 0n;
    if (balance < input.amount || asset.totalSupply < input.amount) abort(3002);

    balances.set(key, balance - input.amount);
    assets.set(input.assetId, {
      version: 2,
      issuer: asset.issuer,
      name: asset.name,
      symbol: asset.symbol,
      decimals: asset.decimals,
      totalSupply: asset.totalSupply - input.amount,
    });
  },
});

export const getAsset = query(assets);
export const getAssetCount = query(assetCount);
export const getAssetByIndex = query(assetByIndex);
export const getBalance = query(balances);
export const getAllowance = query(allowances);
export const getControllerGrant = query(controllerGrants);
export const getPool = query(pools);
export const getPoolCount = query(poolCount);
export const getPoolByIndex = query(poolByIndex);
export const getLiquidityShares = query(liquidityShares);
export const getLiquidityPositionCount = query(liquidityPositionCount);
export const getLiquidityPositionByIndex = query(liquidityPositionByIndex);
