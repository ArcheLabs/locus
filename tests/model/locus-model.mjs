export const MAX_U128 = (1n << 128n) - 1n;
export const MAX_U64 = (1n << 64n) - 1n;

export function id(byte) {
  const value = new Uint8Array(32);
  value.fill(byte);
  return value;
}

export function key(value) {
  return Array.from(value, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function clone(value) {
  return value instanceof Uint8Array ? value.slice() : value;
}

function equal(left, right) {
  return left.length === right.length && left.every((byte, index) => byte === right[index]);
}

function nonZero(value) {
  return value.some((byte) => byte !== 0);
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
    this.identities = new Map();
    this.assets = new Map();
    this.balances = new Map();
    this.allowances = new Map();
    this.identityIndex = [];
    this.assetIndex = [];
  }

  identity(idValue) {
    return this.identities.get(key(idValue));
  }

  asset(assetId) {
    return this.assets.get(key(assetId));
  }

  balance(assetId, identityId) {
    return this.balances.get(`${key(assetId)}:${key(identityId)}`) ?? 0n;
  }

  allowance(assetId, ownerId, spenderId) {
    return this.allowances.get(`${key(assetId)}:${key(ownerId)}:${key(spenderId)}`) ?? 0n;
  }

  requireId(idValue, code) {
    if (!(idValue instanceof Uint8Array) || idValue.length !== 32 || !nonZero(idValue)) abort(code);
  }

  requireIdentity(idValue) {
    this.requireId(idValue, 1003);
    const identity = this.identity(idValue);
    if (!identity) abort(1001);
    return identity;
  }

  requireOwner(identityId, nonce, sender) {
    const identity = this.requireIdentity(identityId);
    if (identity.nonce !== nonce) abort(1007);
    if (!equal(identity.owner, sender)) abort(1004);
    return identity;
  }

  consume(identityId, nonce) {
    const identity = this.requireIdentity(identityId);
    if (identity.nonce !== nonce) abort(1007);
    if (nonce === MAX_U64) abort(3003);
    identity.nonce += 1n;
  }

  createIdentity(identityId, sender) {
    this.requireId(identityId, 1003);
    const identityKey = key(identityId);
    if (this.identities.has(identityKey)) abort(1002);
    this.identities.set(identityKey, { owner: clone(sender), nonce: 0n });
    this.identityIndex.push(clone(identityId));
  }

  rotateOwner(identityId, nonce, newOwnerPayload, sender, newOwnerScheme = 0) {
    const identity = this.requireOwner(identityId, nonce, sender);
    if (newOwnerScheme !== 0) abort(1005);
    if (!(newOwnerPayload instanceof Uint8Array) || newOwnerPayload.length !== 32 || !nonZero(newOwnerPayload)) abort(1006);
    if (equal(identity.owner, newOwnerPayload)) abort(1008);
    identity.owner = clone(newOwnerPayload);
    this.consume(identityId, nonce);
  }

  createAsset(issuerId, nonce, assetId, name, symbol, decimals, initialSupply, sender) {
    this.requireOwner(issuerId, nonce, sender);
    this.requireId(assetId, 2003);
    if (this.assets.has(key(assetId))) abort(2002);
    if (!(name instanceof Uint8Array) || name.length === 0 || name.length > 64) abort(2004);
    if (!(symbol instanceof Uint8Array) || symbol.length === 0 || symbol.length > 16) abort(2005);
    if (!Number.isInteger(decimals) || decimals > 38 || decimals < 0) abort(2006);
    amount(initialSupply);
    this.assets.set(key(assetId), {
      issuer: clone(issuerId),
      name: clone(name),
      symbol: clone(symbol),
      decimals,
      totalSupply: initialSupply,
    });
    if (initialSupply > 0n) this.balances.set(`${key(assetId)}:${key(issuerId)}`, initialSupply);
    this.assetIndex.push(clone(assetId));
    this.consume(issuerId, nonce);
  }

  mint(issuerId, nonce, assetId, toId, value, sender) {
    this.requireOwner(issuerId, nonce, sender);
    const asset = this.asset(assetId);
    if (!asset) abort(2001);
    if (!equal(asset.issuer, issuerId)) abort(2007);
    if (!this.identity(toId)) abort(3001);
    amount(value);
    asset.totalSupply = add(asset.totalSupply, value);
    this.balances.set(`${key(assetId)}:${key(toId)}`, add(this.balance(assetId, toId), value));
    this.consume(issuerId, nonce);
  }

  transfer(fromId, nonce, assetId, toId, value, sender) {
    this.requireOwner(fromId, nonce, sender);
    if (!this.asset(assetId)) abort(2001);
    if (!this.identity(toId)) abort(3001);
    amount(value);
    const fromBalance = this.balance(assetId, fromId);
    if (fromBalance < value) abort(3002);
    if (!equal(fromId, toId)) {
      this.balances.set(`${key(assetId)}:${key(fromId)}`, sub(fromBalance, value));
      this.balances.set(`${key(assetId)}:${key(toId)}`, add(this.balance(assetId, toId), value));
    }
    this.consume(fromId, nonce);
  }

  burn(fromId, nonce, assetId, value, sender) {
    this.requireOwner(fromId, nonce, sender);
    const asset = this.asset(assetId);
    if (!asset) abort(2001);
    amount(value);
    const balance = this.balance(assetId, fromId);
    if (balance < value || asset.totalSupply < value) abort(3002);
    this.balances.set(`${key(assetId)}:${key(fromId)}`, balance - value);
    asset.totalSupply -= value;
    this.consume(fromId, nonce);
  }

  approve(ownerId, nonce, assetId, spenderId, value, sender) {
    this.requireOwner(ownerId, nonce, sender);
    if (!this.asset(assetId)) abort(2001);
    if (!this.identity(spenderId)) abort(4001);
    amount(value);
    this.allowances.set(`${key(assetId)}:${key(ownerId)}:${key(spenderId)}`, value);
    this.consume(ownerId, nonce);
  }

  transferFrom(spenderId, nonce, assetId, fromId, toId, value, sender) {
    this.requireOwner(spenderId, nonce, sender);
    if (!this.asset(assetId)) abort(2001);
    if (!this.identity(fromId)) abort(1001);
    if (!this.identity(toId)) abort(3001);
    amount(value);
    const allowanceKey = `${key(assetId)}:${key(fromId)}:${key(spenderId)}`;
    const currentAllowance = this.allowance(assetId, fromId, spenderId);
    if (currentAllowance < value) abort(4002);
    const fromBalance = this.balance(assetId, fromId);
    if (fromBalance < value) abort(3002);
    if (!equal(fromId, toId)) {
      this.balances.set(`${key(assetId)}:${key(fromId)}`, fromBalance - value);
      this.balances.set(`${key(assetId)}:${key(toId)}`, add(this.balance(assetId, toId), value));
    }
    this.allowances.set(allowanceKey, currentAllowance - value);
    this.consume(spenderId, nonce);
  }

  totalBalance(assetId) {
    let sum = 0n;
    for (const [balanceKey, value] of this.balances) {
      if (balanceKey.startsWith(`${key(assetId)}:`)) sum += value;
    }
    return sum;
  }

  query(name, queryKey) {
    if (name === "getIdentity") return this.identity(queryKey) ?? null;
    if (name === "getIdentityNonce") return this.identity(queryKey)?.nonce ?? null;
    if (name === "getIdentityCount") return BigInt(this.identityIndex.length);
    if (name === "getIdentityByIndex") return this.identityIndex[Number(queryKey)] ?? null;
    if (name === "getAsset") return this.asset(queryKey) ?? null;
    if (name === "getAssetCount") return BigInt(this.assetIndex.length);
    if (name === "getAssetByIndex") return this.assetIndex[Number(queryKey)] ?? null;
    if (name === "getBalance") return this.balance(queryKey.assetId, queryKey.identityId);
    if (name === "getAllowance") return this.allowance(queryKey.assetId, queryKey.ownerId, queryKey.spenderId);
    throw new Error(`unknown query ${name}`);
  }
}
