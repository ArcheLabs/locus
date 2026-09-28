import { OWNERSHIP_KIND, ownershipKey, toHex } from "@jamscript/client";

export const MAX_U128 = (1n << 128n) - 1n;
export const MAX_POOL_RESERVE = (1n << 64n) - 1n;
const SWAP_FEE_BPS = 30n;
const BPS = 10_000n;

export function id(byte) {
  const value = new Uint8Array(32);
  value.fill(byte);
  return value;
}

export function owner(byte, kind = OWNERSHIP_KIND.ED25519_KEY) {
  return { version: 1, kind, public: id(byte) };
}

export function key(value) {
  return value instanceof Uint8Array ? toHex(value) : toHex(ownershipKey(value));
}

function clone(value) {
  if (value instanceof Uint8Array) return value.slice();
  if (value && typeof value === "object") {
    if ("public" in value) return { ...value, public: value.public.slice() };
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, clone(v)]));
  }
  return value;
}

function equal(left, right) {
  return key(left) === key(right);
}

function abort(code, message = `Locus abort ${code}`) {
  const error = new Error(message);
  error.code = code;
  throw error;
}

function amount(value) {
  if (typeof value !== "bigint" || value < 0n || value > MAX_U128) abort(3003);
}

function add(left, right) {
  if (left > MAX_U128 - right) abort(3003);
  return left + right;
}

function sub(left, right) {
  if (right > left) abort(3002);
  return left - right;
}

function canonicalPoolKey(assetA, assetB) {
  const keyA = key(assetA);
  const keyB = key(assetB);
  if (keyA === keyB) abort(6003);
  return keyA < keyB ? [keyA, keyB] : [keyB, keyA];
}

function poolReserve(value) {
  amount(value);
  if (value > MAX_POOL_RESERVE) abort(6008);
}

function integerSqrt(value) {
  if (value < 2n) return value;
  let low = 1n; let high = MAX_POOL_RESERVE; let result = 1n;
  while (low <= high) {
    const middle = low + (high - low) / 2n;
    if (middle <= value / middle) { result = middle; low = middle + 1n; }
    else high = middle - 1n;
  }
  return result;
}

function ceilDiv(value, denominator) {
  if (denominator === 0n) abort(9001);
  return value === 0n ? 0n : 1n + (value - 1n) / denominator;
}

function quote(reserveIn, reserveOut, amountIn) {
  poolReserve(reserveIn);
  poolReserve(reserveOut);
  poolReserve(amountIn);
  if (amountIn === 0n) abort(6004);
  if (reserveIn === 0n || reserveOut === 0n) abort(6005);
  const netAmountIn = amountIn * (BPS - SWAP_FEE_BPS) / BPS;
  if (netAmountIn === 0n) abort(6004);
  const amountOut = reserveOut * netAmountIn / (reserveIn + netAmountIn);
  if (amountOut === 0n || amountOut >= reserveOut) abort(6005);
  return amountOut;
}

export class LocusModel {
  constructor() {
    this.assets = new Map();
    this.balances = new Map();
    this.allowances = new Map();
    this.controllerGrants = new Map();
    this.assetIndex = [];
    this.pools = new Map();
    this.poolIndex = [];
    this.liquidityShares = new Map();
    this.liquidityPositions = new Map();
  }

  asset(assetId) {
    return this.assets.get(key(assetId));
  }
  controllerGrant(subject, controller) {
    return this.controllerGrants.get(key(subject) + ":" + key(controller)) ?? null;
  }

  requireController(subject, controller) {
    if (equal(subject, controller)) return;
    if (this.controllerGrant(subject, controller) !== 1) abort(5001);
  }

  authorizeMatrixController(subject, controller, proofValid = true) {
    const grantKey = key(subject) + ":" + key(controller);
    const status = this.controllerGrants.get(grantKey);
    if (status === 1) return;
    if (this.controllerGrants.has(grantKey)) abort(5003);
    if (subject.kind !== 0 || controller.kind !== 0 || !proofValid) abort(5005);
    this.controllerGrants.set(grantKey, 1);
  }

