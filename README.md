# Locus v0.2

Locus is an Ownership-native multi-asset service for JamScript. Assets are
owned directly by canonical JamScript `Ownership` values; Locus does not
create application identities, wallet accounts, or bridge destinations.

```text
Asset → Ownership
```

The service uses JamScript Ownership authentication and receives the effective
owner from `ctx.owner`. Controllers and ControlClaims are verified by the
JamScript platform. Locus does not implement signature verification, EIP-712,
Matrix cross-signing, or external wallet protocols.

## Consumer-mode development

Locus is built as an external JamScript consumer. A clean checkout uses only
the published `jams` binary, its managed toolchain bundle, and the published
`@jamscript/client` package. It does not require a JamScript source checkout,
ScriptC invocation, or a local MiniJAM source tree.

```bash
npm install
jams check .
jams abi .
jams build . --output ./dist
npm test
npm run build:web
```

The pinned release baseline is recorded in [`releases.lock`](releases.lock).
MiniJAM is consumed from the independent `ArcheLabs/minijam-client`
`stage1-v0.2.0` release image.

## Protocol surface

The service exposes `createAsset`, `transfer`, `approve`, `transferFrom`,
`mint`, and `burn`. Recipient Ownership values do not need to be registered.
Balances use a canonical `ownershipKey(owner)` state key, while the public SDK
continues to accept and return `Ownership` values. All quantities remain
`bigint`/JamScript `u128` values.

The SDK is in [`sdk/src`](sdk/src), the service is [`src/service.ts`](src/service.ts),
and the React/Vite web client is in [`web`](web). Network Mode never falls back
to mock data; Demo Mode is explicit and is only for the frontend prototype.

## Published platform baseline

The consumer baseline uses the published [JamScript
`v0.1.0-rc.7`](https://github.com/ArcheLabs/JamScript/releases/tag/v0.1.0-rc.7)
CLI/toolchain and [Backend
`backend-v0.1.0-rc.7`](https://github.com/ArcheLabs/JamScript/releases/tag/backend-v0.1.0-rc.7).
The published npm client is pinned separately in `releases.lock`. Locus does
not reproduce JamScript compiler, runtime, or Ownership protocol features
locally.
