# Locus

Identity-native multi-asset infrastructure built with JamScript.

Locus v0.1 manages local user-created assets. Assets belong to stable
identities, not wallet addresses:

```text
Asset → Identity → Owner
```

Public keys authenticate actions. An `IdentityId` is an opaque 32-byte logical
identifier, while the current sr25519 owner is replaceable. Rotating that owner
changes authorization without moving balances, allowances, or issuer
relationships.

## v0.1 surface

The service provides `createIdentity`, owner rotation, user-created assets,
mint, burn, transfer, and ERC-20-like `approve` / `allowance` /
`transferFrom` semantics. This is semantic compatibility at the SDK level, not
EVM ABI compatibility. The only supported owner scheme is sr25519, authenticated
by JamScript's wallet action layer and exposed to the service as `ctx.sender`.

Amounts and supplies are JamScript `u128` values and must be passed as
JavaScript `bigint`; they are never converted through `number`.

Locus v0.1 does not account for native JAM, bridge external assets, execute
EVM/Solana transactions, provide external identity claims, or include a
production UI. Locus is an independent service, not an official JAM component.

## Build and test

The service requires JamScript language 0.3, ABI version 1, and the pinned
revision in [`deps/jamscript.lock`](deps/jamscript.lock). With the `jams` CLI
available:

```bash
jams check .
jams abi .
jams build . --output dist
```

The local reference-model and SDK tests can be run with:

```bash
npm test
```

They use fixed deterministic identifiers. SDK callers should use
`randomIdentityId()` and `randomAssetId()` for application-generated IDs.

## Real MiniJAM

Network deployment uses JamScript's current deployment and client paths; Locus
does not ship an RPC backend, signed-action codec, wallet nonce implementation,
managed-state database, or PVM runner. Configure a named MiniJAM network, build
the artifact, deploy it, and run [`scripts/test-minijam.sh`](scripts/test-minijam.sh).
The real-network test is intentionally separate from ordinary local tests.

See [`docs/protocol-v0.1.md`](docs/protocol-v0.1.md),
[`docs/ownership.md`](docs/ownership.md), and
[`docs/state-layout.md`](docs/state-layout.md) for the frozen protocol surface.
