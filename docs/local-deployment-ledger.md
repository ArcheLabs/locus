# MiniJAM Local deployment ledger

The production web app currently targets **MiniJAM Local / Development**.
Service `3083943385` (code hash
`0xd0458437d18c4af8a012a96edcf84d66c5a881034cb063bfc51c7a9d25ab0a1`) remains
the live service until the rc.8 cutover is complete. The new immutable candidate
is Service `797069104` with code hash
`0x9c9cd5766cbdc8cdaa927103899283e974c5cdf9367e49d76369a8d335bd1cb8` and
service key
`0xeeb9c2c46f5fff320952ceb77bef3f4152a37e679e92e28603682de5ad8ec254`.
It was built reproducibly with published `jams v0.1.0-rc.8` and the verified
canonical rc.8 toolchain (SHA-256
`f804235bdae7239e57d9a7eb0d4413df65d1f785c05aa0cb4af5a28297548d03`), then
registered in the existing JamScript Backend. `3302613027` remains the rollback
deployment.

The public descriptor is kept at `web/public/deployments/local.json`; a copy of
the prior live descriptor is retained at
`web/public/deployments/local-3083943385.json`. The runtime catalog is bound to
the candidate's genesis and Service ID. Do not switch the served static build
until the final CI and browser bootstrap checks pass.

Service `615639671` is an unused finalized candidate that reused the live
service key and therefore could not register in the production Backend. It is
not active or catalogued. Keep its receipt for audit; do not use it for the
cutover.

Finalized deployments `2262072784` and `2671640402` are unused historical
deployments. They are not registered as active services, are not present in the
deployment catalog, and are not referenced by the web app. Keep them as chain
history; do not treat them as active or attempt to delete them.

## Demo liquidity

`config/liquidity/local.v1.json` is the source for the five Local demo pool
ratios. Amounts are human-readable decimal strings and are converted using each
asset's on-chain decimals. These ratios are demo pool prices, not market prices;
there is no price oracle. Pool state remains authoritative for whether a pair is
available.

The seed command is idempotent for pools that already match the configured
reserves and Treasury manager. A conflicting pool state fails closed. It never
tops up or replaces a pool automatically.

## Treasury signer boundary

The fixed demo Treasury is
`0x78B02E176e587E163661fBe70232CCDDEb11759e`. For a file-backed signer, store a
single 32-byte hexadecimal private key outside the repository, for example at
`/home/azureuser/.secrets/locus-treasury`, with owner-only mode `0600`. Provide
only its path through `LOCUS_TREASURY_KEY_FILE`. The seeding tool derives and
checks the EVM address before it contacts the JamScript Backend. A missing,
unsafe, invalid, or mismatched key stops the command without a chain write.

Never commit the signer file, put its contents in environment variables or
shell history, or use an issuer or MiniJAM operator key as the Treasury.