  addController(caller, subject, controller) {
    this.requireController(subject, caller);
    const grantKey = key(subject) + ":" + key(controller);
    if (this.controllerGrants.get(grantKey) === 1) abort(5002);
    if (this.controllerGrants.has(grantKey)) abort(5003);
    this.controllerGrants.set(grantKey, 1);
  }

  revokeController(caller, subject, controller) {
    this.requireController(subject, caller);
    const grantKey = key(subject) + ":" + key(controller);
    if (this.controllerGrants.get(grantKey) !== 1) abort(5006);
    this.controllerGrants.set(grantKey, 0);
  }


  balance(assetId, ownerValue) {
    return this.balances.get(`${key(assetId)}:${key(ownerValue)}`) ?? 0n;
  }

  allowance(assetId, ownerValue, spender) {
    return this.allowances.get(`${key(assetId)}:${key(ownerValue)}:${key(spender)}`) ?? 0n;
  }

  createAsset(issuer, assetId, name, symbol, decimals, initialSupply, initialHolder = issuer) {
    if (!(assetId instanceof Uint8Array) || assetId.length !== 32 || assetId.every((byte) => byte === 0)) abort(2003);
    if (this.assets.has(key(assetId))) abort(2002);
    if (!(name instanceof Uint8Array) || name.length === 0 || name.length > 64) abort(2004);
    if (!(symbol instanceof Uint8Array) || symbol.length === 0 || symbol.length > 16) abort(2005);
    if (!Number.isInteger(decimals) || decimals > 38 || decimals < 0) abort(2006);
    amount(initialSupply);
    this.assets.set(key(assetId), { version: 2, issuer: clone(issuer), name: clone(name), symbol: clone(symbol), decimals, totalSupply: initialSupply });
    if (initialSupply > 0n) this.balances.set(`${key(assetId)}:${key(initialHolder)}`, initialSupply);
    this.assetIndex.push(clone(assetId));
  }

  createAssetAs(controller, subject, assetId, name, symbol, decimals, initialSupply, initialHolder = subject) {
    this.requireController(subject, controller);
    this.createAsset(subject, assetId, name, symbol, decimals, initialSupply, initialHolder);
  }

  transferAs(controller, subject, assetId, to, value) {
    this.requireController(subject, controller);
    this.transfer(subject, assetId, to, value);
  }

  mintAs(controller, subject, assetId, to, value) {
    this.requireController(subject, controller);
    this.mint(subject, assetId, to, value);
  }

  burnAs(controller, subject, assetId, value) {
    this.requireController(subject, controller);
    this.burn(subject, assetId, value);
  }

  mint(issuer, assetId, to, value) {
    const asset = this.asset(assetId);
    if (!asset) abort(2001);
    if (!equal(asset.issuer, issuer)) abort(2007);
    amount(value);
    asset.totalSupply = add(asset.totalSupply, value);
    this.balances.set(`${key(assetId)}:${key(to)}`, add(this.balance(assetId, to), value));
  }

  transfer(from, assetId, to, value) {
    const asset = this.asset(assetId);
    if (!asset) abort(2001);
    amount(value);
    const fromBalance = this.balance(assetId, from);
    if (fromBalance < value) abort(3002);
    if (!equal(from, to)) {
      this.balances.set(`${key(assetId)}:${key(from)}`, sub(fromBalance, value));
      this.balances.set(`${key(assetId)}:${key(to)}`, add(this.balance(assetId, to), value));
    }
  }

  burn(from, assetId, value) {
    const asset = this.asset(assetId);
    if (!asset) abort(2001);
    amount(value);
    const balance = this.balance(assetId, from);
    if (balance < value || asset.totalSupply < value) abort(3002);
    this.balances.set(`${key(assetId)}:${key(from)}`, balance - value);
    asset.totalSupply -= value;
  }

