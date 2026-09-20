# Frontend

The web prototype has three product surfaces: Send, Assets, and Activity.
Recipient selection identifies the destination Ownership, not a network or
bridge route.

Production-priority recipient forms are Matrix, EVM Address, Polkadot Account,
and Locus ID. Telegram, Email, and GitHub remain preview/extension-point
entries until a corresponding cryptographic resolver is published.

Demo Mode is explicit and uses the visual prototype data. Network Mode must be
connected to a real published JamScript client, an Ownership signer, and a
deployed Locus descriptor. It reports missing resolver/signer configuration;
it never silently displays Demo Mode data as network state.
