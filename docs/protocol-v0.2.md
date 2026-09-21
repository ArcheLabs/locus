# Locus protocol v0.2

## Ownership and authorization

Ownership is the stable asset subject. JamScript authenticates the cryptographic
controller in SignedActionV2 and exposes it as ctx.controller. Locus then
determines which subject that controller may operate from local identity state.
The Locus identity state and asset state share the same managed Service root.

Direct actions use subject == controller and need no registration. Delegated
actions require an active (subject, controller) entry in
locus.controller-grant.v1. Grants do not transitively delegate, and a revoked
pair cannot be re-added in v1.

The action surface is:

    bootstrapMatrixController(subject, proof)
    addController(subject, controller)
    revokeController(subject, controller)
    createAsset(subject, assetId, name, symbol, decimals, initialSupply)
    transfer(subject, assetId, to, amount)
    approve(subject, assetId, spender, amount)
    transferFrom(subject, assetId, from, to, amount)
    mint(subject, assetId, to, amount)
    burn(subject, assetId, amount)

The SDK supplies subject from an OwnershipSession; application callers do not
repeat it manually. Locus does not use the SignedActionV2 act_as field.

Matrix bootstrap accepts only an Ed25519 subject and controller, verifies the
M→S→D proof, sets matrixBootstrapUsed[subject] permanently, and creates the
first controller grant. Once the tombstone is set, Matrix bootstrap cannot be
replayed even after revocation. A new Matrix master key is a new Ownership and
may bootstrap independently; old assets are not migrated automatically.

There is no IdentityId, OwnerV1, rotateOwner, or wallet-authenticated
compatibility action in v0.2.

## State keys

The public API uses Ownership values. Managed-state maps use JamScript's
canonical ownershipKey(owner) primitive. Balance keys are
(assetId, ownerKey), allowance keys are (assetId, ownerKey, spenderKey),
controller grant keys are (subjectKey, controllerKey), and Matrix bootstrap
keys are subjectKey.

An Ownership recipient may be entirely new to Locus. Sending does not require
recipient registration.

## Invariants

- total supply equals the sum of all balances for an asset;
- transfers and mints use checked u128 arithmetic;
- transferFrom decreases the allowance by the transferred amount;
- issuer comparison is canonical subject Ownership comparison;
- controller grants are checked in the same state transition as asset changes;
- a failed action does not mutate ledger, grant, or bootstrap state.
