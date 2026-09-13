# Locus protocol v0.1

This document freezes the application protocol for the `locus` JamScript
service. The canonical state is one JamScript Managed State domain.

## Identifiers and records

`IdentityId` and `AssetId` are opaque `fixedBytes(32)` values. They must be
non-zero and unique within their registry. Neither is a public key, wallet
address, SS58 address, or symbol. Symbols are metadata and need not be unique.

The versioned records are logically:

```text
OwnerV1    { version: u8, scheme: u8, payload: bytes(65) }
IdentityV1 { version: u8, owner: OwnerV1 }
AssetV1    { version: u8, issuer: IdentityId, name: bytes(64),
             symbol: bytes(16), decimals: u8, totalSupply: u128 }
BalanceKey { assetId: AssetId, identityId: IdentityId }
AllowanceKey { assetId: AssetId, ownerId: IdentityId, spenderId: IdentityId }
```

v0.1 fixes `OwnerV1.version = 1` and `OwnerV1.scheme = 0` for sr25519;
sr25519 payloads are exactly 32 bytes. Metadata is UTF-8 by SDK convention,
with non-empty name and symbol and `decimals <= 38`. Amounts are integer `u128`.

## Actions

All actions are `wallet()` authenticated. The service compares `ctx.sender`
with the current owner payload; `ctx.sender` is never an identity or ledger
key. Identity-authorized actions carry the current identity `nonce: u64` and
consume it only after every business check succeeds.

```text
createIdentity(identityId)
rotateOwner(identityId, nonce, newOwnerScheme, newOwnerPayload)
createAsset(issuerId, nonce, assetId, name, symbol, decimals, initialSupply)
mint(issuerId, nonce, assetId, toId, amount)
transfer(fromId, nonce, assetId, toId, amount)
burn(fromId, nonce, assetId, amount)
approve(ownerId, nonce, assetId, spenderId, amount)
transferFrom(spenderId, nonce, assetId, fromId, toId, amount)
```

`createIdentity` sets the caller as owner and starts the identity nonce at 0.
`createAsset` assigns initial supply to the issuer identity. `mint` requires
the issuer identity's current owner. Transfers require only the source owner;
the recipient does not sign. `transferFrom` requires the spender identity's
owner, checks the identity-to-identity allowance, and decreases it by the
transferred amount. Zero transfers and self transfers are valid and consume
the authorizing identity nonce. Allowance zero is valid and no allowance is
implicitly infinite.

## Queries

The direct queries are:

```text
getIdentity(id), getIdentityNonce(id), getIdentityCount(), getIdentityByIndex(i)
getAsset(id), getAssetCount(), getAssetByIndex(i)
getBalance({assetId, identityId})
getAllowance({assetId, ownerId, spenderId})
```

Missing balances and allowances are interpreted by the SDK as `0n`. Missing
identities and assets remain not found. Registry indexes are discovery
conveniences only; map membership is authoritative.

## Stable errors

```text
1001 IDENTITY_NOT_FOUND             1002 IDENTITY_ALREADY_EXISTS
1003 INVALID_IDENTITY_ID            1004 UNAUTHORIZED_OWNER
1005 UNSUPPORTED_OWNER_SCHEME       1006 INVALID_OWNER
1007 IDENTITY_NONCE_MISMATCH        1008 OWNER_UNCHANGED

2001 ASSET_NOT_FOUND                2002 ASSET_ALREADY_EXISTS
2003 INVALID_ASSET_ID               2004 INVALID_ASSET_NAME
2005 INVALID_ASSET_SYMBOL           2006 INVALID_DECIMALS
2007 NOT_ASSET_ISSUER

3001 DESTINATION_IDENTITY_NOT_FOUND 3002 INSUFFICIENT_BALANCE
3003 AMOUNT_OVERFLOW

4001 SPENDER_IDENTITY_NOT_FOUND     4002 INSUFFICIENT_ALLOWANCE
9001 STATE_INVARIANT_VIOLATION
```

Numeric fatal codes from JamScript are not Locus application errors. The
language-0.3 checked arithmetic remains the final defense against wraparound.

## Invariants

Balances and allowances are keyed by identities. Owner rotation changes only
the owner record and consumes the current identity nonce. It does not rewrite
balances, allowances, `AssetV1.issuer`, or supply. Thus the old owner is
rejected, the new owner is accepted, and issuer authority follows the stable
issuer identity automatically.
