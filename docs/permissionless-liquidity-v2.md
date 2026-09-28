# Permissionless Liquidity v2

Locus v2 replaces the v1 single-manager pool with a permissionless pool and
non-transferable per-Ownership liquidity shares. Any authorized Ownership may
create a pool or add liquidity. An Ownership may remove only its own shares.
The first contributor chooses the initial reserve ratio and supplies the
initial capital; it gains no administrative right.

## Pool and share state

Each pool stores its canonical asset pair, two reserves, and `totalShares`.
A separate Service map stores each `(pool, Ownership)` share balance. A second
index lets the SDK enumerate an Ownership's positions without scanning every
pool. Closing a position leaves its index entry in place; position queries
filter zero-share entries, so a later contribution does not append a duplicate.

Initial shares are `floor(sqrt(amount0 * amount1))`. The Service uses bounded
integer arithmetic only. On an existing pool, an add action takes maximum
amounts and a `minShares` bound. The Service computes the share amount and the
proportional amounts it will actually consume; unused maximum amounts remain
in the contributor's balance. A remove action burns a requested number of the
caller’s own shares and enforces `minAmountA` and `minAmountB`. The last LP
receives the complete remaining reserves, including rounding dust.

Shares are internal accounting units. They are not assets, transferable LP
tokens, or LP NFTs. There is no share transfer, approval, fee claim, separate
fee vault, APR/APY, USD TVL, or impermanent-loss estimate. The 0.30% swap fee
remains in pool reserves and therefore contributes to each position's current
underlying amount. Swaps do not change shares.

A pool whose last LP exits remains on-chain with zero reserves and zero shares.
Any Ownership can initialize it again with a new starting rate. Half-empty or
inconsistent share/reserve states fail with a state invariant error.

## Product behavior

Liquidity is a normal navigation page for all users. It shows the connected
Ownership's active positions and the current Service's pools. New positions can
use any two distinct assets in the Service. Featured pairs are suggestions
only; missing or invalid featured-pair configuration does not disable the
page. Pool existence and reserves are read from Service state, never inferred
from presentation configuration.

The initial deposit establishes the pool's starting rate; Locus does not use an
external market oracle. Pool rates are reserve-derived. Position amounts are
proportional estimates from current reserves. Liquidity operations apply a
0.5% slippage bound by default. Once a transaction ID exists, the Web app saves
it by network, Service, and Ownership and offers status checking instead of
resubmitting the action automatically.

## Compatibility and deployment

Permissionless Liquidity v2 changes the Service state layout and action/query
ABI. A v1 Service cannot be upgraded in place and its state is not inherited by
a new immutable Service. Deployment must use a separate v2 candidate and must
not change the production descriptor until candidate validation is complete.
Existing production and v1 candidate Services remain preserved. Any Local
asset restoration is an explicit candidate bootstrap; arbitrary user balances
cannot be migrated because the v1 query surface does not enumerate all balance
owners. Existing v1 pools must be recorded and reseeded by their actual
liquidity providers; their manager reserves must not be converted into shares
without new capital.
