# JamScript dogfood boundary

Locus is a consumer of the published JamScript platform. Its responsibility is
the asset ledger and application UX; the platform owns action encoding,
Ownership authentication, ControlClaims, managed-state proofs, transaction
submission, and Work finalization.

When an Ownership feature is unavailable in the published CLI or client, the
correct response is a platform release. Locus must not copy SignedActionV2,
EIP-712, Matrix cross-signing, or Ownership codecs into the service or browser
application.
