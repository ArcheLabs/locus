# Managed state layout v0.2

| State | Key | Value |
| --- | --- | --- |
| locus.asset.v2 | AssetId | AssetV2 |
| locus.asset-count.v2 | unit | u64 |
| locus.asset-index.v2 | u64 | AssetId |
| locus.balance.v2 | (AssetId, ownershipKey) | u128 |
| locus.allowance.v2 | (AssetId, ownerKey, spenderKey) | u128 |
| locus.controller-grant.v1 | (subjectKey, controllerKey) | u8 |
| locus.matrix-bootstrap.v1 | subjectKey | u8 |

A controller grant value of 1 is active and 0 is revoked. Missing means the pair
has never been granted. A Matrix bootstrap value of 1 is a permanent tombstone;
missing means the subject has never bootstrapped.

The key bytes are produced by JamScript's canonical ownershipKey(owner)
primitive. Locus does not define a replacement codec. Asset v2 names and
balance/allowance keys remain unchanged by the identity addition.