  approve(ownerValue, assetId, spender, value) {
    if (!this.asset(assetId)) abort(2001);
    amount(value);
    this.allowances.set(`${key(assetId)}:${key(ownerValue)}:${key(spender)}`, value);
  }

  transferFrom(spender, assetId, from, to, value) {
    if (!this.asset(assetId)) abort(2001);
    amount(value);
    const allowanceKey = `${key(assetId)}:${key(from)}:${key(spender)}`;
    const currentAllowance = this.allowance(assetId, from, spender);
    if (currentAllowance < value) abort(4002);
    const fromBalance = this.balance(assetId, from);
    if (fromBalance < value) abort(3002);
    if (!equal(from, to)) {
      this.balances.set(`${key(assetId)}:${key(from)}`, fromBalance - value);
      this.balances.set(`${key(assetId)}:${key(to)}`, add(this.balance(assetId, to), value));
    }
    this.allowances.set(allowanceKey, currentAllowance - value);
  }

  totalBalance(assetId) {
    let sum = 0n;
    const prefix = `${key(assetId)}:`;
    for (const [balanceKey, value] of this.balances) if (balanceKey.startsWith(prefix)) sum += value;
    return sum;
  }

  pool(assetA, assetB) {
    const [asset0, asset1] = canonicalPoolKey(assetA, assetB);
    return this.pools.get(`${asset0}:${asset1}`) ?? null;
  }

  shareKey(assetA, assetB, owner) {
    const [asset0, asset1] = canonicalPoolKey(assetA, assetB);
    return `${asset0}:${asset1}:${key(owner)}`;
  }

  indexPosition(pool, owner) {
    const shareKey = this.shareKey(pool.asset0, pool.asset1, owner);
    if (this.liquidityShares.has(shareKey)) return;
    const ownerKey = key(owner);
    const positions = this.liquidityPositions.get(ownerKey) ?? [];
    positions.push({ asset0: pool.asset0.slice(), asset1: pool.asset1.slice() });
    this.liquidityPositions.set(ownerKey, positions);
  }

  assertPoolInvariant(pool) {
    const empty = pool.reserve0 === 0n && pool.reserve1 === 0n;
    if ((pool.totalShares === 0n) !== empty || (pool.totalShares > 0n && (pool.reserve0 === 0n || pool.reserve1 === 0n))) abort(9001);
  }

  createPool(owner, assetA, assetB, amountA, amountB) {
    if (!this.asset(assetA) || !this.asset(assetB)) abort(2001);
    poolReserve(amountA);
    poolReserve(amountB);
    if (amountA === 0n || amountB === 0n) abort(6009);
    const [asset0, asset1] = canonicalPoolKey(assetA, assetB);
    const poolKey = `${asset0}:${asset1}`;
    if (this.pools.has(poolKey)) abort(6002);
    if (this.balance(assetA, owner) < amountA || this.balance(assetB, owner) < amountB) abort(3002);
    const assetAIs0 = key(assetA) === asset0;
    const pool = {
      version: 2,
      asset0: assetAIs0 ? assetA.slice() : assetB.slice(),
      asset1: assetAIs0 ? assetB.slice() : assetA.slice(),
      reserve0: assetAIs0 ? amountA : amountB,
      reserve1: assetAIs0 ? amountB : amountA,
      totalShares: integerSqrt(amountA * amountB),
    };
    if (pool.totalShares === 0n) abort(6009);
    this.balances.set(`${key(assetA)}:${key(owner)}`, this.balance(assetA, owner) - amountA);
    this.balances.set(`${key(assetB)}:${key(owner)}`, this.balance(assetB, owner) - amountB);
    this.pools.set(poolKey, pool);
    this.poolIndex.push({ asset0: pool.asset0.slice(), asset1: pool.asset1.slice() });
    this.indexPosition(pool, owner);
    this.liquidityShares.set(this.shareKey(assetA, assetB, owner), pool.totalShares);
  }

  createPoolAs(controller, subject, assetA, assetB, amountA, amountB) {
    this.requireController(subject, controller);
    this.createPool(subject, assetA, assetB, amountA, amountB);
  }

