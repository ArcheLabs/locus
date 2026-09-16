# Locus Managed State layout v1

Each declaration below is a stable JamScript Managed State namespace. Keys are
canonical JamScript record encodings; manual string concatenation is not used.

```text
locus.identity.v1
  IdentityId -> IdentityV1

locus.identity-nonce.v1
  IdentityId -> u64

locus.identity-count.v1
  scalar -> u64

locus.identity-index.v1
  u64 -> IdentityId

locus.asset.v1
  AssetId -> AssetV1

locus.asset-count.v1
  scalar -> u64

locus.asset-index.v1
  u64 -> AssetId

locus.balance.v1
  BalanceKey { assetId, identityId } -> u128

locus.allowance.v1
  AllowanceKey { assetId, ownerId, spenderId } -> u128
```

The scalar counts and index maps are append-only convenience registries. A
record's existence is determined only by `identities[id]` or `assets[id]`.
There is no balance map keyed by a public key, owner payload, wallet address,
or `ctx.sender`.

All state updates in one action use JamScript's transactional state diff. A
failed action does not commit a partial supply, balance, allowance, owner, or
nonce update.
