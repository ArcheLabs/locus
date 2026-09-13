import {
  action,
  abort,
  wallet,
  state,
  stateMap,
  query,
  fixedBytes,
  bytes,
  record,
  u8,
  u64,
  u128,
} from "jam";

const IdentityId = fixedBytes(32);
const AssetId = fixedBytes(32);

const OwnerV1 = record({
  version: u8,
  scheme: u8,
  payload: bytes(65),
});

const IdentityV1 = record({
  version: u8,
  owner: OwnerV1,
});

const AssetV1 = record({
  version: u8,
  issuer: IdentityId,
  name: bytes(64),
  symbol: bytes(16),
  decimals: u8,
  totalSupply: u128,
});

const BalanceKey = record({
  assetId: AssetId,
  identityId: IdentityId,
});

const AllowanceKey = record({
  assetId: AssetId,
  ownerId: IdentityId,
  spenderId: IdentityId,
});

const identities = stateMap({
  schema: "locus.identity.v1",
  key: IdentityId,
  value: IdentityV1,
});

const identityNonces = stateMap({
  schema: "locus.identity-nonce.v1",
  key: IdentityId,
  value: u64,
});

const identityCount = state({
  schema: "locus.identity-count.v1",
  value: u64,
});

const identityByIndex = stateMap({
  schema: "locus.identity-index.v1",
  key: u64,
  value: IdentityId,
});

const assets = stateMap({
  schema: "locus.asset.v1",
  key: AssetId,
  value: AssetV1,
});

const assetCount = state({
  schema: "locus.asset-count.v1",
  value: u64,
});

const assetByIndex = stateMap({
  schema: "locus.asset-index.v1",
  key: u64,
  value: AssetId,
});

const balances = stateMap({
  schema: "locus.balance.v1",
  key: BalanceKey,
  value: u128,
});

