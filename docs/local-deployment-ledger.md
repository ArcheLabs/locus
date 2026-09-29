# MiniJAM Local deployment ledger

The production web app targets **MiniJAM Local / Development**. Its active
immutable Locus Service is `4062826813`, finalized at block `6382`, with code
hash
`0x5cebd9fef97033c3f20fc7e1cd35475914ba8ce8513af65e97ae7b3edde819d3`.
It was built with published `jams v0.1.0-rc.8` and the verified canonical rc.8
toolchain (SHA-256
`f804235bdae7239e57d9a7eb0d4413df65d1f785c05aa0cb4af5a28297548d03`) from
commit `ff828ed`. Pool-share square root planning now uses a bounded,
division-free comparison to avoid the PVM trap seen on the prior Service.

The HTTPS `/` deployment and Local catalog both target Service `4062826813`.
Its state was initialized from scratch: six curated assets have their complete
initial supply at Treasury, and `poolCount=0`. No state was migrated from the
previous Service `2323996321`; that immutable Service remains registered with
its old state and must not be used by the production catalog. `797069104`,
`3083943385`, and `3302613027` are older historical deployments.

The HTTPS `/rpc` route validated the new descriptor and Backend service state.
The on-chain Matrix adapter bootstrap, controller grant, authorized action, and
client reconstruction/restore check passed using the adapter's valid local
proof fixture. This was not a real Matrix OAuth/SAS session; interactive
browser verification remains a human check.

Service `615639671` is an unused finalized candidate that reused the live
service key and therefore could not register in the production Backend. It is
not active or catalogued. Keep its receipt for audit; do not use it for the
cutover.

Service `102670611` is another unused finalized deployment. It reused the
registered Service key for `3083943385`, so Backend registration correctly
failed the one-Service-per-key invariant. No assets were bootstrapped into it;
keep its deployment receipt as an unregistered orphan.

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
catalog and state are independent of production and are not part of this
cutover. Candidate rollback builds remain at
`/var/www/locus-candidate-v1-153994977-before-v2-20260928T130431Z` and
`/var/www/locus-candidate-v1-live-rollback-20260928T130431Z`.

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
