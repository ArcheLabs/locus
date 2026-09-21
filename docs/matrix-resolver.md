# Matrix recipient resolver

The Matrix recipient resolver is an independent service. It owns the
homeserver access token and returns the Matrix cross-signing master key as a
canonical Locus Ownership value. Browser clients never query another user's
Matrix keys anonymously.

Run it with:

```bash
MATRIX_RESOLVER_ACCESS_TOKEN='service-account-token' \
MATRIX_RESOLVER_STATE=/var/lib/locus-matrix-resolver/state.json \
npm run matrix-resolver
```

The service exposes `POST /v1/resolve` with `{ "userId": "@bob:example.org" }`
and `GET /healthz`. It keeps a small TOFU record of each resolved master key;
if the key changes, it returns `409 MATRIX_MASTER_KEY_CHANGED` and does not
silently replace the record. The token and state file must be supplied by the
operator and are not part of the repository or the web bundle.
