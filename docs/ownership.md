# JamScript Ownership integration

Locus delegates ownership authentication to JamScript:

```text
SignedActionV2
  ↓
JamScript Ownership runtime
  ↓
ctx.owner / ctx.controller
  ↓
Locus ledger
```

`ctx.owner` is the logical subject that owns balances and assets. `ctx.controller`
is the controller that supplied the authorization proof. ControlClaim
delegation and controller replacement are platform concerns; Locus only sees
the resulting effective owner.

Matrix resolves a user ID to its cross-signing master key and represents that
key as `Ownership(ED25519_KEY, M)`. A device controller can act for that
subject through a JamScript ControlClaim. EVM addresses use
`Ownership(SECP256K1_KECCAK20, H160)`, and Polkadot SS58 values decode to
`Ownership(MULTICRYPTO_ACCOUNT32, AccountId32)`.

No Locus code performs signature verification or implements SignedActionV2.
