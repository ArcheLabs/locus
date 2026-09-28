# Matrix recipient resolution

Locus resolves a recipient Matrix ID through a fixed local Tuwunel homeserver.
The recipient MXID is query data only; it never selects a network destination.

```text
Browser -- {userId} --> Locus resolver -- AS token --> 127.0.0.1:8008 Tuwunel
                                                        |
                                                        +-- Matrix federation --> remote homeserver
```

Tuwunel owns Matrix federation, remote server discovery, request signing,
federation caching, and remote key retrieval. The resolver only validates the
returned master cross-signing key, pins its first-seen value, and converts its
32-byte Ed25519 public key using `matrixOwnership()` and `formatLocusId()` from
the canonical Locus SDK. The resolver has no Matrix user account and does not
implement federation.

## Fixed credentials and network boundary

The resolver sends `Authorization: Bearer <as_token>` only to the fixed URL
`http://127.0.0.1:8008/_matrix/client/v3/keys/query`. It reads the token from
`MATRIX_HOMESERVER_AS_TOKEN_FILE`; the token is never a resolver environment
value, browser value, network descriptor, or response field. The configured
`MATRIX_HOMESERVER_URL` must equal `http://127.0.0.1:8008`, and redirects fail
closed. The resolver binds only to `127.0.0.1:8787`.

The browser calls `POST /matrix-resolver/v1/resolve` with only
`{"userId":"@bob:example.org"}`. The public API accepts no URL, homeserver,
token, authorization header, or alternate endpoint fields. It limits requests
to 4096 bytes. `GET /healthz` reports that resolver configuration loaded;
`GET /readyz` checks the local Tuwunel Client-Server versions endpoint without
performing federation.

## Key validation and pinning

The resolver requires the returned cross-signing object to:

- name the requested MXID in `user_id`;
- contain exactly `usage: ["master"]`;
- contain exactly one key named `ed25519:<unpadded-base64-key>`;
- use the same string for the key ID suffix and key value; and
- decode canonically to exactly 32 bytes.

Master-key signatures are optional and are not required. The first valid key is
pinned in the resolver state file. Concurrent writes are serialized and use
unique mode-0600 temporary files followed by an atomic rename. A later different
key returns HTTP 409 `MATRIX_MASTER_KEY_CHANGED`; Locus does not silently change
the recipient's Ownership. The resolver never returns the raw master key.

## Tuwunel release and configuration

The deployment template pins Tuwunel `v1.9.3` to its OCI manifest-list digest:

```text
ghcr.io/matrix-construct/tuwunel:v1.9.3@sha256:678b7f5350e06a41614444497c587da9dddf66767e4068a27480402f3c1367d0
```

The current architecture uses Matrix server name `matrix.minijam.xyz` and
Application Service sender `@locus-resolver:matrix.minijam.xyz`. A Matrix server
name is persistent identity; DNS and HTTPS delegation must be confirmed before
the first Tuwunel database is created. The committed configuration is only a
template. It is not applied to `/etc`, and no production secrets are included.

Templates:

- `ops/matrix/tuwunel.toml.example`
- `ops/matrix/locus-resolver-appservice.yaml.example`
- `ops/matrix/docker-compose.example.yml`
- `ops/matrix/Caddyfile.example`

Generate independent random `as_token` and `hs_token` values on the server.
The registration YAML contains the `as_token`; place the same value in a
separate protected file at `/etc/locus/matrix-resolver/as_token`. Keep the
registration file and token file mode 0600. The registration directory should
be restricted to the Tuwunel process; the resolver token file should be owned
by the resolver service account. Do not put either token in this repository,
the web build, deployment descriptors, or logs.

The Compose template binds only `127.0.0.1:8008` on the host and uses
`TUWUNEL_CONFIG=/etc/tuwunel/tuwunel.toml`, supported by the pinned image. Use
the `stop_grace_period` because Tuwunel may need time to finish an on-disk
database migration during shutdown.

The resolver host service template is
`ops/matrix/locus-matrix-resolver.service.example`. It requires Node.js 22.18+
for the SDK's TypeScript source import and writes pin state only under
`/var/lib/locus-matrix-resolver`.

The public Caddy site for `matrix.minijam.xyz` serves only
`/.well-known/matrix/server`, `/_matrix/federation/*`, and `/_matrix/key/*`.
All other paths return 404; in particular, `/_matrix/client/*` is not public.
Merge the resolver route into the existing Locus Caddy site without replacing
its `/rpc`, static-file, or deployment routes:

```caddyfile
handle_path /matrix-resolver/* {
    reverse_proxy 127.0.0.1:8787
}
```

## Activation gates

Do not add `matrixResolverUrl` to `web/public/locus-networks.json` until every
live gate below passes:

1. `matrix.minijam.xyz` resolves to the intended host.
2. `https://matrix.minijam.xyz/.well-known/matrix/server` returns
   `{"m.server":"matrix.minijam.xyz:443"}`.
3. The federation endpoint works over HTTPS port 443 and the server signing
   key is publicly available.
4. The AppService token returns the expected sender from local
   `/_matrix/client/v3/account/whoami`.
5. The same AppService token can query a known remote, cross-signing-enabled
   Matrix user through local `/_matrix/client/v3/keys/query`.
6. A controlled remote Matrix account resolves through federation, and its
   master key and resulting Locus Ownership match an independently authenticated
   Matrix session.
7. Resolver redirect, fixed-target, pinning, and browser no-token regression
   tests pass.

After the AS registration exists, the protected live probe is
`scripts/probe-matrix-appservice.mjs`. Run it on the Tuwunel host with
`MATRIX_HOMESERVER_AS_TOKEN_FILE` pointing to the protected token file and
`MATRIX_TEST_MXID` set to a controlled remote account. It prints only pass/fail
markers and never prints the token or returned key.

If the DNS, protected token file, or real remote Matrix test account is missing,
leave `matrixResolverUrl` unset and do not deploy a frontend that advertises
Matrix recipient resolution. No ordinary Matrix access token is an acceptable
fallback.

## Verification

```bash
node --test apps/matrix-resolver/test.mjs
node --test tests/web-matrix-recipient.test.mjs
npm test
npm --prefix web run build
npm run check
npm run build
git diff --check
```

`npm run check` and `npm run build` also validate/build the Locus Service; this
recipient-resolution change does not modify the Service, ABI, Backend,
deployment descriptor, JamScript PVM, or MiniJAM.

Upstream implementation references: [Tuwunel v1.9.3 Docker guide](https://github.com/matrix-construct/tuwunel/blob/v1.9.3/docs/deploying/docker.md), [Tuwunel v1.9.3 Appservice guide](https://github.com/matrix-construct/tuwunel/blob/v1.9.3/docs/appservices.md), and the [Matrix Application Service specification](https://spec.matrix.org/v1.17/application-service-api/).

## Rollback

The immediate product rollback is to remove `matrixResolverUrl` from the
network configuration or restore the previous static frontend. This disables
Matrix recipient resolution. Resolver pin state and Tuwunel data should be
preserved during an ordinary frontend rollback.
