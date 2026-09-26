# MSC4108 feasibility for Locus

Status checked 2026-09-26.

## Decision

Do not implement MSC4108 in the current browser authentication flow. Keep OAuth
login followed by an outgoing own-user SAS verification request from the new
Locus device.

MSC4108 is the right direction to investigate for a later QR-based device
login, but the current application does not have a production-ready support
boundary. The current MSC4108 proposal remains open. Its proposal page describes
the 2025 revision as feature complete and under review, with no production
implementations; its proof-of-concept support is split across experimental
homeserver and SDK/client feature branches. It also depends on related
proposals for rendezvous and device authorization.

The Rust SDK has a `LoginWithQrCodeBuilder` API, but Locus currently uses the
Matrix JavaScript SDK for OAuth and the standalone
`@matrix-org/matrix-sdk-crypto-wasm` package for device crypto. The installed
crypto WASM API exposes own-user SAS verification, but not the MSC4108 QR login
and rendezvous flow. Mixing the Rust SDK QR-login boundary into this browser
client would require an additional supported browser integration and
homeserver capability negotiation that are not present here.

## Revisit conditions

Reconsider MSC4108 when the current proposal revision is stable and the
homeserver plus the browser SDK used by Locus have released interoperable,
documented implementations. The client must discover support from the
homeserver, use the standardized rendezvous negotiation, and have an end-to-end
test with the intended Element X versions before enabling a QR handoff.

MSC4108 QR login is distinct from launching Element to accept a SAS request.
Locus must not invent an `element://` URL or reuse an onboarding URL as a
verification handoff.

## Element mobile launch links

The reviewed Element documentation describes
`https://mobile.element.io/<app>/?...` as an onboarding deep link: it opens the
mobile app and supplies account-provider and login-hint configuration. It is
not documented as a general link into an existing session or as a way to
target a Matrix verification request. Locus therefore removes that link from
the verification flow and does not add a replacement launch button. The user
switches to Element themselves; the outgoing SAS request is delivered to
their existing devices.

Element's user guide describes verifying an additional device from the existing
Element app, but the reviewed material does not document a stable URL scheme or
universal link that opens a particular existing session at its verification
screen. Revisit a launch button only if Element documents and supports such a
link for both mobile platforms.

## Sources

- [MSC4108 proposal and implementation status](https://github.com/matrix-org/matrix-spec-proposals/pull/4108)
- [Matrix Rust SDK `LoginWithQrCodeBuilder`](https://matrix-org.github.io/matrix-rust-sdk/matrix_sdk/authentication/oauth/struct.LoginWithQrCodeBuilder.html)
- [Element mobile client provisioning](https://ems-docs.element.io/books/element-server-suite-pro/page/mobile-client-provisioning)
- [Element user guide: verify an additional device](https://static.element.io/pdfs/element-user-guide.pdf)
