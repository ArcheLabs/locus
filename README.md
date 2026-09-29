# Locus v0.3

Locus is an Ownership-native multi-asset service for JamScript. Assets are
owned directly by canonical JamScript `Ownership` values; Locus does not
create application identities, wallet accounts, or bridge destinations. The
v0.3 web client presents curated MiniJAM test assets and demo equities,
supports single-pool exact-input swaps, and provides permissionless liquidity
positions with non-transferable per-Ownership shares.

```text
Asset → Ownership
```

JamScript Core authenticates the cryptographic controller of each signed
action and exposes provider-neutral cryptographic primitives. Matrix M→S→D
verification is implemented by the JamScript Ownership Matrix adapter on top
of those primitives. Locus consumes that adapter and does not implement
Matrix cryptography. It keeps controller grants and Matrix bootstrap tombstones
in its own managed state, and applies each grant to a stable `subject`. Assets,
balances, allowances, and identity authorization therefore share one Locus
state root. Locus does not use a network-scoped Ownership Control service.

## Consumer-mode development

Locus consumes the published JamScript Client package directly. A clean
checkout installs the pinned dependencies from npm and uses the published
JamScript CLI with its canonical managed toolchain; no JamScript source
checkout or locally packed Client tarball is needed.

```bash
npm ci
npm --prefix web ci
jams --version
jams toolchain verify
npm run check
npm run build
npm test
npm run build:web
```

The Locus check and build scripts bundle the published Ownership Matrix
service adapter into a temporary JamScript project, then invoke the installed
`jams` CLI and its canonical managed toolchain. The compiler does not import
the adapter directly from the npm package at the Locus source path.

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
never to a device key. After Element verification, each Locus Matrix device
submits `authorizeMatrixController(proof)` for its own `(master subject,
device controller)` pair. Any number of cross-signing-verified devices can
authorize independently; an active controller does not approve new Matrix
devices. A revoked pair cannot be re-enrolled with its old proof.

The browser stores ordinary wallet session identifiers in local storage and
Matrix access/refresh credentials in session storage only. EVM account changes
invalidate the old signer immediately. Radix Dialog, DropdownMenu, and
Popover provide Escape, focus, restore, and outside-click behavior. The
deterministic mock signer tests run with `npm test`; real browser wallet smoke
tests still require the corresponding wallet extension or Wallet Standard
provider to be installed.

The published JamScript Client package contains the Matrix proof codec and the
Ownership Matrix client/service adapters. Its service adapter verifies M→S→D
using provider-neutral JamScript primitives; Locus delegates verification to
that adapter. Locus uses its own `LocusClient` identity methods and injects
`subject` into business payloads; it does not submit `actAs`.

Stop the Vite preview with `Ctrl-C`. If it was started in the Docker preview
container used by this checkout, stop it with:

```bash
docker rm -f locus-v02-web-preview
```

## Protocol surface

The service exposes `authorizeMatrixController`, `addController`,
`revokeController`, `createAsset`, pool-management actions, `swapExactIn`,
`transfer`, `approve`, `transferFrom`, `mint`, and `burn`. `createAsset` keeps
the issuer (`subject`) separate from its optional `initialHolder`; the SDK
defaults the holder to the current subject. Controller authorization is local
to Locus, and recipient Ownership values do not need to be registered.
Balances use a canonical `ownershipKey(owner)` state key, while the public SDK
continues to accept and return `Ownership` values. All quantities remain
`bigint`/JamScript `u128` values. Swap v0 uses a fixed 30 bps fee, one
constant-product pool per canonical asset pair, and a reserve cap that keeps
the multiplication within `u128`.

Curated asset presentation is bound to the selected deployment and on-chain
asset ID, metadata, and issuer. A matching symbol by itself never grants a
brand icon or curated badge. DOT and USDT entries are test representations;
AAPL, NVDA, and TSLA are demo equities without ownership, dividend, voting, or
redemption rights. Swap prices come from pool reserves only, not a market
oracle. The current Local deployment has no seeded pools, so Swap reports that
liquidity is not initialized and does not produce a quote.

The SDK is in [`sdk/src`](sdk/src), the service is [`src/service.ts`](src/service.ts),
and the React/Vite web client is in [`web`](web). Network Mode never falls back
to mock data; Demo Mode is explicit and is only for the frontend prototype.

## Published platform baseline

The consumer baseline uses the published [JamScript
`v0.1.0-rc.8`](https://github.com/ArcheLabs/JamScript/releases/tag/v0.1.0-rc.8)
CLI/toolchain and [Backend
`backend-v0.1.0-rc.8`](https://github.com/ArcheLabs/JamScript/releases/tag/backend-v0.1.0-rc.8).
The published `@jamscript/client@0.1.0-rc.4` SDK package is pinned in
`releases.lock` and consumed directly from npm. Locus does not reproduce
JamScript compiler, runtime, or Ownership protocol features locally.

For a fresh single-host MiniJAM Local deployment, see the
[Local server deployment runbook](docs/local-server-deployment.md).
