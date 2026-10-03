# JamScript RC12 / Client RC7 Locus rollout

The current frontend and service source target JamScript RC12 and Client RC7.
The checked-in `dist/` now contains a canonical RC12 candidate, while active
deployment descriptors still identify older immutable Services. Changing the
frontend or Backend does not replace their guest code. The `[jamscript]`,
`[jamscript_backend]`, and `[jamscript_client]` entries in `releases.lock` describe that historical
baseline. `[transaction_lifecycle_upgrade]` records the new target pair and
verified Backend image digest.

## Required artifacts

| Component | Required version | State |
|---|---|---|
| JamScript CLI/toolchain | `v0.1.0-rc.12` | Published; clean isolated installer and toolchain verification passed |
| `@jamscript/client` | `0.1.0-rc.7` | Published; installed in both consumers with registry integrity |
| JamScript Backend | `backend-v0.1.0-rc.12` | Published; GHCR digest recorded; live capability check remains before rollout |
| MiniJAM | Existing Stage-1 interface | No protocol change is required |

Locus pins a 1 MiB initial guest heap and a 16 MiB maximum in `jamscript.toml`.
The build checks `build.json` to ensure the produced artifact carries these
budgets. JamScript RC12's new allocator only affects a Service after rebuilding
and deploying its guest artifact. Existing immutable Services continue using
their previous allocator until an application migration or replacement Service
is carried out.

The Backend must report `transactionLifecycleVersion: 1`,
`bestChainTracking: true`, and `strictFinalizedReceipts: true` from
`jamscript_getCapabilitiesV1`. It must bind Best inclusion to the predicted
state root and return action receipts only after checking the finalized
managed-state root. `durableTransactionLookup` is explicitly false: after a
Backend restart, an old transaction ID may be unavailable. Locus therefore
restores only records with the saved transaction ID and action hash, and never
automatically submits a replacement for an unknown result.

Client RC7 preserves structured Backend errors. Locus turns a confirmed local
preflight heap-limit error into a clear message and labels it not submitted.
Formal terminal guest traps may still arrive as generic `Panic`; the current
Formal status interface does not provide a structured guest fault to the
Backend or SDK. Locus must not infer an OOM cause from that panic or advise a
retry until the transaction status is known.

## Release sequence

1. Install the RC12 Backend image by the recorded digest, then verify the live
   `jamscript_getCapabilitiesV1` response reports
   `transactionLifecycleVersion: 1`, `bestChainTracking: true`, and
   `strictFinalizedReceipts: true` before enabling writes.
2. The checked-in candidate was built with JamScript RC12, a 1 MiB initial
   heap, and a 16 MiB maximum; its code hash is recorded in `releases.lock`.
   Verify the artifact hash, ABI, and service descriptor, then run the real PVM
   multi-action and over-budget checks plus a controlled MiniJAM E2E.
3. Install `@jamscript/client@0.1.0-rc.7` in both consumers with clean lockfile
   installs. Run the root checks/tests and production web build. The
   `assert-published-client.mjs` gate checks that the installed package unwraps
   structured no-submit guest faults as well as exposing lifecycle APIs.
4. Plan deployment of the new immutable Service separately. The checked-in
   candidate does not match the active descriptors, so the Pages publication
   gate will reject publication until finalized deployment evidence is
   recorded. Preserve balances, grants, pools, pending transaction records,
   and ownership nonces through the application's migration plan; do not point
   the frontend descriptor at a newly built code hash until that Service is
   registered and its state is ready. This repository change does not deploy
   or migrate a live Service.
5. After the service/backend/frontend rollout, verify a controlled
   non-production transaction at Best and at finalized receipt.

The Backend image digest recorded for RC12 is
`sha256:40fc14f5a10d8f22803340da5fd7ce585356dfb9072b3d5a80ba565c0ddb83cf`.
It was read from the published GHCR manifest, not inferred from the tag.
Neither this lock entry nor the package versions indicate that the live Backend,
frontend, or immutable Service has been upgraded; the capability check and
service migration are still deployment steps.

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
