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
import { verifyMatrixOwnershipAuthorizationScriptc } from "@jamscript/client/ownership/matrix/service-scriptc";

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

function integerSqrt(value: u128): u128 {
  let one: u128 = 1n;
  let two: u128 = 2n;
  if (value < two) return value;
  let low: u128 = one;
  let high: u128 = 18446744073709551615n;
  let result: u128 = one;
  while (low <= high) {
    const middle = low + (high - low) / two;
    if (middle <= value / middle) {
      result = middle;
      low = middle + one;
    } else {
      high = middle - one;
    }
  }
  return result;
}

function requirePoolInvariant(totalShares: u128, reserve0: u128, reserve1: u128): void {
  let zero: u128 = 0n;
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
  },
  execute(ctx, input) {
    requireController(input.subject, ctx.controller);
    if (!assets.has(input.assetA) || !assets.has(input.assetB)) abort(2001);
    if (input.amountA === 0n || input.amountB === 0n) abort(6009);
    requirePoolReserve(input.amountA);
    requirePoolReserve(input.amountB);

    const key = canonicalPoolKey(input.assetA, input.assetB);
    if (pools.has(key)) abort(6002);
    let amount0: u128 = input.amountA;
    let amount1: u128 = input.amountB;
    if (compareAssetIds(input.assetA, key.asset0) !== 0) {
      amount0 = input.amountB;
      amount1 = input.amountA;
    }
    const balanceAKey = balanceKey(input.assetA, input.subject);
    const balanceBKey = balanceKey(input.assetB, input.subject);
    const balanceA = balances.get(balanceAKey) ?? 0n;
    const balanceB = balances.get(balanceBKey) ?? 0n;
    if (balanceA < input.amountA || balanceB < input.amountB) abort(3002);
    const initialShares = integerSqrt(checkedMul(input.amountA, input.amountB));
    if (initialShares === 0n) abort(6009);

    balances.set(balanceAKey, checkedSub(balanceA, input.amountA));
    balances.set(balanceBKey, checkedSub(balanceB, input.amountB));
    pools.set(key, { version: 2, reserve0: amount0, reserve1: amount1, totalShares: initialShares });
    const shareKey = liquidityShareKey(key.asset0, key.asset1, input.subject);
    ensureLiquidityPositionIndexed(key, input.subject);
    liquidityShares.set(shareKey, initialShares);
    const count = poolCount.get() ?? 0n;
    if (count === 18446744073709551615n) abort(3003);
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
    minShares: u128,
  },
  execute(ctx, input) {
    requireController(input.subject, ctx.controller);
    const key = canonicalPoolKey(input.assetA, input.assetB);
    const pool = pools.get(key);
    if (!pool) abort(6001);
    requirePoolInvariant(pool.totalShares, pool.reserve0, pool.reserve1);
    if (input.maxAmountA === 0n || input.maxAmountB === 0n) abort(6009);
    requirePoolReserve(input.maxAmountA);
    requirePoolReserve(input.maxAmountB);
    const reserveA = poolValueForAsset(input.assetA, key.asset0, pool.reserve0, pool.reserve1);
    const reserveB = poolValueForAsset(input.assetB, key.asset0, pool.reserve0, pool.reserve1);
    let usedA: u128 = 0n;
    let usedB: u128 = 0n;
    let mintedShares: u128 = 0n;
    if (pool.totalShares === 0n) {
      usedA = input.maxAmountA;
      usedB = input.maxAmountB;
      mintedShares = integerSqrt(checkedMul(usedA, usedB));
    } else {
      const sharesA = checkedMul(input.maxAmountA, pool.totalShares) / reserveA;
      const sharesB = checkedMul(input.maxAmountB, pool.totalShares) / reserveB;
      mintedShares = sharesA;
      if (sharesB < mintedShares) mintedShares = sharesB;
      if (mintedShares === 0n) abort(6009);
      usedA = ceilDiv(checkedMul(mintedShares, reserveA), pool.totalShares);
      usedB = ceilDiv(checkedMul(mintedShares, reserveB), pool.totalShares);
    }
    if (mintedShares === 0n) abort(6009);
    if (mintedShares < input.minShares) abort(6011);
    if (usedA > input.maxAmountA || usedB > input.maxAmountB) abort(9001);
    const nextA = checkedAdd(reserveA, usedA);
    const nextB = checkedAdd(reserveB, usedB);
    requirePoolReserve(nextA);
    requirePoolReserve(nextB);
    const nextTotalShares = checkedAdd(pool.totalShares, mintedShares);
    const balanceAKey = balanceKey(input.assetA, input.subject);
    const balanceBKey = balanceKey(input.assetB, input.subject);
    const balanceA = balances.get(balanceAKey) ?? 0n;
    const balanceB = balances.get(balanceBKey) ?? 0n;
    if (balanceA < usedA || balanceB < usedB) abort(3002);
    const shareKey = liquidityShareKey(key.asset0, key.asset1, input.subject);
    const ownerShares = liquidityShares.get(shareKey) ?? 0n;
    const nextOwnerShares = checkedAdd(ownerShares, mintedShares);

    balances.set(balanceAKey, checkedSub(balanceA, usedA));
    balances.set(balanceBKey, checkedSub(balanceB, usedB));
    pools.set(key, compareAssetIds(input.assetA, key.asset0) === 0
      ? { version: 2, reserve0: nextA, reserve1: nextB, totalShares: nextTotalShares }
      : { version: 2, reserve0: nextB, reserve1: nextA, totalShares: nextTotalShares });
    ensureLiquidityPositionIndexed(key, input.subject);
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
    const shareKey = liquidityShareKey(key.asset0, key.asset1, input.subject);
    const ownerShares = liquidityShares.get(shareKey) ?? 0n;
    if (input.shares > ownerShares || input.shares > pool.totalShares) abort(6010);
    const assetAIs0 = compareAssetIds(input.assetA, key.asset0) === 0;
    const reserveA = poolValueForAsset(input.assetA, key.asset0, pool.reserve0, pool.reserve1);
    const reserveB = poolValueForAsset(input.assetB, key.asset0, pool.reserve0, pool.reserve1);
    let amountA: u128 = 0n;
    let amountB: u128 = 0n;
    if (input.shares === pool.totalShares) {
      amountA = reserveA;
      amountB = reserveB;
    } else {
      amountA = checkedMul(input.shares, reserveA) / pool.totalShares;
      amountB = checkedMul(input.shares, reserveB) / pool.totalShares;
    }
    if (amountA < input.minAmountA || amountB < input.minAmountB) abort(6011);
    const balanceAKey = balanceKey(input.assetA, input.subject);
    const balanceBKey = balanceKey(input.assetB, input.subject);
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
