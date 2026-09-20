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

export const createAsset = action({
  auth: ownership(),
  input: {
    assetId: AssetId,
    name: bytes(64),
    symbol: bytes(16),
    decimals: u8,
    initialSupply: u128,
  },
  execute(ctx, input) {
    requireAssetId(input.assetId);
    if (assets.has(input.assetId)) abort(2002);
    if (input.name.length === 0) abort(2004);
    if (input.symbol.length === 0) abort(2005);
    if (input.decimals > 38) abort(2006);

    assets.set(input.assetId, {
      version: 2,
      issuer: ctx.owner,
      name: input.name,
      symbol: input.symbol,
      decimals: input.decimals,
      totalSupply: input.initialSupply,
    });

    if (input.initialSupply > 0n) {
      balances.set(balanceKey(input.assetId, ctx.owner), input.initialSupply);
    }

    const count = assetCount.get() ?? 0n;
    if (count === 18446744073709551615n) abort(3003);
    assetByIndex.set(count, input.assetId);
    assetCount.set(count + 1n);
  },
});

export const transfer = action({
  auth: ownership(),
  input: {
    assetId: AssetId,
    to: ownership,
    amount: u128,
  },
  execute(ctx, input) {
    const asset = assets.get(input.assetId);
    if (!asset) abort(2001);

    const fromKey = balanceKey(input.assetId, ctx.owner);
    const fromBalance = balances.get(fromKey) ?? 0n;
    if (fromBalance < input.amount) abort(3002);

    if (!sameOwnership(ctx.owner, input.to)) {
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
    assetId: AssetId,
    spender: ownership,
    amount: u128,
  },
  execute(ctx, input) {
    if (!assets.has(input.assetId)) abort(2001);
    allowances.set(allowanceKey(input.assetId, ctx.owner, input.spender), input.amount);
  },
});

export const transferFrom = action({
  auth: ownership(),
  input: {
    assetId: AssetId,
    from: ownership,
    to: ownership,
    amount: u128,
  },
  execute(ctx, input) {
    if (!assets.has(input.assetId)) abort(2001);

    const fromOwnerKey = ownerKey(input.from);
    const controllerOwnerKey = ownerKey(ctx.owner);
    const key = {
      assetId: input.assetId,
      ownerKey: fromOwnerKey,
      spenderKey: controllerOwnerKey,
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
    assetId: AssetId,
    to: ownership,
    amount: u128,
  },
  execute(ctx, input) {
    const asset = assets.get(input.assetId);
    if (!asset) abort(2001);
    if (!sameOwnership(asset.issuer, ctx.owner)) abort(2007);

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
    assetId: AssetId,
    amount: u128,
  },
  execute(ctx, input) {
    const asset = assets.get(input.assetId);
    if (!asset) abort(2001);
    const key = balanceKey(input.assetId, ctx.owner);
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
