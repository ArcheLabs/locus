import { OWNERSHIP_KIND, ownershipKey, toHex } from "@jamscript/client";

export const MAX_U128 = (1n << 128n) - 1n;

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

export class LocusModel {
  constructor() {
    this.assets = new Map();
    this.balances = new Map();
    this.allowances = new Map();
    this.controllerGrants = new Map();
    this.matrixBootstrapUsed = new Map();
    this.assetIndex = [];
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

  createAsset(issuer, assetId, name, symbol, decimals, initialSupply) {
    if (!(assetId instanceof Uint8Array) || assetId.length !== 32 || assetId.every((byte) => byte === 0)) abort(2003);
    if (this.assets.has(key(assetId))) abort(2002);
    if (!(name instanceof Uint8Array) || name.length === 0 || name.length > 64) abort(2004);
    if (!(symbol instanceof Uint8Array) || symbol.length === 0 || symbol.length > 16) abort(2005);
    if (!Number.isInteger(decimals) || decimals > 38 || decimals < 0) abort(2006);
    amount(initialSupply);
    this.assets.set(key(assetId), { version: 2, issuer: clone(issuer), name: clone(name), symbol: clone(symbol), decimals, totalSupply: initialSupply });
    if (initialSupply > 0n) this.balances.set(`${key(assetId)}:${key(issuer)}`, initialSupply);
    this.assetIndex.push(clone(assetId));
  }

  createAssetAs(controller, subject, assetId, name, symbol, decimals, initialSupply) {
    this.requireController(subject, controller);
    this.createAsset(subject, assetId, name, symbol, decimals, initialSupply);
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

  query(name, queryKey) {
    if (name === "getAsset") return this.asset(queryKey) ?? null;
    if (name === "getAssetCount") return BigInt(this.assetIndex.length);
    if (name === "getAssetByIndex") return this.assetIndex[Number(queryKey)] ?? null;
    if (name === "getBalance") return this.balances.get(`${key(queryKey.assetId)}:${key(queryKey.ownerKey)}`) ?? 0n;
    if (name === "getAllowance") return this.allowances.get(`${key(queryKey.assetId)}:${key(queryKey.ownerKey)}:${key(queryKey.spenderKey)}`) ?? 0n;
    if (name === "getControllerGrant") return this.controllerGrants.get(key(queryKey.subjectKey) + ":" + key(queryKey.controllerKey)) ?? null;
    if (name === "getMatrixBootstrapUsed") return this.matrixBootstrapUsed.get(key(queryKey)) ?? null;
    throw new Error(`unknown query ${name}`);
  }
}
