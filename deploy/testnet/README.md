# MiniJAM Stage-1 TestNet and Locus Backend

This deployment profile is pinned to MiniJAM `stage1-v0.2.1` and the
Locus Service artifact from commit
`359f4605f6a8ff2dc96fbbbd9be608e8babce51c`. Image digests, release commit,
chain-spec checksums, and Backend digest are recorded in
[`releases.lock`](../../releases.lock).

## Runtime shape

Use the official `deploy/stage1/compose.compact.yml` from the exact
MiniJAM release for the split Node, Worker, and Formal RPC roles. Do not
substitute the aggregate `--dev` profile. Confirm the release compose file
uses the three image digests in `releases.lock`, `--chain=testnet`, and the
private Docker network `minijam-testnet-chain` before starting any role.

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
3. Match existing protected key files to their roles and the release's public
   identities. Do not create replacement development keys or put secrets in
   this repository or a shell command.
4. Prepare persistent paths and confirm the release's actual container UID,
   secret-file mounts, and data directories. Do not assume a Compose secret
   mode declaration changes the host file's permissions.
5. Start the official MiniJAM Node first. Check genesis and local RPC, then
   confirm both best and finalized heights advance. Start Formal RPC and the
   registered Worker only after the Node is correct; verify their published
   readiness paths from the pinned release.
6. Start the Backend with this overlay after the official stack has created
   `minijam-testnet-chain`. Verify its readiness at
   `http://127.0.0.1:8090/readinessz` and confirm the chain identity before
   deploying the Locus Service.
7. Validate the existing `dist/` artifact using
   `python3 scripts/verify-prebuilt-dist.py`. Do not compile or rewrite it.
   Use the pinned JamScript CLI's direct artifact deployment path only after
   confirming its signer configuration and compatibility with the recorded
   non-canonical toolchain provenance.
8. Generate `web/public/deployments/testnet.json` only from finalized on-chain
   deployment evidence. The Pages workflow refuses publication when this
   descriptor does not match the checked artifact metadata and locked versions.

Example invocation after the release files, secret mounts, and identity checks
are ready:

```sh
docker compose -p minijam-stage1 \
  -f /opt/minijam/releases/stage1-v0.2.1/deploy/stage1/compose.compact.yml up -d
docker compose -p locus-stage1 \
  -f deploy/testnet/backend.compose.yaml up -d
```

Before using the command, confirm the official compose service names and
network name in the downloaded release file. The Backend overlay expects
`node`, `formal-rpc`, and `minijam-testnet-chain`. No host firewall or
cloud firewall rules are changed by these Compose files.

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
