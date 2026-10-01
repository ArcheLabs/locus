# MiniJAM Local deployment ledger

The production web app targets **MiniJAM Local / Development**. Its active
immutable Locus Service is `3640358060`, finalized at block `22251`, with code
hash
`0x7244d2be5d4c66cd59b186700c18e86464e0e5768cb73e64b4d03258cbd97114`.
It was built from Locus commit `5a5fcba` with JamScript source commit
`13db5b9de941bfa739894d75fbcf0758bf35cef4`; its runtime includes the
Polkadot `signRaw` byte-wrapper verifier fix from
`6f20644d4c2a38d2d29d2ff4b46bda037e60ca4a`. The Local build uses the
source development toolchain, Clang 20.1.8, and release optimization.

The HTTPS `/` deployment and Local catalog target Service `3640358060`.
It was initialized from scratch with six curated assets and the full initial
supply of each asset at Treasury. `poolCount=0`; no state, balances, or pool
positions were migrated. Former Service `895565822` remains immutable with its
previous state and is preserved as a rollback target in
`web/public/deployments/local-rollback-895565822.json` and
`web/public/catalogs/local-895565822.json`. Its predecessor Service
`3362439117` remains immutable as well. Earlier rollback descriptors and
catalogs for `3389972726`, `4209643396`, and `4062826813` remain preserved at
their existing paths. `2323996321`, `797069104`, `3083943385`, and
`3302613027` are older historical deployments.

The Local backend registered the new Service after finalized deployment.
The six asset creation actions finalized and each full initial supply was
confirmed at Treasury. The backend runs
`locus-backend:local-polkadot-signraw-wrapper-20261001`; it accepts the
standard `<Bytes>...</Bytes>` message wrapper produced by Polkadot extension
`signRaw` signatures and retries a batch only when MiniJAM explicitly rejects
the preflight context as stale, rebuilding the batch from the latest finalized
context. The preceding backend image remains available locally for rollback.


## Earlier deployment records

The previous Local deployment on Service `895565822` is preserved by the
rollback descriptor and catalog above. Earlier immutable services include
`3389972726`, `4209643396`, `4062826813`, and `3362439117`; their existing
rollback files remain available.

Service `615639671` is an unused finalized candidate that reused the live
service key and therefore could not register in the production Backend. It is
not active or catalogued. Keep its receipt for audit; do not use it for the
cutover.

Service `102670611` is another unused finalized deployment. It reused the
registered Service key for `3083943385`, so Backend registration correctly
failed the one-Service-per-key invariant. No assets were bootstrapped into it;
keep its receipt as an unregistered orphan.

Service `153994977` is the preserved v1 multi-controller candidate. It remains
registered in the Local Backend with its existing state, including one
permissionless-liquidity-v1 pool (`MINI/DOT`, manager Treasury,
`reserve0=110000000`, `reserve1=90933892`). Its descriptor and static build are
preserved for rollback; its state was not migrated or modified during the v2
deployment.

Permissionless Liquidity v2 is deployed at the existing HTTPS `/candidate/`
path and targets a separate immutable Service, `2915918722`, with code hash
`0xcf5e57f9a764fee594ea4f434bc2313f7ec2cdca77fccc88ca31409b55868387`.
The deployment finalized at block `77345` and is registered in the Local
Backend. Its candidate descriptor and catalog are under
`.jamscript/candidates/local-2915918722/`. The candidate has all six curated
assets, with each full initial supply held by Treasury, and `poolCount=0`.
No liquidity was created or seeded. The v2 candidate does not inherit v1 pool
positions or arbitrary user balances.

The separate candidate frontend remains available at
`https://locus.minijam.xyz/candidate/` and targets Service `2915918722`. Its
catalog and state are independent of production. Candidate rollback builds
remain at `/var/www/locus-candidate-v1-153994977-before-v2-20260928T130431Z`
and `/var/www/locus-candidate-v1-live-rollback-20260928T130431Z`.

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
reserves and Treasury manager for the historical v1 deployment. Permissionless
Liquidity v2 supersedes that policy and uses independent LP share accounting. A
conflicting v1 pool must be preserved and reseeded by its capital providers; it
is never converted automatically.

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
