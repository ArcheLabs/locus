# JamScript dogfood notes

Locus stays on the pinned JamScript revision and does not patch the sibling
JamScript repository. The following are the limitations relevant to v0.1.

| Observed | Impact on Locus | Workaround used | JamScript change? | Status |
| --- | --- | --- | --- | --- |
| ScriptC service modules are not a portable local import boundary | The service must be one source unit | Keep all service code in `src/service.ts` | Eventually, if module imports become stable | Non-blocking |
| ScriptC executable `string(N)` support is not available in the current M2 profile | Metadata cannot use executable strings | Use `bytes(64)` and `bytes(16)`; SDK performs UTF-8 encode/decode | Improve executable string support later | Non-blocking |
| The generated M2 decoder hoists bounded-byte reads ahead of earlier fixed fields in a record | Spec-correct records containing `bytes(N)` cannot yet be trusted for PVM wire execution | Keep the protocol records spec-correct, preserve the generated reproducer, and block the affected PVM/E2E gate pending a JamScript fix | Preserve record field order while decoding fields sequentially | Blocking for real service execution |
| Service action bodies have unit output in the current service surface | Actions do not return application values | Read canonical state through queries | Add stable action return support if needed | Non-blocking |
| v0.1 runtime authentication exposes sr25519 wallet sender | Only sr25519 owner scheme can be executable | Treat `ctx.sender` as `JamWalletSr25519ProofV1` and keep `OwnerV1.scheme` versioned | Add proof adapters for future schemes | Non-blocking |
| JamScript client distribution is a separate package/toolchain concern | Locus cannot assume a published client package | Inject the narrow `JamScriptLikeClient` adapter | Publish/document the public client distribution | Non-blocking |
| Events/logging and computed queries are not required by the current surface | Discovery uses direct state queries and registry indexes | No alternate database or event authority | Add only as a later convenience | Non-blocking |
| A numeric fatal may be surfaced by a provider as `Wire(UnsupportedVersion)` | Fatal-receipt diagnosis is external to Locus | Preserve checked numeric semantics and record provenance | Fix in provider/MiniJAM stack | Known external issue |

`PROVIDER_FATAL_RECEIPT=KNOWN_EXTERNAL_ISSUE` is not a license to report an
unexecuted E2E as passing. Build and E2E reports distinguish `PASS`, `FAIL`,
`NOT_RUN`, and `NOT_IMPLEMENTED`.
