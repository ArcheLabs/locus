# Frontend

The React/Vite web client has four product surfaces: Assets, Send, Swap, and
Activity. Recipient selection identifies the destination Ownership, not a
network or bridge route.

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

The current Local descriptor points to the validated MiniJAM Local deployment
and same-origin `/rpc` backend. Testnet remains an explicit, visible option but
is not configured until canonical operator secrets and a testnet descriptor are
available.

The web app owns the session boundary only. It does not implement EVM proof,
Polkadot proof, Matrix verification, SignedAction encoding, or MiniJAM
transaction logic. Network Mode can connect browser-provided EVM EIP-1193,
Polkadot extension, and Solana Wallet Standard sessions; each is wrapped by
the published JamScript Ownership signer. Read-only asset access does not
require a session.

Network-mode transfers resolve EVM, Polkadot, and Locus ID destinations through
the SDK, parse amounts as exact `bigint` u128 values, show a review step, call
`LocusClient.transfer()`, report Best inclusion as provisional progress, and
wait for a finalized receipt matching the saved action hash before recording
success. The same tracking rule applies to swaps, liquidity, asset creation,
and Matrix controller authorization. Pending operations are stored locally
with network, Service, account, transaction, and action identity; signatures,
wallet secrets, and Matrix tokens are not stored. A timeout or reorganization
keeps the original operation available for checking and does not offer an
automatic replacement payment. Matrix authorization is enabled only after a
finalized state query confirms the controller is active. Matrix, Telegram,
Email, and GitHub remain visible as resolver
extension points until a corresponding resolver is published.

The Assets page exposes real `createAsset` and `Receive` flows when Network
Mode is connected. Receive shares the canonical `locus:` Ownership identifier;
it does not invent a chain address. Recent successful transfers are stored as
device-local activity and are labelled as such rather than presented as a
chain-wide index.

The Local curated catalog contains DOT, MINI, USDT, and AAPL/NVDA/TSLA demo
equities. Its network, genesis, Service ID, asset ID, issuer, and on-chain
metadata must match before curated icons or labels are shown. Assets created by
users remain custom even when they reuse a curated symbol. Curated initial
supply is held by the configured EVM Treasury; the separate generated creator
identity is the issuer and does not control Treasury funds.

Swap v0 is single-hop and exact-input with a fixed 0.30% fee and caller-provided
minimum output. The current Local Service has no pools because the Treasury
signer has not been provisioned. The UI therefore shows that liquidity is not
initialized and does not show a quote. Pool prices are reserve ratios, not
market prices; equity demo pools have no market oracle.
