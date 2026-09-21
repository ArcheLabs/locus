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
Ownership(ED25519_KEY, M) and a verified device key as controller D. The M→S→D
evidence is checked by JamScript's deterministic
verifyMatrixCrossSigning primitive during bootstrapMatrixController. The outer
SignedActionV2 proves possession of D, so the proof payload does not duplicate
a controller signature.

EVM addresses use Ownership(SECP256K1_KECCAK20, H160), Polkadot SS58 values
decode to Ownership(MULTICRYPTO_ACCOUNT32, AccountId32), and Solana public
keys use Ownership(ED25519_KEY, AccountId32).

No Locus code implements SignedActionV2 or network-wide controller state.
Matrix resolver lookup remains an authenticated MXID → master-key service and
is independent of controller authorization.
