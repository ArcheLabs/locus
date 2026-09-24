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
    this.matrixBootstrapUsed = new Map();
    this.assetIndex = [];
    this.pools = new Map();
    this.poolIndex = [];
  }

  asset(assetId) {
    return this.assets.get(key(assetId));
  }
  controllerGrant(subject, controller) {
    return this.controllerGrants.get(key(subject) + ":" + key(controller)) ?? null;
  }

  matrixBootstrapCompleted(subject) {
    return this.matrixBootstrapUsed.get(key(subject)) === 1;
  }

  requireController(subject, controller) {
    if (equal(subject, controller)) return;
    if (this.controllerGrant(subject, controller) !== 1) abort(5001);
  }

  bootstrapMatrixController(subject, controller, proofValid = true) {
    if (this.matrixBootstrapCompleted(subject)) abort(5004);
    if (subject.kind !== 0 || controller.kind !== 0 || !proofValid) abort(5005);
    this.matrixBootstrapUsed.set(key(subject), 1);
    this.controllerGrants.set(key(subject) + ":" + key(controller), 1);
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

  createPool(manager, assetA, assetB, amountA, amountB) {
    if (!this.asset(assetA) || !this.asset(assetB)) abort(2001);
    poolReserve(amountA);
    poolReserve(amountB);
    if (amountA === 0n || amountB === 0n) abort(6004);
    const [asset0, asset1] = canonicalPoolKey(assetA, assetB);
    const poolKey = `${asset0}:${asset1}`;
    if (this.pools.has(poolKey)) abort(6002);
    if (this.balance(assetA, manager) < amountA || this.balance(assetB, manager) < amountB) abort(3002);
    const assetAIs0 = key(assetA) === asset0;
    const pool = {
      version: 1,
      manager: clone(manager),
      asset0: assetAIs0 ? assetA.slice() : assetB.slice(),
      asset1: assetAIs0 ? assetB.slice() : assetA.slice(),
      reserve0: assetAIs0 ? amountA : amountB,
      reserve1: assetAIs0 ? amountB : amountA,
    };
    this.balances.set(`${key(assetA)}:${key(manager)}`, this.balance(assetA, manager) - amountA);
    this.balances.set(`${key(assetB)}:${key(manager)}`, this.balance(assetB, manager) - amountB);
    this.pools.set(poolKey, pool);
    this.poolIndex.push({ asset0: pool.asset0.slice(), asset1: pool.asset1.slice() });
  }

  createPoolAs(controller, subject, assetA, assetB, amountA, amountB) {
    this.requireController(subject, controller);
    this.createPool(subject, assetA, assetB, amountA, amountB);
  }

  addPoolLiquidityAs(controller, subject, assetA, assetB, amountA, amountB) {
    this.requireController(subject, controller);
    const pool = this.pool(assetA, assetB);
    if (!pool) abort(6001);
    if (!equal(pool.manager, subject)) abort(6007);
    poolReserve(amountA);
    poolReserve(amountB);
    if (amountA === 0n || amountB === 0n) abort(6004);
    const assetAIs0 = key(assetA) === key(pool.asset0);
    const reserveA = assetAIs0 ? pool.reserve0 : pool.reserve1;
    const reserveB = assetAIs0 ? pool.reserve1 : pool.reserve0;
    const nextA = add(reserveA, amountA);
    const nextB = add(reserveB, amountB);
    poolReserve(nextA);
    poolReserve(nextB);
    if (this.balance(assetA, subject) < amountA || this.balance(assetB, subject) < amountB) abort(3002);
    const nextReserve0 = assetAIs0 ? nextA : nextB;
    const nextReserve1 = assetAIs0 ? nextB : nextA;
    this.balances.set(`${key(assetA)}:${key(subject)}`, this.balance(assetA, subject) - amountA);
    this.balances.set(`${key(assetB)}:${key(subject)}`, this.balance(assetB, subject) - amountB);
    pool.reserve0 = nextReserve0;
    pool.reserve1 = nextReserve1;
  }

  removePoolLiquidityAs(controller, subject, assetA, assetB, amountA, amountB) {
    this.requireController(subject, controller);
    const pool = this.pool(assetA, assetB);
    if (!pool) abort(6001);
    if (!equal(pool.manager, subject)) abort(6007);
    amount(amountA); amount(amountB);
    if (amountA === 0n && amountB === 0n) abort(6004);
    const assetAIs0 = key(assetA) === key(pool.asset0);
    const reserveA = assetAIs0 ? pool.reserve0 : pool.reserve1;
    const reserveB = assetAIs0 ? pool.reserve1 : pool.reserve0;
    if (amountA > reserveA || amountB > reserveB) abort(6005);
    const nextBalanceA = add(this.balance(assetA, subject), amountA);
    const nextBalanceB = add(this.balance(assetB, subject), amountB);
    const nextReserveA = reserveA - amountA;
    const nextReserveB = reserveB - amountB;
    this.balances.set(`${key(assetA)}:${key(subject)}`, nextBalanceA);
    this.balances.set(`${key(assetB)}:${key(subject)}`, nextBalanceB);
    pool.reserve0 = assetAIs0 ? nextReserveA : nextReserveB;
    pool.reserve1 = assetAIs0 ? nextReserveB : nextReserveA;
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
    if (name === "getMatrixBootstrapUsed") return this.matrixBootstrapUsed.get(key(queryKey)) ?? null;
    if (name === "getPool") return this.pool(queryKey.asset0, queryKey.asset1);
    if (name === "getPoolCount") return BigInt(this.poolIndex.length);
    if (name === "getPoolByIndex") return this.poolIndex[Number(queryKey)] ?? null;
    throw new Error(`unknown query ${name}`);
  }
}
