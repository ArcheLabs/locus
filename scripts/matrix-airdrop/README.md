# Matrix Room Airdrop

This operations CLI sends a fixed amount of an existing Locus Asset from the configured Treasury Ownership to each newly seen member of a Matrix room. It uses the deployed Matrix Ownership resolver; it does not derive Matrix keys or create a separate ownership/claim system.

The tool targets the Local Locus deployment selected by `LOCUS_CURATED_DEPLOYMENT` (default: `web/public/deployments/local.json`). It submits through the existing `LocusClient.transfer()` method and marks a transfer complete only after `waitForAction()` returns an `applied` action receipt.

## Requirements

- Node.js and the repository dependencies installed. Run `npm run build` once to generate the SDK files imported by the CLI.
- An absolute backend RPC URL in `LOCUS_CURATED_BACKEND_RPC`. The checked-in Local descriptor uses the browser-relative URL `/rpc`, which a Node process cannot use directly.
- A Matrix access token for the room's homeserver, supplied for this invocation only.
- The existing Treasury key file configured with `LOCUS_TREASURY_KEY_FILE`. It must be outside the repository, owned by the current OS user, and have mode `0600`. The existing Treasury helper verifies that it matches the configured Treasury Ownership. This tool never generates or prints a key.

`LOCUS_TREASURY_KEY_FILE` is required for a live transfer. A `--dry-run` only reads memberships, resolves Ownerships, and reads Asset metadata; it never creates the Treasury signer or submits transfers.

## Credentials

Set these only in the shell used for the run. The Matrix token is used only to read `joined_members`; it is not written to the repository, state files, or logs.

```sh
export MATRIX_HOMESERVER=https://matrix.minijam.xyz
read -r -s -p 'Matrix access token: ' MATRIX_ACCESS_TOKEN
printf '\n'
export MATRIX_ACCESS_TOKEN
export LOCUS_CURATED_BACKEND_RPC='https://your-local-locus-backend.example/rpc'
export LOCUS_TREASURY_KEY_FILE=/home/azureuser/.secrets/locus-curated-issuer/op.key
```

The resolver defaults to `https://locus.minijam.xyz/matrix-resolver`. Override it with `LOCUS_MATRIX_RESOLVER_URL` or `--resolver` when using another deployed resolver. The value is the resolver base URL; `/v1/resolve` is appended automatically.

## Sync

`config.example.json` shows the corresponding values for reference. The CLI takes them as flags so the room, asset, amount, and state directory are explicit on every run.

```sh
node scripts/matrix-airdrop/index.mjs sync \
  --room '!abc123:minijam.xyz' \
  --asset 0xef2f434912aa4707dd59e740694904950c963f4d1824b36e9244d86a100dad70 \
  --amount 100000000000 \
  --dry-run
```

`--amount` is an integer in the Asset's smallest units, not a decimal display amount. The dry run lists each MXID and its resolved Ownership key, plus the display amount and total. It does not write state or submit a transfer.

Remove `--dry-run` to send. Each member is processed sequentially. Transfers are recorded under `scripts/matrix-airdrop/state/` by default; pass `--state <directory>` to use another private directory. Existing state directories must be mode `0700`; state JSON files are created as `0600`. The local state directory is git-ignored.

```sh
node scripts/matrix-airdrop/index.mjs sync --room '!abc123:minijam.xyz' --asset 0x... --amount 100000000000
```

The first sync records the current membership snapshot and queues unseen MXIDs. Later syncs process new members and retry transfers with a definitive `failed` status. A member who leaves and rejoins remains previously seen. Members absent from the latest joined-members response are marked `left` in `members.json`.

If an action has a transaction ID but no final receipt yet, it remains `pending`; the next sync checks that same transaction and never submits a replacement while its outcome is pending. If submission ended before a transaction ID was saved, it is recorded as `unknown` and is not automatically retried. Reconcile that outcome first, then explicitly acknowledge a retry for that member:

```sh
node scripts/matrix-airdrop/index.mjs sync --room '!abc123:minijam.xyz' --asset 0x... --amount 100000000000 --retry-unknown '@alice:matrix.org'
```

Only use `--retry-unknown` after checking that the original action did not apply; otherwise the recipient could be paid twice.

## Status and reset

```sh
node scripts/matrix-airdrop/index.mjs status
node scripts/matrix-airdrop/index.mjs status --state /path/to/private-state
```

`status` reads the local snapshot and reports current room members plus resolved, applied, failed, pending, and unknown outcomes. It does not need Matrix credentials or connect to the chain.

```sh
node scripts/matrix-airdrop/index.mjs reset
```

By default, `reset` removes only `transfers.json` and retains `members.json`. This preserves the new-member baseline, so a subsequent sync will not resend to previously seen members. To start over for the entire current room, use:

```sh
node scripts/matrix-airdrop/index.mjs reset --reset-all
```

Reset refuses to run while another sync holds the state lock.
If the process was forcibly killed and left a stale `.sync.lock`, confirm no sync process is active before removing that lock file manually.

## State files

- `members.json`: room membership history and first/last-seen dates.
- `transfers.json`: room/asset/amount scope and per-MXID status, canonical Locus Ownership ID, ownership key, transaction ID, and error code where applicable.
- `.sync.lock`: prevents concurrent sync/reset operations.

The files do not contain the Matrix token or Treasury private key. Do not commit the runtime state directory.
