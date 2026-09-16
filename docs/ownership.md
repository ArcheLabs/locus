# Ownership abstraction

Locus separates the logical owner of an asset from the key that currently
controls an identity:

```text
SignedActionV1 → JamScript wallet verification → ctx.sender
                                      ↓
                           Identity.owner.payload
                                      ↓
                              authorized Identity
```

`IdentityId` is a stable caller-provided 32-byte logical identifier. It is not
derived from a key. Asset balances, allowances, and issuer links resolve
through that identifier. `ctx.sender` is proof material only.

The central `requireOwner` check validates the identity and record versions,
loads the independent identity nonce, compares the supplied nonce, requires
the sr25519 scheme and 32-byte payload, and compares the payload with
`ctx.sender`. `consumeIdentityNonce` is separate and runs only after business
checks pass. JamScript's outer wallet nonce remains a separate replay layer.

Owner rotation is one-step in v0.1: the current owner selects a new non-zero
sr25519 public key, which takes effect immediately. The new key does not
co-sign, so the current owner can select a key whose private key is not
available; the SDK can validate shape but cannot prove possession. Two-phase
acceptance and recovery are future work.

Critically, key rotation is not an asset transfer. It changes no `BalanceKey`,
`AllowanceKey`, asset issuer, metadata, or supply state. This is why an
allowance from Alice Identity to Bob Identity and Alice's mint authority
survive rotation from key A to key B.
