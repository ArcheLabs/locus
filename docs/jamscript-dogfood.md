# JamScript dogfood boundary

Locus is a consumer of the JamScript platform. JamScript Core authenticates the
cryptographic controller, executes the service deterministically, and exposes
provider-neutral cryptographic primitives. The JamScript Ownership Matrix
adapter implements the Matrix M→S→D proof codec and verifier on top of those
primitives. Locus delegates proof verification to the adapter and owns
application identity authorization and the asset ledger in the same managed
state root.

An authenticated `ctx.controller` is not automatically authorized for every
subject. Locus checks its local `controllerGrants` state; direct ownership
(`subject === controller`) needs no registration. The Locus SDK injects the
stable `subject` into business action payloads and does not use `actAs`.

MiniJAM and Jambda remain generic execution layers. Locus must not require a
network-scoped Ownership Control system service, HostCall 28, or an external
ControlClaim witness. When a JamScript language/runtime feature is unavailable
in the published release, the correct response is a JamScript release; the
consumer should not copy SignedActionV2, Ownership, or provider-specific proof
verification into the service or browser application.
