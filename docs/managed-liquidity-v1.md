# Managed Liquidity v1

Locus v1 exposes managed liquidity through the official Web UI. Ordinary users can inspect pools and swap. A configured manager Ownership can create configured pools and add or remove reserves.

Each pool has one manager Ownership. This version does not issue LP tokens, track LP shares, or account for liquidity from multiple providers. Swap fees remain in pool reserves and are not tracked as a separate fee balance. The UI does not estimate APR, APY, USD TVL, or fees earned.

Manager controls are shown only when the connected Ownership key matches the network's validated `web/public/liquidity/<network>.json` configuration. The UI checks the on-chain `pool.manager` before allowing reserve changes. A manager mismatch is displayed as a conflict and cannot be modified from the management panel. Add liquidity follows the current reserve ratio, and withdrawals remove both reserves proportionally.

The management UI uses curated catalog keys rather than fixed asset IDs. Its configuration path follows the Vite base path, so a `/candidate/` build reads `/candidate/liquidity/local.json`.

**Protocol limitation:** the Service still exposes generic `createPool`, `addPoolLiquidity`, and `removePoolLiquidity` actions to any authorized Ownership. The configured manager restriction is a Web product policy in v1, not a protocol-level ACL. Protocol-level pool creation authorization is outside this version. Do not describe the Service as Treasury-only.

There are no LP tokens or shares, permissionless liquidity UI, yield calculations, fee accounting, oracle, router, or equity demo pools in v1. A missing pool remains missing: the UI never fabricates pool state or quotes.
