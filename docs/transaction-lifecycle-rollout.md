# Transaction lifecycle release checklist

The lifecycle changes require a matching JamScript Client and Backend. The
values under `[jamscript]`, `[jamscript_backend]`, and `[jamscript_client]` in
`releases.lock` are the historical source pins in this Locus branch (RC8/RC4),
not a live deployment record. The operator confirmed the current server uses
Backend RC10 and its previous server used RC9. `[transaction_lifecycle_upgrade]`
records the next required versions for this change. Do not treat the pending
versions as published artifacts.

## Required artifacts

| Component | Required version | State in this change |
|---|---|---|
| `@jamscript/client` | `0.1.0-rc.5` | Source builds and local tarball is checked; publish is pending |
| JamScript Backend | `backend-v0.1.0-rc.11` | Source changes are under validation; image and digest are pending |
| MiniJAM | Existing Stage-1 interface | No protocol change is required |

The Backend must report `transactionLifecycleVersion: 1`,
`bestChainTracking: true`, and `strictFinalizedReceipts: true` from
`jamscript_getCapabilitiesV1`. It must bind Best inclusion to the predicted
state root and return action receipts only after checking the finalized
managed-state root. `durableTransactionLookup` is explicitly false: after a
Backend restart, an old transaction ID may be unavailable. Locus therefore
restores only records with the saved transaction ID and action hash, and never
automatically submits a replacement for an unknown result.

## Release sequence

1. Finish JamScript formatting, Client tests, Backend tests, and Clippy. Build
   the Backend image from the reviewed source and publish it under a new
   immutable tag/digest. Verify the capability response against that exact
   image before updating deployment descriptors.
2. Publish `@jamscript/client@0.1.0-rc.5`. Compare the published tarball SHA-512
   with the reviewed artifact and confirm the lifecycle methods exist in its
   ESM output and declaration files.
3. Install that published Client in both Locus consumers with clean lockfile
   installs. Run the root checks/tests and production web build. The
   `assert-published-client.mjs` gate checks the installed package rather than
   source files.
4. Update the deployed release lock with the actual Backend image digest and
   published npm package, then deploy the Locus frontend. This is a frontend
   and Backend rollout; it does not require rebuilding the Locus Service blob,
   changing its Service ID, or clearing user state.
5. Confirm the live Backend capability response before enabling writes. Keep
   the existing pending operation records readable through the rollout and
   verify one controlled non-production transaction through Best and
   finalized receipt.

Do not update a deployment lock with a guessed digest or claim a version is
live based on `package.json`. The pre-publication package lock records the
expected registry URL and this locally verified tarball integrity:
`sha512-aUS3tfOnqr61ym7/V8n59S2bqrRZOIw+dNWwSFGjmXkcR9BP/1SY6b0kdUPRFi2pONuSMYZeydiN1a46P4NjFQ==`.
Clean consumer installation from the public registry becomes verifiable only
after publication.

## Recovery and rollback

- Keep the lifecycle Backend and the `locus.pending-operations.v1` browser
  records when the frontend is rolled back. Never clear an unresolved record
  to enable another payment or authorization attempt.
- If returning to the old frontend, disable write actions until the lifecycle
  Client/Backend pair is restored. The old Client does not enforce the strict
  receipt contract.
- An operation with no transaction ID after an ambiguous submission remains
  unresolved. Check the Backend/chain manually; do not create a new signed
  operation based only on matching amount, recipient, or nonce.
- Real reorganization handling is not certified by local simulation. Validate
  it on a controlled non-production chain before relying on the automatic
  Best → reorg → Best recovery path.