  addPoolLiquidityAs(controller, subject, assetA, assetB, maxAmountA, maxAmountB, minShares = 0n) {
    this.requireController(subject, controller);
    const pool = this.pool(assetA, assetB);
    if (!pool) abort(6001);
    this.assertPoolInvariant(pool);
    poolReserve(maxAmountA); poolReserve(maxAmountB);
    if (maxAmountA === 0n || maxAmountB === 0n) abort(6009);
    const assetAIs0 = key(assetA) === key(pool.asset0);
    const max0 = assetAIs0 ? maxAmountA : maxAmountB;
    const max1 = assetAIs0 ? maxAmountB : maxAmountA;
    let used0; let used1; let minted;
    if (pool.totalShares === 0n) {
      used0 = max0; used1 = max1; minted = integerSqrt(used0 * used1);
    } else {
      const s0 = max0 * pool.totalShares / pool.reserve0;
      const s1 = max1 * pool.totalShares / pool.reserve1;
      minted = s0 < s1 ? s0 : s1;
      if (minted === 0n) abort(6009);
      used0 = ceilDiv(minted * pool.reserve0, pool.totalShares);
      used1 = ceilDiv(minted * pool.reserve1, pool.totalShares);
    }
    if (minted === 0n) abort(6009);
    if (minted < minShares) abort(6011);
    if (used0 > max0 || used1 > max1) abort(9001);
    const usedA = assetAIs0 ? used0 : used1;
    const usedB = assetAIs0 ? used1 : used0;
    if (this.balance(assetA, subject) < usedA || this.balance(assetB, subject) < usedB) abort(3002);
    const nextReserve0 = add(pool.reserve0, used0);
    const nextReserve1 = add(pool.reserve1, used1);
    poolReserve(nextReserve0); poolReserve(nextReserve1);
    const ownerKey = this.shareKey(assetA, assetB, subject);
    const nextOwnerShares = add(this.liquidityShares.get(ownerKey) ?? 0n, minted);
    pool.reserve0 = nextReserve0; pool.reserve1 = nextReserve1;
    pool.totalShares = add(pool.totalShares, minted);
    this.balances.set(`${key(assetA)}:${key(subject)}`, this.balance(assetA, subject) - usedA);
    this.balances.set(`${key(assetB)}:${key(subject)}`, this.balance(assetB, subject) - usedB);
    this.indexPosition(pool, subject);
    this.liquidityShares.set(ownerKey, nextOwnerShares);
    return { usedA, usedB, mintedShares: minted };
  }

  removePoolLiquidityAs(controller, subject, assetA, assetB, shares, minAmountA = 0n, minAmountB = 0n) {
    this.requireController(subject, controller);
    const pool = this.pool(assetA, assetB);
    if (!pool) abort(6001);
    this.assertPoolInvariant(pool);
    if (shares === 0n) abort(6009);
    const ownerShareKey = this.shareKey(assetA, assetB, subject);
    const ownerShares = this.liquidityShares.get(ownerShareKey) ?? 0n;
    if (shares > ownerShares || shares > pool.totalShares) abort(6010);
    const assetAIs0 = key(assetA) === key(pool.asset0);
    const amount0 = shares === pool.totalShares ? pool.reserve0 : shares * pool.reserve0 / pool.totalShares;
    const amount1 = shares === pool.totalShares ? pool.reserve1 : shares * pool.reserve1 / pool.totalShares;
    const amountA = assetAIs0 ? amount0 : amount1;
    const amountB = assetAIs0 ? amount1 : amount0;
    if (amountA < minAmountA || amountB < minAmountB) abort(6011);
    const nextBalanceA = add(this.balance(assetA, subject), amountA);
    const nextBalanceB = add(this.balance(assetB, subject), amountB);
    this.balances.set(`${key(assetA)}:${key(subject)}`, nextBalanceA);
    this.balances.set(`${key(assetB)}:${key(subject)}`, nextBalanceB);
    pool.reserve0 -= amount0; pool.reserve1 -= amount1;
    pool.totalShares -= shares;
    this.liquidityShares.set(ownerShareKey, ownerShares - shares);
  }

