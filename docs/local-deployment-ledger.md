# MiniJAM Local deployment ledger

The production web app targets **MiniJAM Local / Development**. The active
immutable Locus Service is `797069104` with code hash
`0x9c9cd5766cbdc8cdaa927103899283e974c5cdf9367e49d76369a8d335bd1cb8` and
service key
`0xeeb9c2c46f5fff320952ceb77bef3f4152a37e679e92e28603682de5ad8ec254`.
It was built reproducibly with published `jams v0.1.0-rc.8` and the verified
canonical rc.8 toolchain (SHA-256
`f804235bdae7239e57d9a7eb0d4413df65d1f785c05aa0cb4af5a28297548d03`), then
registered in the existing JamScript Backend. Consumer CI run `36215662751`
passed on cutover commit `3d786aa81c52ce09950334837cebf901322e5ed2`.

The HTTPS deployment now serves the Local network configuration and descriptor
for Service `797069104`; the catalog is bound to the same genesis and Service
ID. The previous live Service `3083943385` remains registered and is retained
for rollback, with its descriptor at
`web/public/deployments/local-3083943385.json` and its prior static build at
`/var/www/locus-rollback-3083943385-20260926`. `3302613027` remains the older
rollback deployment.

The HTTPS `/rpc` route validated the new descriptor and Backend service state.
The on-chain Matrix adapter bootstrap, controller grant, authorized action, and
client reconstruction/restore check passed using the adapter's valid local
proof fixture. This was not a real Matrix OAuth/SAS session; interactive
browser verification remains a human check.

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
