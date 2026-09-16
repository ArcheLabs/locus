# ERC-20-like semantics

Locus exposes the familiar asset operations at the SDK/product level, with an
explicit `assetId` at the low-level service boundary:

```text
name() symbol() decimals() totalSupply()
balanceOf(identityId)
transfer(fromId, toId, amount)
approve(ownerId, spenderId, amount)
allowance(ownerId, spenderId)
transferFrom(spenderId, fromId, toId, amount)
```

Balances and allowances are identity-native. `transfer` needs only the source
identity's current owner; the destination does not sign. `transferFrom` needs
only the spender identity's current owner and decreases the allowance by the
exact amount. An allowance may exceed the current balance, zero is a valid
approval, and `u128::MAX` has no special infinite meaning.

This is semantic compatibility, not an EVM bytecode or ABI promise. Locus is a
multi-asset JamScript service and additionally supports identity-authorized
`mint` and holder-authorized `burn`.
