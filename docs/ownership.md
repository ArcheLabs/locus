# JamScript Ownership integration

Locus keeps stable asset identity and controller authorization in the same
managed Service state root:

    SignedActionV2
      ↓
    JamScript verifies the cryptographic controller D
      ↓
    ctx.controller = D
      ↓
    Locus Identity layer
      ↓
    requireController(subject M, D)
      ↓
    Locus Asset layer

subject is the stable Ownership that owns assets and balances. controller is the
Ownership that signed the action. Locus permits a direct owner
(subject == controller) without registration. Delegated control is represented
by locus.controller-grant.v1; a revoked pair is final in v1.

Matrix uses the cross-signing master key as the subject
Ownership(ED25519_KEY, M) and a verified device key as controller D. The
JamScript Ownership Matrix adapter checks M→S→D evidence using provider-neutral
deterministic JamScript cryptographic primitives during
authorizeMatrixController. Each verified device controller is authorized
independently for its exact (subject, controller) pair, so a Matrix Ownership
can have any number of active device controllers without approval from an
earlier device. JamScript Core does not implement Matrix-specific
verification, and Locus delegates proof verification to the adapter. The outer
SignedActionV2 proves possession of D, so the proof payload does not duplicate
a controller signature.

Matrix device deletion or logout does not automatically revoke the matching
Locus controller grant. Locus grants persist until an active controller calls
`revokeController`; Matrix revocation synchronization is a separate future
protocol feature.

EVM addresses use Ownership(SECP256K1_KECCAK20, H160), Polkadot SS58 values
decode to Ownership(MULTICRYPTO_ACCOUNT32, AccountId32), and Solana public
keys use Ownership(ED25519_KEY, AccountId32).

No Locus code implements SignedActionV2 or network-wide controller state.
Matrix resolver lookup remains an authenticated MXID → master-key service and
is independent of controller authorization.
