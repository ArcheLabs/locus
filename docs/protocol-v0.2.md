# Locus protocol v0.2

## Ownership

Every asset has an `issuer: Ownership`. A signed action authenticated with
`auth: ownership()` receives the effective owner as `ctx.owner`. The controller
that supplied the authorization proof is platform context and is not stored as
the asset owner.

The action surface is:

```text
createAsset(assetId, name, symbol, decimals, initialSupply)
transfer(assetId, to, amount)
approve(assetId, spender, amount)
transferFrom(assetId, from, to, amount)
mint(assetId, to, amount)
burn(assetId, amount)
```

There is no `IdentityId`, `OwnerV1`, `rotateOwner`, application identity
nonce, or wallet-authenticated compatibility action in v0.2.

## State keys

The public API uses Ownership values. Managed-state maps use the standard
JamScript `ownershipKey(owner)` primitive and never implement a Locus-specific
Ownership codec. Balance keys are `(assetId, ownerKey)`, and allowance keys
are `(assetId, ownerKey, spenderKey)`.

An Ownership recipient may be entirely new to Locus. Sending does not require
recipient registration.

## Invariants

- total supply equals the sum of all balances for an asset;
- transfers and mints use checked `u128` arithmetic;
- `transferFrom` decreases the allowance by the transferred amount;
- issuer comparison is canonical Ownership comparison, not controller-key
  comparison;
- failed action checks do not mutate ledger state.
