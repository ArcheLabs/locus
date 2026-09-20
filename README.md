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

## Local web preview

Install the web dependencies once:

```bash
npm --prefix web install
```

Start the default visual preview in Demo Mode:

```bash
VITE_LOCUS_MODE=demo \
  npm --prefix web run dev -- --host 127.0.0.1
```

Open [http://127.0.0.1:5173](http://127.0.0.1:5173). Demo Mode uses only the
prototype assets and activity data; it does not contact the backend.

To preview the real Local Network Mode, make sure the Local MiniJAM node and
JamScript backend are running, then start Vite with:

```bash
VITE_LOCUS_MODE=network \
VITE_LOCUS_DEFAULT_NETWORK=local \
  npm --prefix web run dev -- --host 127.0.0.1
```

Network Mode loads the runtime configuration from
[`web/public/locus-networks.json`](web/public/locus-networks.json), fetches the
Local deployment descriptor, creates the published `JamScriptClient`, and
calls `validateDeployment()` before showing real assets. The current Local
backend is `http://127.0.0.1:8090`; the descriptor contains the validated
Service deployment. Testnet is shown as an option but remains Not configured
until a canonical public descriptor is published. Network Mode never falls
back to Demo Mode.

Stop the Vite preview with `Ctrl-C`. If it was started in the Docker preview
container used by this checkout, stop it with:

```bash
docker rm -f locus-v02-web-preview
```

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