  swapExactInAs(controller, subject, assetIn, assetOut, amountIn, minAmountOut) {
    this.requireController(subject, controller);
    if (!this.asset(assetIn) || !this.asset(assetOut)) abort(2001);
    poolReserve(amountIn); amount(minAmountOut);
    if (amountIn === 0n) abort(6004);
    const pool = this.pool(assetIn, assetOut);
    if (!pool) abort(6001);
    const inputIs0 = key(assetIn) === key(pool.asset0);
    const reserveIn = inputIs0 ? pool.reserve0 : pool.reserve1;
    const reserveOut = inputIs0 ? pool.reserve1 : pool.reserve0;
    const balanceIn = this.balance(assetIn, subject);
    const balanceOut = this.balance(assetOut, subject);
    if (balanceIn < amountIn) abort(3002);
    const amountOut = quote(reserveIn, reserveOut, amountIn);
    if (amountOut < minAmountOut) abort(6006);
    const nextReserveIn = add(reserveIn, amountIn);
    poolReserve(nextReserveIn);
    const nextBalanceOut = add(balanceOut, amountOut);
    this.balances.set(`${key(assetIn)}:${key(subject)}`, balanceIn - amountIn);
    this.balances.set(`${key(assetOut)}:${key(subject)}`, nextBalanceOut);
    pool.reserve0 = inputIs0 ? nextReserveIn : reserveOut - amountOut;
    pool.reserve1 = inputIs0 ? reserveOut - amountOut : nextReserveIn;
    return amountOut;
  }

  quoteExactIn(assetIn, assetOut, amountIn) {
    const pool = this.pool(assetIn, assetOut);
    if (!pool) abort(6001);
    const inputIs0 = key(assetIn) === key(pool.asset0);
    return quote(inputIs0 ? pool.reserve0 : pool.reserve1, inputIs0 ? pool.reserve1 : pool.reserve0, amountIn);
  }

  totalAccounted(assetId) {
    let sum = this.totalBalance(assetId);
    for (const pool of this.pools.values()) {
      if (key(pool.asset0) === key(assetId)) sum += pool.reserve0;
      if (key(pool.asset1) === key(assetId)) sum += pool.reserve1;
    }
    return sum;
  }

  query(name, queryKey) {
    if (name === "getAsset") return this.asset(queryKey) ?? null;
    if (name === "getAssetCount") return BigInt(this.assetIndex.length);
    if (name === "getAssetByIndex") return this.assetIndex[Number(queryKey)] ?? null;
    if (name === "getBalance") return this.balances.get(`${key(queryKey.assetId)}:${key(queryKey.ownerKey)}`) ?? 0n;
    if (name === "getAllowance") return this.allowances.get(`${key(queryKey.assetId)}:${key(queryKey.ownerKey)}:${key(queryKey.spenderKey)}`) ?? 0n;
    if (name === "getControllerGrant") return this.controllerGrants.get(key(queryKey.subjectKey) + ":" + key(queryKey.controllerKey)) ?? null;
    if (name === "getPool") return this.pool(queryKey.asset0, queryKey.asset1);
    if (name === "getPoolCount") return BigInt(this.poolIndex.length);
    if (name === "getPoolByIndex") return this.poolIndex[Number(queryKey)] ?? null;
    if (name === "getLiquidityShares") return this.liquidityShares.get(`${key(queryKey.asset0)}:${key(queryKey.asset1)}:${key(queryKey.ownerKey)}`) ?? null;
    if (name === "getLiquidityPositionCount") return BigInt((this.liquidityPositions.get(key(queryKey)) ?? []).length);
    if (name === "getLiquidityPositionByIndex") return (this.liquidityPositions.get(key(queryKey.ownerKey)) ?? [])[Number(queryKey.index)] ?? null;
    throw new Error(`unknown query ${name}`);
  }
}
