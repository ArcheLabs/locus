# Locus

Create, send, and swap assets on MiniJAM.

[Open Locus →](https://locus.minijam.xyz) · [JamScript](https://github.com/ArcheLabs/JamScript)

Locus is a multi-asset service built with JamScript. Assets belong directly to
cryptographic `Ownership` identities, with support for EVM, Polkadot, Solana,
and Matrix accounts.

## ✨ Features

- Create assets, transfer balances, and manage allowances.
- Swap assets and provide liquidity through constant-product pools.
- Send to wallet addresses, Matrix IDs, or canonical `locus:` identifiers.

## ⚡ Quick start

```bash
git clone https://github.com/ArcheLabs/locus.git
cd locus
npm ci
npm --prefix web ci
npm run dev
```

Open [localhost:5173](http://localhost:5173). The web client connects to the
configured Stage-1 TestNet by default.

For Service development, install the JamScript version pinned in
[`releases.lock`](releases.lock) and follow the
[development guide](docs/consumer-development.md).

## 📚 Documentation

- [Frontend and network configuration](docs/frontend.md)
- [Ownership and account authorization](docs/ownership.md)
- [Matrix recipient resolution](docs/matrix-recipient-resolution.md)
- [TestNet deployment](deploy/testnet/README.md)

## ⚠️ TestNet preview

Locus is experimental. Curated tokens are test assets; demo equities provide
no ownership, dividend, voting, or redemption rights.

## 📄 License

[Apache-2.0](LICENSE)
