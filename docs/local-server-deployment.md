# Locus Local server deployment

This procedure deploys the locked Locus release set to a fresh Ubuntu host as a
MiniJAM Local / Development network. The machine size affects build speed only;
it is not a deployment gate. The checked-in Compose file pins both runtime
images by digest. Do not use the Stage-1 Testnet Compose file for Local.

## Runtime layout

- MiniJAM chain database: `/var/lib/locus/minijam`
- JamScript backend database and artifacts: `/var/lib/locus/backend`
- Static production site: `/var/www/locus`
- Caddy site configuration: `/etc/caddy/Caddyfile` (source template:
  `deploy/local/Caddyfile`)
- Runtime definition: `deploy/local/compose.yaml`
- Network descriptor: `web/public/deployments/local.json`
- Non-secret deployment manifest: `deploy/local/deployment-manifest.json`

The two state directories must be on persistent root storage, not swap or an
ephemeral temporary disk. The released MiniJAM and backend images run as UID
10001; prepare their bind mounts with the matching ownership before first start:

```sh
sudo install -d -o 10001 -g 10001 -m 0750 /var/lib/locus/minijam
sudo install -d -o 10001 -g 999 -m 0750 /var/lib/locus/backend
```

## Start and verify the Local chain

Install Docker Engine and Compose v2, clone this repository, then run:

```sh
sudo docker compose -f deploy/local/compose.yaml up -d minijam
```

Wait for all three local endpoints. Formal RPC and worker readiness are HTTP
checks; the node endpoint is JSON-RPC over HTTP/WebSocket on loopback:

```sh
curl -fsS http://127.0.0.1:8080/health/ready
curl -fsS http://127.0.0.1:8082/health/ready
curl -fsS -H 'content-type: application/json' \
  --data '{"jsonrpc":"2.0","id":1,"method":"system_health","params":[]}' \
  http://127.0.0.1:9944
curl -fsS -H 'content-type: application/json' \
  --data '{"jsonrpc":"2.0","id":2,"method":"chain_getBlockHash","params":[0]}' \
  http://127.0.0.1:9944
```

Check `chain_getHeader`, `chain_getFinalizedHead`, and the header at that
finalized hash twice with a short interval. Both best and finalized heights
must increase before starting the backend.

## Start the backend and deploy Locus

After the Local chain is producing and finalizing blocks:

```sh
sudo docker compose -f deploy/local/compose.yaml up -d backend
curl -fsS http://127.0.0.1:8090/readinessz
```

Install the JamScript CLI version in `releases.lock`, then install dependencies
with the checked-in npm lockfiles. Build and check the service before deploying
the verified artifact:

```sh
npm ci
npm --prefix web ci
jams toolchain verify
npm run check
npm run build
jams deploy . --network local --artifact ./dist --json
```

`jams deploy` verifies the artifact and chain identity and records successful
finalized deployment evidence under `.jamscript/deployments/`. Do not retry an
operation reported as `DEPLOYMENT_OUTCOME_UNKNOWN` until its result has been
reconciled against the chain.

Only after deployment and the backend service query both succeed, regenerate
the canonical descriptor from the new chain values:

```sh
LOCUS_COMMIT="$(git rev-parse HEAD)" \
JAMSCRIPT_VERSION=v0.1.0-rc.8 \
JAMSCRIPT_BACKEND_VERSION=backend-v0.1.0-rc.8 \
MINIJAM_VERSION=stage1-v0.2.0 \
node scripts/write-web-deployment.mjs \
  --network local --backend /rpc --service-id "$LOCUS_SERVICE_ID" \
  --genesis-hash "$GENESIS_HASH" --network-domain "$GENESIS_HASH"
```

Set `LOCUS_SERVICE_ID` and `GENESIS_HASH` from the verified deployment output
and the new node's `chain_getBlockHash([0])`. Never copy an old chain's
Service ID or descriptor. The backend starts with an empty registry; the newly
deployed Service should appear after its finalized registration is indexed.

## Build and serve the web app

The Local network label is `MiniJAM Local / Development`. Build the production
frontend after writing the verified deployment descriptor:

```sh
npm run test
npm run build:web
sudo install -d -o root -g caddy -m 0755 /var/www/locus
sudo cp -a web/dist/. /var/www/locus/
sudo cp deploy/local/Caddyfile /etc/caddy/Caddyfile
sudo caddy validate --config /etc/caddy/Caddyfile
sudo systemctl reload caddy
```

Caddy serves static files, forwards `/rpc` to the backend, and exposes the
Matrix resolver at `/matrix-resolver`. The separate `matrix.minijam.xyz` host
serves Matrix federation and signing keys only; client APIs stay private.
Compose publishes node, Formal RPC, Worker health, backend, and resolver
dependencies on host loopback; never change those mappings to `0.0.0.0`. Keep
the host firewall limited to SSH, HTTP, and HTTPS. Caddy obtains and renews
HTTPS certificates after public DNS and inbound ports 80/443 reach this host.
For Cloudflare, use Full (strict) once the origin certificates are ready.

## Optional integrations and recovery

Matrix recipient resolution is enabled for the Local network after the
homeserver identity, HTTPS federation, restricted application-service token,
remote key query, independently verified account ownership, and resolver
checks pass. Keep the homeserver database and resolver pin state on persistent
storage. Missing Matrix credentials skip Matrix SSO without affecting the core
Local deployment. Asset or pool initialization that needs a Treasury signer
is a separate operation; never generate or commit a substitute key.

`npm run test` uses empty on-chain state and does not seed demo data. Empty
Assets, Swap, Liquidity, and Activity views are expected before authorized
assets and pools are initialized.

Do not remove `/var/lib/locus/minijam` or `/var/lib/locus/backend` during routine
updates. Docker image/cache cleanup must not prune volumes. After any update,
confirm the Local genesis and Service descriptor still match, and test service
health after reboot. Back up these state directories separately before
rebuilding the host; this runbook does not treat ephemeral storage as a backup.
