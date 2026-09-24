# MiniJAM Local deployment ledger

The production web app currently targets **MiniJAM Local / Development**. The
active Locus Service is `3083943385` with code hash
`0xd0458437d18c4af8a012a96edcf84d66c5a881034cb063bfc51c7a9d25ab0a1`.
`3302613027` is retained as the rollback deployment.

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
