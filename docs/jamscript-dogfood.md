# JamScript dogfood boundary

Locus is a consumer of the JamScript platform. JamScript authenticates the
cryptographic controller, executes the service deterministically, and exposes
the pure Matrix M→S→D proof codec/verifier. Locus owns application identity
authorization and the asset ledger in the same managed state root.

An authenticated `ctx.controller` is not automatically authorized for every
subject. Locus checks its local `controllerGrants` state; direct ownership
(`subject === controller`) needs no registration. The Locus SDK injects the
stable `subject` into business action payloads and does not use `actAs`.

MiniJAM and Jambda remain generic execution layers. Locus must not require a
network-scoped Ownership Control system service, HostCall 28, or an external
ControlClaim witness. When a JamScript language/runtime feature is unavailable
in the published release, the correct response is a JamScript release; the
consumer should not copy SignedActionV2, Ownership, Matrix codecs, or crypto
verification into the service or browser application.
