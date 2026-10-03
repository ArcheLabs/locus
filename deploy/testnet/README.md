# MiniJAM Stage-1 TestNet and Locus Backend

Stage-1 runs MiniJAM `stage1-v0.2.1` and the prebuilt Locus RC12 candidate
from Locus commit `2b6aeb5a51005d3503edfcfa97be780994fa5550`. The active
immutable Service is `3962414306`, finalized at block `24901`, with code hash
`0xc8f58efb503f4dce2615fc19e163d8690300794a33381a44de9f9ebbc54a4a62`. Its
Backend runs RC12 with a fresh data directory. The prior Service `4139860077`
and Backend data directory `/var/lib/locus/backend-rc10` remain preserved; no
application state was copied to the new Service or Backend.

The checked-in `dist/` is the verified RC12 artifact with a 1 MiB initial and
16 MiB maximum heap. Six curated assets were recreated on the new Service and
their full initial supplies were verified at Treasury `0x544ac734c6b113789ea97ac145b1a141bb7e0c65`.
No pools or old balances were migrated. The live Pages descriptor and catalog
must identify Service `3962414306` and match this artifact before publication.

## Runtime shape

[`compose.minijam.yaml`](compose.minijam.yaml) follows the split Node,
Worker, and Formal RPC services in the official
[`deploy/stage1/compose.compact.yml`](https://github.com/ArcheLabs/minijam-client/blob/1000bd7504a61010b5e83b1cae5a651b9373ae08/deploy/stage1/compose.compact.yml)
at the locked release commit. It pins all three image digests, keeps
`--chain=testnet` and the private `minijam-testnet-chain`, uses file-backed
secrets, and bind-mounts persistent host data. The upstream environment-backed
secret declarations are not copied into this runtime profile.

The Locus Backend is a separate service in
[`backend.compose.yaml`](backend.compose.yaml). It joins that private network,
uses the release's `node` and `formal-rpc` service DNS names, and binds only
to host loopback port 8090. The public proxy exposes its application route at
`https://rpc-stage1.minijam.xyz/rpc`; it must not expose Node RPC, Formal RPC,
Worker health, or Tuwunel Client API.

## Ordered activation

1. Confirm no other authority using the same canonical Aura/GRANDPA identity
   is currently authoring this network.
2. Check the release manifest and both chain-spec checksums against
   `releases.lock`. Preserve the official chain spec and its genesis.
3. Match protected key files to their roles and the release's public
   identities. For file-backed Compose secrets, place runtime copies under
   `/etc/minijam/secrets`, owned by the image's secret-reading UID and mode
   `0400`. The Compose file's `file:` secret mount does not rewrite host
   ownership or permissions.
4. Import only the canonical Aura and GRANDPA keys into the persistent Node
   keystore with the release CLI's offline `key insert` command. Keep the
   Node P2P key separate. Configure only the Worker registered in this
   release's genesis; do not import unrelated generated identities.
5. Start the official MiniJAM Node first. Check genesis and local RPC, then
   confirm both best and finalized heights advance. Start Formal RPC and the
   registered Worker only after the Node is correct; verify their published
   readiness paths from the pinned release.
6. Start the Backend with this overlay after the official stack has created
   `minijam-testnet-chain`. Verify its readiness at
   `http://127.0.0.1:8090/readinessz` and confirm the chain identity before
   deploying the Locus Service.
7. Validate the checked-in RC12 artifact using
   `python3 scripts/verify-prebuilt-dist.py`; deploy it as a new immutable
   Service from the prebuilt artifact. For a fresh Stage-1 rollout, create a
   new Backend data directory and do not copy the prior managed-state database.
8. Generate `web/public/deployments/testnet.json` from finalized on-chain
   deployment evidence, then publish the matching curated catalog. The Pages
   workflow checks the descriptor, artifact metadata, and locked versions.

Start the node by itself after importing the matching authority keys. The
Node-only profile avoids requiring the still-unconfigured Formal RPC relayer
file during this first phase. Once all three role files exist, use the full
profile with the same Compose project name:

```sh
docker compose -f deploy/testnet/compose.node.yaml up -d
docker compose -f deploy/testnet/compose.minijam.yaml up -d formal-rpc worker
docker compose -f deploy/testnet/backend.compose.yaml up -d
```

The Backend overlay expects the Node and Formal RPC services on
`minijam-testnet-chain`. No host firewall or cloud firewall rules are
changed by these Compose files.

## Host capacity and persistence

The prepared host has 2 vCPU, about 3.8 GiB RAM, and a 61 GiB disk. Keep
journald and container logs bounded and monitor free disk, memory, finalized
height, Worker progress, Backend readiness, and bundle storage. This is a
single-host testnet profile, not a high-availability setup.

Persist Node state/keystore, Worker state, Formal RPC bundle data, and Backend
state on durable storage using the paths and ownership required by the
official release. Back up chain state and identity material before upgrading.
Never prune volumes or clear a database to repair a failed sync.

## Matrix and public web gates

The resolver service and Caddy examples are in `ops/matrix/`. The Matrix
resolver URL stays out of the public network configuration until the new
homeserver, federation, Application Service, remote-key query, and independent
Ownership check all pass. Confirm the Matrix and API hostnames resolve to the
intended origin and HTTPS routes return the expected service responses before
initializing the Matrix database or changing DNS.

The Pages workflow builds on pushes and pull requests without publishing.
Publishing is a separate manual `workflow_dispatch` action on `main`, with
`publish=true`; it validates the real descriptor before enabling Pages and
deploying the uploaded static artifact.
