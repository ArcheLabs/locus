# Frontend

The React/Vite web client has three product surfaces: Send, Assets, and Activity.
Recipient selection identifies the destination Ownership, not a network or
bridge route.

The application has two modes:

- Network Mode is the default for development and every production build.
  It loads `/locus-networks.json`, fetches the selected
  deployment descriptor, creates the published `JamScriptClient`, calls
  `validateDeployment()`, and then reads through `LocusClient`.
- Demo Mode is an explicit development opt-in using
  `VITE_LOCUS_MODE=demo`; it keeps the visual prototype data. Production builds
  ignore this value and are guarded to compile as Network Mode.

Network selection is persisted under `locus.network.v1`. The URL `?network=`
selection takes precedence over local storage, followed by
`VITE_LOCUS_DEFAULT_NETWORK` and the runtime config default. Switching networks
clears network-specific assets, activity, and pending transaction UI before the
new client is bootstrapped. Stale bootstrap responses cannot overwrite the
currently selected network.

Production-priority recipient forms are Matrix, EVM Address, Polkadot Account,
and Locus ID. Telegram, Email, and GitHub remain preview/extension-point
entries until a corresponding cryptographic resolver is published.

Demo Mode is explicit and uses the visual prototype data. Network Mode reads
real asset metadata and balances from the selected deployed Locus service. It
does not use demo assets, fake balances, fake USD values, or mock activity. A
network without a descriptor is shown as Not configured rather than falling
back to Local or Demo.

The current Local descriptor points to the published rc.7 backend and the
validated local MiniJAM deployment. Testnet remains an explicit, visible
option but is not configured until a canonical public descriptor is published.

The web app owns the session boundary only. It does not implement EVM proof,
Polkadot proof, Matrix verification, SignedAction encoding, or MiniJAM
transaction logic. Network Mode can connect browser-provided EVM EIP-1193,
Polkadot extension, and Solana Wallet Standard sessions; each is wrapped by
the published JamScript Ownership signer. Read-only asset access does not
require a session.

Network-mode transfers resolve EVM, Polkadot, and Locus ID destinations through
the SDK, parse amounts as exact `bigint` u128 values, show a review step, call
`LocusClient.transfer()`, wait for `transactionId` finalization, and show the
receipt. Matrix, Telegram, Email, and GitHub remain visible as resolver
extension points until a corresponding resolver is published.

The Assets page exposes real `createAsset` and `Receive` flows when Network
Mode is connected. Receive shares the canonical `locus:` Ownership identifier;
it does not invent a chain address. Recent successful transfers are stored as
device-local activity and are labelled as such rather than presented as a
chain-wide index.