const allowances = stateMap({
  schema: "locus.allowance.v1",
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

function isZeroBytes(value: Uint8Array): boolean {
  for (let index = 0; index < value.length; index += 1) {
    if (value[index] !== 0) return false;
  }
  return true;
}

// This is the only ownership check used by identity-authorized actions.
// The identity nonce is intentionally separate from the OwnerV1 record.
function requireOwner(identityId: Uint8Array, expectedNonce: u64, sender: Uint8Array): void {
  const identity = identities.get(identityId);
  if (!identity) abort(1001);
  if (identity.version !== 1) abort(9001);

  const storedNonce = identityNonces.get(identityId) ?? 0n;
  if (storedNonce !== expectedNonce) abort(1007);

  const owner = identity.owner;
  if (owner.version !== 1) abort(9001);
  if (owner.scheme !== 0) abort(1005);
  if (owner.payload.length !== 32) abort(1006);
  if (sender.length !== 32 || !sameBytes(owner.payload, sender)) abort(1004);
}

// Call only after all action-specific checks have succeeded. A failed action
// therefore cannot consume the identity-level nonce.
function consumeIdentityNonce(identityId: Uint8Array, nonce: u64): void {
  const storedNonce = identityNonces.get(identityId) ?? 0n;
  if (storedNonce !== nonce) abort(1007);
  if (nonce === 18446744073709551615n) abort(3003);
  identityNonces.set(identityId, nonce + 1n);
}

export const createIdentity = action({
  auth: wallet(),
  input: { identityId: IdentityId },
  execute(ctx, input) {
    if (isZeroBytes(input.identityId)) abort(1003);
    if (identities.has(input.identityId)) abort(1002);

    identities.set(input.identityId, {
      version: 1,
      owner: {
        version: 1,
        scheme: 0,
        payload: ctx.sender,
      },
    });
    identityNonces.set(input.identityId, 0n);

    const count = identityCount.get() ?? 0n;
    if (count === 18446744073709551615n) abort(3003);
    identityByIndex.set(count, input.identityId);
    identityCount.set(count + 1n);
  },
});

export const rotateOwner = action({
  auth: wallet(),
  input: {
    identityId: IdentityId,
    nonce: u64,
    newOwnerScheme: u8,
    newOwnerPayload: bytes(65),
  },
  execute(ctx, input) {
    requireOwner(input.identityId, input.nonce, ctx.sender);

    if (input.newOwnerScheme !== 0) abort(1005);
    if (input.newOwnerPayload.length !== 32 || isZeroBytes(input.newOwnerPayload)) abort(1006);

    const identity = identities.get(input.identityId);
    if (!identity || identity.version !== 1) abort(9001);
    if (sameBytes(identity.owner.payload, input.newOwnerPayload)) abort(1008);

    identities.set(input.identityId, {
      version: 1,
      owner: {
        version: 1,
        scheme: 0,
        payload: input.newOwnerPayload,
      },
    });
    consumeIdentityNonce(input.identityId, input.nonce);
  },
});

export const createAsset = action({
  auth: wallet(),
  input: {
    issuerId: IdentityId,
    nonce: u64,
    assetId: AssetId,
    name: bytes(64),
    symbol: bytes(16),
    decimals: u8,
    initialSupply: u128,
  },
  execute(ctx, input) {
    requireOwner(input.issuerId, input.nonce, ctx.sender);

    if (isZeroBytes(input.assetId)) abort(2003);
    if (assets.has(input.assetId)) abort(2002);
    if (input.name.length === 0) abort(2004);
    if (input.symbol.length === 0) abort(2005);
    if (input.decimals > 38) abort(2006);

    assets.set(input.assetId, {
      version: 1,
      issuer: input.issuerId,
      name: input.name,
      symbol: input.symbol,
      decimals: input.decimals,
      totalSupply: input.initialSupply,
    });

    if (input.initialSupply > 0n) {
      balances.set({ assetId: input.assetId, identityId: input.issuerId }, input.initialSupply);
    }

    const count = assetCount.get() ?? 0n;
    if (count === 18446744073709551615n) abort(3003);
    assetByIndex.set(count, input.assetId);
    assetCount.set(count + 1n);
    consumeIdentityNonce(input.issuerId, input.nonce);
  },
});

export const mint = action({
  auth: wallet(),
  input: {
    issuerId: IdentityId,
    nonce: u64,
    assetId: AssetId,
    toId: IdentityId,
    amount: u128,
  },
  execute(ctx, input) {
    requireOwner(input.issuerId, input.nonce, ctx.sender);

    const asset = assets.get(input.assetId);
    if (!asset) abort(2001);
    if (!sameBytes(asset.issuer, input.issuerId)) abort(2007);
    if (!identities.has(input.toId)) abort(3001);

    const balanceKey = { assetId: input.assetId, identityId: input.toId };
    const currentBalance = balances.get(balanceKey) ?? 0n;
    if (input.amount > 340282366920938463463374607431768211455n - asset.totalSupply) abort(3003);
    if (input.amount > 340282366920938463463374607431768211455n - currentBalance) abort(3003);
    const nextSupply = asset.totalSupply + input.amount;
    const nextBalance = currentBalance + input.amount;

    assets.set(input.assetId, {
      version: 1,
      issuer: asset.issuer,
      name: asset.name,
      symbol: asset.symbol,
      decimals: asset.decimals,
      totalSupply: nextSupply,
    });
    balances.set(balanceKey, nextBalance);
    consumeIdentityNonce(input.issuerId, input.nonce);
  },
});

export const transfer = action({
  auth: wallet(),
  input: {
    fromId: IdentityId,
    nonce: u64,
    assetId: AssetId,
    toId: IdentityId,
    amount: u128,
  },
  execute(ctx, input) {
    requireOwner(input.fromId, input.nonce, ctx.sender);

    if (!assets.has(input.assetId)) abort(2001);
    if (!identities.has(input.toId)) abort(3001);

    const fromKey = { assetId: input.assetId, identityId: input.fromId };
    const fromBalance = balances.get(fromKey) ?? 0n;
    if (fromBalance < input.amount) abort(3002);

    if (!sameBytes(input.fromId, input.toId)) {
      const toKey = { assetId: input.assetId, identityId: input.toId };
      const toBalance = balances.get(toKey) ?? 0n;
      if (input.amount > 340282366920938463463374607431768211455n - toBalance) abort(3003);
      balances.set(fromKey, fromBalance - input.amount);
      balances.set(toKey, toBalance + input.amount);
    }
    consumeIdentityNonce(input.fromId, input.nonce);
  },
});

export const burn = action({
  auth: wallet(),
  input: {
    fromId: IdentityId,
    nonce: u64,
    assetId: AssetId,
    amount: u128,
  },
  execute(ctx, input) {
    requireOwner(input.fromId, input.nonce, ctx.sender);

    const asset = assets.get(input.assetId);
    if (!asset) abort(2001);
    const balanceKey = { assetId: input.assetId, identityId: input.fromId };
    const balance = balances.get(balanceKey) ?? 0n;
    if (balance < input.amount) abort(3002);
    if (asset.totalSupply < input.amount) abort(9001);

    balances.set(balanceKey, balance - input.amount);
    assets.set(input.assetId, {
      version: 1,
      issuer: asset.issuer,
      name: asset.name,
      symbol: asset.symbol,
      decimals: asset.decimals,
      totalSupply: asset.totalSupply - input.amount,
    });
    consumeIdentityNonce(input.fromId, input.nonce);
  },
});

export const approve = action({
  auth: wallet(),
  input: {
    ownerId: IdentityId,
    nonce: u64,
    assetId: AssetId,
    spenderId: IdentityId,
    amount: u128,
  },
  execute(ctx, input) {
    requireOwner(input.ownerId, input.nonce, ctx.sender);

    if (!assets.has(input.assetId)) abort(2001);
    if (!identities.has(input.spenderId)) abort(4001);
    allowances.set({
      assetId: input.assetId,
      ownerId: input.ownerId,
      spenderId: input.spenderId,
    }, input.amount);
    consumeIdentityNonce(input.ownerId, input.nonce);
  },
});

export const transferFrom = action({
  auth: wallet(),
  input: {
    spenderId: IdentityId,
    nonce: u64,
    assetId: AssetId,
    fromId: IdentityId,
    toId: IdentityId,
    amount: u128,
  },
  execute(ctx, input) {
    requireOwner(input.spenderId, input.nonce, ctx.sender);

    if (!assets.has(input.assetId)) abort(2001);
    if (!identities.has(input.fromId)) abort(1001);
    if (!identities.has(input.toId)) abort(3001);

    const allowanceKey = {
      assetId: input.assetId,
      ownerId: input.fromId,
      spenderId: input.spenderId,
    };
    const allowance = allowances.get(allowanceKey) ?? 0n;
    if (allowance < input.amount) abort(4002);

    const fromKey = { assetId: input.assetId, identityId: input.fromId };
    const fromBalance = balances.get(fromKey) ?? 0n;
    if (fromBalance < input.amount) abort(3002);

    if (!sameBytes(input.fromId, input.toId)) {
      const toKey = { assetId: input.assetId, identityId: input.toId };
      const toBalance = balances.get(toKey) ?? 0n;
      if (input.amount > 340282366920938463463374607431768211455n - toBalance) abort(3003);
      balances.set(fromKey, fromBalance - input.amount);
      balances.set(toKey, toBalance + input.amount);
    }
    allowances.set(allowanceKey, allowance - input.amount);
    consumeIdentityNonce(input.spenderId, input.nonce);
  },
});

export const getIdentity = query(identities);
export const getIdentityNonce = query(identityNonces);
export const getIdentityCount = query(identityCount);
export const getIdentityByIndex = query(identityByIndex);
export const getAsset = query(assets);
export const getAssetCount = query(assetCount);
export const getAssetByIndex = query(assetByIndex);
export const getBalance = query(balances);
export const getAllowance = query(allowances);
