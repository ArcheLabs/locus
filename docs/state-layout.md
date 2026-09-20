# Managed state layout v0.2

| State | Key | Value |
| --- | --- | --- |
| `locus.asset.v2` | `AssetId` | `AssetV2` |
| `locus.asset-count.v2` | unit | `u64` |
| `locus.asset-index.v2` | `u64` | `AssetId` |
| `locus.balance.v2` | `(AssetId, ownershipKey)` | `u128` |
| `locus.allowance.v2` | `(AssetId, ownerKey, spenderKey)` | `u128` |

The key bytes are produced by JamScript's canonical `ownershipKey(owner)`
primitive. Locus does not define a replacement codec.
