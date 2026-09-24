# Locus v0.2

Locus is an Ownership-native multi-asset service for JamScript. Assets are
owned directly by canonical JamScript `Ownership` values; Locus does not
create application identities, wallet accounts, or bridge destinations.

```text
Asset → Ownership
```

JamScript authenticates the cryptographic controller and exposes the pure
Matrix M→S→D proof verifier. Locus receives the authenticated signer as
`ctx.controller`, keeps controller grants and Matrix bootstrap tombstones in
its own managed state, and applies the grant to a stable `subject`. Assets,
balances, allowances, and identity authorization therefore share one Locus
state root. Locus does not use a network-scoped Ownership Control service.

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

## Local web preview

Install the web dependencies once:

```bash
npm --prefix web install
```

Start the real network-mode preview (Local by default):

```bash
  npm --prefix web run dev -- --host 127.0.0.1
```

Open [http://127.0.0.1:5173](http://127.0.0.1:5173). Network Mode loads the
configured network and never falls back to Demo Mode.

To preview the prototype assets and activity data, explicitly opt in to Demo:

```bash
VITE_LOCUS_MODE=demo \
  npm --prefix web run dev -- --host 127.0.0.1
```

Production builds always use Network Mode. `VITE_LOCUS_MODE=demo` only affects
the Vite development server. Network Mode loads the runtime configuration from
[`web/public/locus-networks.json`](web/public/locus-networks.json), fetches the
deployment descriptor, creates the published `JamScriptClient`, and calls
`validateDeployment()` before showing real assets. The live web deployment
uses same-origin `/rpc` to reach the loopback backend. The current network is
MiniJAM Local / Development; Testnet remains unconfigured until a canonical
descriptor is published.

In Network Mode, `Connect` uses a browser-provided EVM EIP-1193 wallet, the
official Polkadot extension-dapp adapter, the official Solana Wallet Standard
registry, or the Matrix login flow. If a wallet exposes multiple accounts, the
account is selected explicitly. A Polkadot account without a reliable
`ed25519`, `sr25519`, or `ecdsa` scheme is rejected rather than guessed.
Transfers show a review step before signing. The Assets page is the default
page, supports searchable network-asset selection, can create an asset with
the connected Ownership as issuer, and can display a canonical `locus:` Receive
identifier. Demo Mode remains mock-only and never submits these actions.

Matrix uses the cross-signing master key as the stable Locus subject and the
current device Ed25519 key as the controller. The web adapter uses the public
`matrix-js-sdk` login/API surface and a single `OlmMachine` crypto engine; it
does not call `initRustCrypto()`, access private SDK fields, persist passwords,
or hash Matrix IDs into Ownership. `/keys/query` evidence is encoded through
the JamScript Matrix proof codec and a recipient resolves to the master key,
never to a device key. After Element verification, the Locus client submits
`bootstrapMatrixController(proof)` once; later devices must be added by an
active controller through `addController`.

The browser stores ordinary wallet session identifiers in local storage and
Matrix access/refresh credentials in session storage only. EVM account changes
invalidate the old signer immediately. Radix Dialog, DropdownMenu, and
Popover provide Escape, focus, restore, and outside-click behavior. The
deterministic mock signer tests run with `npm test`; real browser wallet smoke
tests still require the corresponding wallet extension or Wallet Standard
provider to be installed.

The current JamScript source contains the Matrix proof codec, TS/Rust parity
vectors, and the deterministic `verifyMatrixCrossSigning` primitive. The
next `@jamscript/client@0.1.0-rc.3` prerelease removes platform ControlClaim
ingress APIs while preserving the proof codec and wallet signers. Locus uses
its own `LocusClient` identity methods and injects `subject` into business
payloads; it does not submit `actAs`. A clean consumer checkout must use the
packed client prerelease before the human npm publish step.

Stop the Vite preview with `Ctrl-C`. If it was started in the Docker preview
container used by this checkout, stop it with:

```bash
docker rm -f locus-v02-web-preview
```

## Protocol surface

The service exposes `bootstrapMatrixController`, `addController`,
`revokeController`, `createAsset`, `transfer`, `approve`, `transferFrom`,
`mint`, and `burn`. Controller authorization is local to Locus, and recipient
Ownership values do not need to be registered.
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
