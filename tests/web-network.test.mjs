import assert from "node:assert/strict";
import fs from "node:fs/promises";
import test from "node:test";
import { formatUnits, parseUnits, evmOwnership, polkadotOwnership, solanaOwnership, formatLocusId, parseLocusId } from "../dist/sdk/index.js";
import { encodeAddress } from "@polkadot/util-crypto";
import { selectNetwork } from "../web/src/network/selection.ts";
import { queryMatrixKeys } from "../web/src/matrix/MatrixKeysQuery.ts";
import { beginMatrixOAuth, beginMatrixSso, commitMatrixDeviceId, commitMatrixSessionAfterCryptoSetup, completeMatrixAuthCallback, discoverMatrixAuthCapabilities, discoverMatrixAuthMetadata, matrixDeviceId, persistMatrixSession, refreshMatrixOAuthToken, revokeMatrixOAuthSession } from "../web/src/matrix/MatrixOAuth.ts";
import { DEFAULT_MATRIX_PROVIDER, resolveMatrixServer } from "../web/src/matrix/MatrixProvider.ts";
import { authenticateMatrixPassword } from "../web/src/matrix/MatrixPasswordLogin.ts";
import { describeMatrixCause, matrixControllerReceiptFailure, matrixCryptoStageFailure } from "../web/src/matrix/MatrixErrors.ts";
import { createHash } from "node:crypto";
import { resolveLocusMode, buildLocusMode } from "../web/src/network/mode.ts";
import { parseThemePreference, resolveTheme, THEME_STORAGE_KEY } from "../web/src/theme/theme.ts";
import { EvmSessionBridge } from "../web/src/session/EvmSessionBridge.ts";
import { connectPolkadotAccount, polkadotAccountOptions, requirePolkadotAccount, switchPolkadotSession } from "../web/src/session/polkadotSession.ts";
import { clearPersistedWalletSession, persistWalletSession, WALLET_SESSION_KEY } from "../web/src/session/sessionPersistence.ts";
import { assetBalanceQueryKey, assetIdsQueryKey, assetMetadataQueryKey } from "../web/src/locus/assetQueries.ts";
import { attachAssetBalances, keepAssetRowsForScope } from "../web/src/locus/assetCache.ts";

function matrixB64(bytes) {
  return Buffer.from(bytes).toString("base64url");
}

test("network selection prefers URL, then storage, env, config, and local", () => {
  assert.equal(selectNetwork("testnet", "local", "local", "local"), "testnet");
  assert.equal(selectNetwork(null, "testnet", "local", "local"), "testnet");
  assert.equal(selectNetwork(null, null, "testnet", "local"), "testnet");
  assert.equal(selectNetwork(null, null, null, "testnet"), "testnet");
  assert.equal(selectNetwork("invalid", "invalid", "invalid", "local"), "local");
});

test("Network Mode is the default and Demo Mode is an explicit dev-only choice", () => {
  assert.equal(resolveLocusMode(undefined), "network");
  assert.equal(resolveLocusMode("network"), "network");
  assert.equal(resolveLocusMode("demo"), "demo");
  assert.equal(buildLocusMode("demo", "build"), "network");
  assert.equal(buildLocusMode("demo", "serve"), "demo");
});

test("theme preference persists as System, Light, or Dark and resolves against system preference", async () => {
  assert.equal(THEME_STORAGE_KEY, "locus.theme.v1");
  assert.equal(parseThemePreference(null), "system");
  assert.equal(parseThemePreference("invalid"), "system");
  assert.equal(resolveTheme("system", true), "dark");
  assert.equal(resolveTheme("system", false), "light");
  assert.equal(resolveTheme("light", true), "light");
  assert.equal(resolveTheme("dark", false), "dark");
  const html = await fs.readFile(new URL("../web/index.html", import.meta.url), "utf8");
  assert.ok(html.includes('localStorage.getItem("locus.theme.v1")'));
  assert.ok(html.indexOf("locus.theme.v1") < html.indexOf('<script type="module"'));
});

test("responsive shell covers mobile, tablet, safe areas, dialogs, and AppKit theming", async () => {
  const responsive = await fs.readFile(new URL("../web/src/styles/responsive.css", import.meta.url), "utf8");
  const app = await fs.readFile(new URL("../web/src/app.tsx", import.meta.url), "utf8");
  const appkit = await fs.readFile(new URL("../web/src/session/appkit.ts", import.meta.url), "utf8");
  assert.match(responsive, /@media \(min-width: 768px\) and \(max-width: 1024px\)/);
  assert.match(responsive, /@media \(max-width: 767px\)/);
  assert.match(responsive, /\.responsive-select \.responsive-select__tabs \{ display: none; \}/);
  assert.match(responsive, /\.responsive-select__mobile \{ display: block; width: 100%; min-width: 0; \}/);
  assert.match(responsive, /env\(safe-area-inset-bottom\)/);
  assert.match(responsive, /100dvh/);
  assert.match(responsive, /\.modal\s*\{/);
  const mobileNavigation = await fs.readFile(new URL("../web/src/components/MobileNavigation.tsx", import.meta.url), "utf8");
  const navigationLinks = await fs.readFile(new URL("../web/src/navigation/links.ts", import.meta.url), "utf8");
  assert.match(app, /<MobileNavigation route=\{page\}/);
  assert.doesNotMatch(app + responsive, /mobile-bottom-nav/);
  assert.match(mobileNavigation, /aria-label=\{t\("common\.navigate"\)\}/);
  assert.match(mobileNavigation, /aria-expanded=\{open\}/);
  assert.match(mobileNavigation, /<Dialog\.Content[^>]+mobile-navigation-dialog/);
  assert.match(mobileNavigation, /aria-modal="true"/);
  assert.match(mobileNavigation, /route: "assets", label: "Assets"/);
  assert.match(mobileNavigation, /route: "swap", label: "Swap"/);
  assert.match(mobileNavigation, /route: "liquidity", label: "Liquidity"/);
  assert.match(mobileNavigation, /route: "activity", label: "Activity"/);
  assert.match(mobileNavigation, /route: "send", label: "Send"/);
  assert.match(mobileNavigation, /target="_blank" rel="noopener noreferrer"/);
  assert.match(navigationLinks, /https:\/\/x\.com\/archelabs_org/);
  assert.match(navigationLinks, /https:\/\/locus\.archelabs\.xyz/);
  assert.match(navigationLinks, /https:\/\/genesis\.minijam\.xyz/);
  assert.match(responsive, /padding: 16px 14px calc\(24px \+ env\(safe-area-inset-bottom\)\)/);
  assert.match(responsive, /padding: 8px 20px calc\(14px \+ env\(safe-area-inset-bottom\)\)/);
  assert.match(appkit, /themeMode: initialThemeMode/);
  assert.equal(JSON.parse(await fs.readFile(new URL("../web/package.json", import.meta.url), "utf8")).dependencies["@mui/material"], undefined);
});

test("production network config defaults to TestNet without pointing at Local services", async () => {
  const config = JSON.parse(await fs.readFile(new URL("../web/public/locus-networks.json", import.meta.url), "utf8"));
  assert.equal(config.defaultNetwork, "testnet");
  assert.equal(config.networks.local.label, "MiniJAM Local / Development");
  assert.equal(config.networks.local.backendUrl, null);
  assert.equal(config.networks.local.deploymentUrl, null);
  assert.equal("matrixResolverUrl" in config.networks.local, false);
  assert.equal(config.networks.testnet.backendUrl, "https://rpc-stage1.minijam.xyz/rpc");
  assert.equal(config.networks.testnet.matrixResolverUrl, "https://rpc-stage1.minijam.xyz/matrix-resolver");
  assert.equal(config.networks.testnet.deploymentUrl, "deployments/testnet.json");
  assert.equal(config.networks.testnet.label, "MiniJAM TestNet");
});

test("Matrix provider selection resolves a server name without asking for a user ID", async () => {
  assert.deepEqual(DEFAULT_MATRIX_PROVIDER, { id: "matrix.org", label: "Matrix.org", server: "matrix.org" });
  const requests = [];
  const discovered = await resolveMatrixServer("example.org/", async (url) => {
    requests.push(String(url));
    return new Response(JSON.stringify({ "m.homeserver": { base_url: "https://matrix-backend.example.org/" } }), { status: 200 });
  });
  assert.equal(discovered, "https://matrix-backend.example.org");
  assert.deepEqual(requests, ["https://example.org/.well-known/matrix/client"]);
  assert.equal(await resolveMatrixServer("fallback.example", async () => new Response("", { status: 404 })), "https://fallback.example");
  let explicitLookup = false;
  assert.equal(await resolveMatrixServer("https://matrix.example.org/", async () => { explicitLookup = true; throw new Error("should not discover explicit URLs"); }), "https://matrix.example.org");
  assert.equal(explicitLookup, false, "an explicit homeserver URL is used directly");
  await assert.rejects(resolveMatrixServer(""), /Enter a Matrix server/);
});

function fakeEvmProvider(initialAccounts = []) {
  const listeners = new Map();
  return {
    accounts: initialAccounts,
    async request({ method }) {
      assert.equal(method, "eth_accounts");
      return this.accounts;
    },
    on(event, listener) {
      const set = listeners.get(event) ?? new Set();
      set.add(listener);
      listeners.set(event, set);
    },
    removeListener(event, listener) { listeners.get(event)?.delete(listener); },
    emit(event, value) { for (const listener of listeners.get(event) ?? []) listener(value); },
  };
}

function fakeSessionHarness(createSessionOverride) {
  const entries = new Map();
  const storage = {
    getItem: (key) => entries.get(key) ?? null,
    setItem: (key, value) => entries.set(key, String(value)),
    removeItem: (key) => entries.delete(key),
  };
  let session = null;
  const commits = [];
  const clears = [];
  const errors = [];
  const makeSession = async (provider, address) => ({
    kind: "evm",
    provider,
    owner: evmOwnership(address),
    controller: evmOwnership(address),
    ownershipSession: { signer: { address } },
    label: `EVM ${address}`,
    address,
    connectionId: address,
  });
  const bridge = new EvmSessionBridge({
    getSession: () => session,
    commitSession: (next) => {
      persistWalletSession(storage, next);
      session = next;
      commits.push(next);
    },
    clearSession: () => {
      clearPersistedWalletSession(storage);
      session = null;
      clears.push(true);
    },
    createSession: createSessionOverride ?? makeSession,
    onError: (error) => errors.push(error),
  });
  return { bridge, storage, commits, clears, errors, get session() { return session; } };
}

const flushSessionBridge = async () => new Promise((resolve) => setTimeout(resolve, 0));

test("EVM_CONNECT_RETURN_WITHOUT_REFRESH: bridge reconciles after mobile wallet return", async () => {
  const harness = fakeSessionHarness();
  const win = new EventTarget();
  const doc = new EventTarget();
  doc.visibilityState = "hidden";
  harness.bridge.start(win, doc);
  harness.bridge.beginConnection();
  win.dispatchEvent(new Event("blur"));
  doc.visibilityState = "visible";
  doc.dispatchEvent(new Event("visibilitychange"));
  const provider = fakeEvmProvider(["0x1111111111111111111111111111111111111111"]);
  harness.bridge.updateAppKit(provider, provider.accounts[0]);
  await flushSessionBridge();
  assert.equal(harness.session?.address, provider.accounts[0]);
  assert.equal(harness.commits.length, 1);
  assert.equal(JSON.parse(harness.storage.getItem(WALLET_SESSION_KEY)).address, provider.accounts[0]);
});

test("EVM provider/address hook orderings reconcile without waiting for a lucky render", async () => {
  for (const addressFirst of [false, true]) {
    const harness = fakeSessionHarness();
    const chosenAddress = "0x2222222222222222222222222222222222222222";
    const provider = fakeEvmProvider(addressFirst
      ? [chosenAddress]
      : ["0x8888888888888888888888888888888888888888", chosenAddress]);
    harness.bridge.beginConnection();
    if (addressFirst) {
      harness.bridge.updateAppKit(undefined, chosenAddress);
      harness.bridge.updateAppKit(provider, chosenAddress);
    } else {
      harness.bridge.updateAppKit(provider, undefined);
      await flushSessionBridge();
      assert.equal(harness.session, null, "multiple accounts require the AppKit-selected account hint");
      harness.bridge.updateAppKit(provider, chosenAddress);
    }
    await flushSessionBridge();
    assert.equal(harness.session?.address, chosenAddress);
  }
});

test("EVM_TRANSIENT_DISCONNECT_SAFE: disconnect during wallet handoff preserves session", async () => {
  const harness = fakeSessionHarness();
  const provider = fakeEvmProvider(["0x3333333333333333333333333333333333333333"]);
  harness.bridge.beginConnection();
  harness.bridge.updateAppKit(provider, provider.accounts[0]);
  await flushSessionBridge();
  harness.bridge.updateAppKit(undefined, undefined);
  const disconnectedProvider = fakeEvmProvider([]);
  harness.bridge.updateAppKit(disconnectedProvider, undefined);
  await flushSessionBridge();
  assert.equal(harness.session?.address, provider.accounts[0]);
  assert.equal(harness.clears.length, 0);
  assert.ok(harness.storage.getItem(WALLET_SESSION_KEY));
});

test("EVM provider replacement rebuilds the signer against the resumed wallet provider", async () => {
  const harness = fakeSessionHarness();
  const address = "0x9999999999999999999999999999999999999999";
  const firstProvider = fakeEvmProvider([address]);
  harness.bridge.beginConnection();
  harness.bridge.updateAppKit(firstProvider, address);
  await flushSessionBridge();
  const resumedProvider = fakeEvmProvider([address]);
  harness.bridge.updateAppKit(resumedProvider, address);
  await flushSessionBridge();
  assert.equal(harness.session?.address, address);
  assert.equal(harness.session?.provider, resumedProvider);
  assert.equal(harness.commits.length, 2);
});

test("EVM_EXPLICIT_DISCONNECT: explicit disconnect clears memory and persistence", async () => {
  const harness = fakeSessionHarness();
  const provider = fakeEvmProvider(["0x4444444444444444444444444444444444444444"]);
  harness.bridge.beginConnection();
  harness.bridge.updateAppKit(provider, provider.accounts[0]);
  await flushSessionBridge();
  harness.bridge.explicitDisconnect();
  assert.equal(harness.session, null);
  assert.equal(harness.storage.getItem(WALLET_SESSION_KEY), null);
});

test("EVM_ACCOUNT_EVENT_SWITCH: confirmed account change replaces the complete EVM session", async () => {
  const harness = fakeSessionHarness();
  const oldAddress = "0x5555555555555555555555555555555555555555";
  const newAddress = "0x6666666666666666666666666666666666666666";
  const provider = fakeEvmProvider([oldAddress]);
  harness.bridge.beginConnection();
  harness.bridge.updateAppKit(provider, oldAddress);
  await flushSessionBridge();
  const previous = harness.session;
  provider.accounts = [newAddress];
  provider.emit("accountsChanged", provider.accounts);
  await harness.bridge.reconcile();
  assert.equal(harness.session?.address, newAddress);
  assert.notEqual(harness.session, previous);
  assert.notEqual(harness.session?.ownershipSession.signer, previous?.ownershipSession.signer);
  assert.notDeepEqual(harness.session?.owner, previous?.owner);
  assert.notDeepEqual(harness.session?.controller, previous?.controller);
  assert.equal(JSON.parse(harness.storage.getItem(WALLET_SESSION_KEY)).address, newAddress);
});

test("EVM_APPKIT_ACCOUNT_SWITCH: AppKit hint is confirmed against eth_accounts before commit", async () => {
  const harness = fakeSessionHarness();
  const oldAddress = "0x1010101010101010101010101010101010101010";
  const newAddress = "0x2020202020202020202020202020202020202020";
  const provider = fakeEvmProvider([oldAddress, newAddress]);
  harness.bridge.beginConnection();
  harness.bridge.updateAppKit(provider, oldAddress);
  await harness.bridge.reconcile();
  assert.equal(harness.session?.address, oldAddress);
  harness.bridge.updateAppKit(provider, newAddress);
  await harness.bridge.reconcile();
  assert.equal(harness.session?.address, newAddress);
});

test("EVM_CANCEL_PRESERVES_SESSION: leaving AppKit account selection unchanged keeps the current signer", async () => {
  const harness = fakeSessionHarness();
  const accountA = "0x2424242424242424242424242424242424242424";
  const provider = fakeEvmProvider([accountA]);
  harness.bridge.beginConnection();
  harness.bridge.updateAppKit(provider, accountA);
  await harness.bridge.reconcile();
  const current = harness.session;
  // Closing AppKit without an account event is a cancellation; no session replacement is requested.
  await harness.bridge.reconcile();
  assert.equal(harness.session, current);
  assert.equal(harness.commits.length, 1);
  assert.equal(JSON.parse(harness.storage.getItem(WALLET_SESSION_KEY)).address, accountA);
});

test("EVM_AMBIGUOUS_ACCOUNTS_KEEP_CURRENT: [A, B] without a new selection keeps A", async () => {
  const harness = fakeSessionHarness();
  const accountA = "0x2121212121212121212121212121212121212121";
  const accountB = "0x2323232323232323232323232323232323232323";
  const provider = fakeEvmProvider([accountA]);
  harness.bridge.beginConnection();
  harness.bridge.updateAppKit(provider, accountA);
  await harness.bridge.reconcile();
  const current = harness.session;
  provider.accounts = [accountA, accountB];
  harness.bridge.updateAppKit(provider, undefined);
  await harness.bridge.reconcile();
  assert.equal(harness.session, current);
  assert.equal(harness.session?.address, accountA);
});

test("EVM_MISSING_CURRENT_WITH_AMBIGUOUS_ACCOUNTS: an unselected replacement list fails closed", async () => {
  const harness = fakeSessionHarness();
  const oldAddress = "0x3030303030303030303030303030303030303030";
  const accountB = "0x4040404040404040404040404040404040404040";
  const accountC = "0x5050505050505050505050505050505050505050";
  const provider = fakeEvmProvider([oldAddress]);
  harness.bridge.beginConnection();
  harness.bridge.updateAppKit(provider, oldAddress);
  await harness.bridge.reconcile();
  provider.accounts = [accountB, accountC];
  harness.bridge.updateAppKit(provider, undefined);
  await harness.bridge.reconcile();
  assert.equal(harness.session, null);
  assert.equal(harness.clears.length, 1);
});

test("EVM_SWITCH_FAILURE_PRESERVES_CURRENT: failed signer creation keeps the current session", async () => {
  const oldAddress = "0x6060606060606060606060606060606060606060";
  const newAddress = "0x7070707070707070707070707070707070707070";
  const harness = fakeSessionHarness(async (provider, address) => {
    if (address === newAddress) throw new Error("signer setup failed");
    return {
      kind: "evm", provider, owner: evmOwnership(address), controller: evmOwnership(address),
      ownershipSession: { signer: { address } }, label: `EVM ${address}`, address, connectionId: address,
    };
  });
  const provider = fakeEvmProvider([oldAddress]);
  harness.bridge.beginConnection();
  harness.bridge.updateAppKit(provider, oldAddress);
  await harness.bridge.reconcile();
  const current = harness.session;
  provider.accounts = [newAddress];
  provider.emit("accountsChanged", provider.accounts);
  await harness.bridge.reconcile();
  assert.equal(harness.session, current);
  assert.equal(harness.clears.length, 0);
  assert.match(harness.errors.at(-1)?.message ?? "", /Could not switch account/);
});

test("EVM_SWITCH_RACE_GUARD: a late B signer is discarded when the wallet switches to C", async () => {
  const oldAddress = "0x8080808080808080808080808080808080808080";
  const accountB = "0x9090909090909090909090909090909090909090";
  const accountC = `0x${"c3".repeat(20)}`;
  let resolveB;
  let startedB;
  const bStarted = new Promise((resolve) => { startedB = resolve; });
  const harness = fakeSessionHarness(async (provider, address) => {
    if (address === accountB) {
      startedB();
      await new Promise((resolve) => { resolveB = resolve; });
    }
    return {
      kind: "evm", provider, owner: evmOwnership(address), controller: evmOwnership(address),
      ownershipSession: { signer: { address } }, label: `EVM ${address}`, address, connectionId: address,
    };
  });
  const provider = fakeEvmProvider([oldAddress]);
  harness.bridge.beginConnection();
  harness.bridge.updateAppKit(provider, oldAddress);
  await harness.bridge.reconcile();
  provider.accounts = [accountB];
  provider.emit("accountsChanged", provider.accounts);
  const switching = harness.bridge.reconcile();
  await bStarted;
  provider.accounts = [accountC];
  provider.emit("accountsChanged", provider.accounts);
  resolveB();
  await switching;
  assert.equal(harness.session?.address, accountC);
  assert.deepEqual(harness.commits.map((entry) => entry.address), [oldAddress, accountC]);
});

test("EVM_WALLET_DISCONNECT: explicit empty account event clears the Locus session", async () => {
  const harness = fakeSessionHarness();
  const address = "0xb0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0";
  const provider = fakeEvmProvider([address]);
  harness.bridge.beginConnection();
  harness.bridge.updateAppKit(provider, address);
  await harness.bridge.reconcile();
  provider.accounts = [];
  provider.emit("accountsChanged", []);
  assert.equal(harness.session, null);
  assert.equal(harness.storage.getItem(WALLET_SESSION_KEY), null);
});

test("POLKADOT_ACCOUNT_LIST and POLKADOT_SWITCH_A_TO_B create a fresh selected Ownership signer", async () => {
  const publicKeyA = new Uint8Array(32).fill(21);
  const publicKeyB = new Uint8Array(32).fill(22);
  const accountA = { address: encodeAddress(publicKeyA), publicKey: publicKeyA, type: "sr25519", meta: { name: "Alice", source: "polkadot-js" } };
  const accountB = { address: encodeAddress(publicKeyB), publicKey: publicKeyB, type: "sr25519", meta: { name: "Bob", source: "polkadot-js" } };
  const options = polkadotAccountOptions([accountA, accountB]);
  assert.deepEqual(options.map(({ label }) => label), ["Alice", "Bob"]);
  assert.equal(requirePolkadotAccount([accountA, accountB], accountB.address), accountB);
  assert.throws(() => requirePolkadotAccount([accountA], accountB.address), /no longer available/);
  const injector = { signer: { signRaw: async () => ({ signature: `0x${"11".repeat(64)}` }) } };
  const sessionA = await connectPolkadotAccount(accountA, injector);
  const sessionB = await connectPolkadotAccount(accountB, injector);
  assert.equal(sessionB.address, accountB.address);
  assert.equal(sessionB.connectionId, accountB.address);
  assert.notEqual(sessionA.ownershipSession.signer, sessionB.ownershipSession.signer);
  assert.notDeepEqual(sessionA.owner, sessionB.owner);
  let activeSession = sessionA;
  let prepareCalled = false;
  await switchPolkadotSession(sessionA, accountA.address, () => activeSession, async () => {
    prepareCalled = true;
    return sessionA;
  }, (next) => { activeSession = next; });
  assert.equal(prepareCalled, false, "selecting the current account is a no-op");
  await switchPolkadotSession(sessionA, accountB.address, () => activeSession, async (address) => {
    assert.equal(address, accountB.address);
    return sessionB;
  }, (next) => { activeSession = next; });
  assert.equal(activeSession, sessionB);
  assert.equal(activeSession.ownershipSession.signer, sessionB.ownershipSession.signer);
  let failedCommit = false;
  await assert.rejects(switchPolkadotSession(sessionB, accountA.address, () => activeSession, async () => {
    throw new Error("selected extension account disappeared");
  }, () => { failedCommit = true; }), /disappeared/);
  assert.equal(failedCommit, false);
  assert.equal(activeSession, sessionB, "a failed account replacement preserves the current Polkadot session");
  const storage = new Map();
  persistWalletSession({ setItem: (key, value) => storage.set(key, value), removeItem: (key) => storage.delete(key) }, sessionB);
  assert.equal(JSON.parse(storage.get(WALLET_SESSION_KEY)).address, accountB.address);
  assert.equal(requirePolkadotAccount([accountA, accountB], JSON.parse(storage.get(WALLET_SESSION_KEY)).address), accountB);
});

test("EVM_REFRESH_RESTORE: refresh restores the exact session already persisted at commit", async () => {
  const first = fakeSessionHarness();
  const address = "0x7777777777777777777777777777777777777777";
  const provider = fakeEvmProvider([address]);
  first.bridge.beginConnection();
  first.bridge.updateAppKit(provider, address);
  await flushSessionBridge();
  const stored = JSON.parse(first.storage.getItem(WALLET_SESSION_KEY));
  const restored = fakeSessionHarness();
  restored.bridge.beginRestore(stored.address);
  restored.bridge.updateAppKit(fakeEvmProvider([address]), address);
  await flushSessionBridge();
  assert.equal(restored.session?.address, address);
  assert.equal(restored.session?.connectionId, stored.connectionId);
  assert.equal(restored.storage.getItem(WALLET_SESSION_KEY), first.storage.getItem(WALLET_SESSION_KEY));
});

test("asset queries separate network/service metadata from per-Ownership balances", () => {
  const ownerA = formatLocusId(evmOwnership("0x0000000000000000000000000000000000000001"));
  const ownerB = formatLocusId(evmOwnership("0x0000000000000000000000000000000000000002"));
  const meta = assetMetadataQueryKey("local", 797069104, "0xAA");
  assert.deepEqual(meta, ["locus", "assets", "metadata", "local", 797069104, "0xaa"]);
  assert.deepEqual(assetIdsQueryKey("local", 797069104), assetIdsQueryKey("local", 797069104));
  assert.notDeepEqual(assetIdsQueryKey("local", 797069104), assetIdsQueryKey("testnet", 797069104));
  assert.notDeepEqual(assetMetadataQueryKey("local", 797069104, "0x01"), assetMetadataQueryKey("local", 797069105, "0x01"));
  assert.notDeepEqual(assetBalanceQueryKey("local", 797069104, ownerA, "0x01"), assetBalanceQueryKey("local", 797069104, ownerB, "0x01"));
  assert.notDeepEqual(assetBalanceQueryKey("local", 797069104, ownerA, "0x01"), meta);
});

test("ASSET_INITIAL_LOAD and ASSET_BACKGROUND_REFETCH_KEEPS_ROWS retain cached metadata", () => {
  const initial = keepAssetRowsForScope({ scope: "", rows: [] }, "local:797069104", [{ assetIdHex: "0x01", name: "DOT" }]);
  assert.equal(initial.rows.length, 1);
  const refetch = keepAssetRowsForScope(initial, "local:797069104", []);
  assert.deepEqual(refetch.rows, initial.rows);
  const updated = keepAssetRowsForScope(refetch, "local:797069104", [{ assetIdHex: "0x01", name: "Polkadot" }]);
  assert.equal(updated.rows[0].name, "Polkadot");
});

test("ASSET_SINGLE_BALANCE_FAILURE_KEEPS_ASSETS and ASSET_SESSION_CHANGE_KEEPS_METADATA", () => {
  const metadata = [{ assetIdHex: "0x01", name: "DOT" }, { assetIdHex: "0x02", name: "MINI" }];
  const balances = new Map([["0x02", 4n]]); // one query can fail without deleting catalog rows
  const rows = attachAssetBalances(metadata, balances, true);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].balance, null);
  assert.equal(rows[1].balance, 4n);
  const sessionSwitch = keepAssetRowsForScope({ scope: "local:797069104", rows: metadata }, "local:797069104", []);
  assert.deepEqual(sessionSwitch.rows, metadata);
});

test("ASSET_TRANSIENT_NETWORK_RECONNECT_KEEPS_STALE_DATA but ASSET_NETWORK_SWITCH_INVALIDATES_SCOPE", () => {
  const cached = { scope: "local:797069104", rows: [{ assetIdHex: "0x01", name: "DOT" }] };
  const reconnect = keepAssetRowsForScope(cached, "local:797069104", []);
  assert.deepEqual(reconnect.rows, cached.rows);
  const switched = keepAssetRowsForScope(cached, "testnet:797069104", []);
  assert.deepEqual(switched.rows, []);
});

test("network recipient resolution uses canonical ownership decoders", () => {
  assert.equal(evmOwnership("0x0000000000000000000000000000000000000001").public.length, 20);
  assert.throws(() => evmOwnership("0x1234"));
  assert.equal(polkadotOwnership(encodeAddress(new Uint8Array(32).fill(1))).public.length, 32);
  assert.throws(() => polkadotOwnership("not-an-address"));
  assert.equal(solanaOwnership("11111111111111111111111111111111").public.length, 32);
  assert.throws(() => solanaOwnership("not-a-solana-address"));
});

test("Locus IDs round-trip the canonical Ownership encoding", () => {
  const owner = evmOwnership("0x0000000000000000000000000000000000000001");
  const locusId = formatLocusId(owner);
  const decoded = parseLocusId(locusId);
  assert.equal(locusId.startsWith("locus:"), true);
  assert.deepEqual(decoded, owner);
  assert.throws(() => parseLocusId("locus:not-valid"));
});

test("Matrix controller authorization distinguishes JamScript fatal codes from business rejection", () => {
  const fatal = matrixControllerReceiptFailure(2_147_483_649, "sensitive proof details");
  assert.equal(fatal.code, "CONTROLLER_NOT_AUTHORIZED");
  assert.match(fatal.message, /Internal JamScript runtime error/);
  assert.match(fatal.message, /FATAL_UNCAUGHT, 0x80000001/);
  assert.doesNotMatch(fatal.message, /Locus rejected|sensitive proof details|proof bytes/);

  const rejected = matrixControllerReceiptFailure(5005, "proof diagnostics");
  assert.equal(rejected.code, "OWNERSHIP_PROOF_INVALID");
  assert.match(rejected.message, /proof is invalid/);
  assert.doesNotMatch(rejected.message, /proof diagnostics|signature|0x/);
});

test("network amounts remain exact bigint values", () => {
  assert.equal(parseUnits("12.345", 3), 12345n);
  assert.equal(formatUnits(12345n, 3), "12.345");
  assert.throws(() => parseUnits("1e3", 0));
  assert.throws(() => parseUnits("1.234", 2));
});

test("unknown and zero balances use zero-value formatting", async () => {
  const source = await fs.readFile(new URL("../web/src/locus/assets.ts", import.meta.url), "utf8");
  assert.match(source, /formatUnits\(value \?\? 0n, decimals\)/);
  assert.equal(formatUnits(0n, 0), "0");
  assert.equal(formatUnits(0n, 6), "0");
});

test("Matrix OAuth discovery starts authorization code flow with PKCE S256 and stable device scope", async () => {
  const storage = () => {
    const entries = new Map();
    return {
      getItem: (key) => entries.get(key) ?? null,
      setItem: (key, value) => entries.set(key, String(value)),
      removeItem: (key) => entries.delete(key),
    };
  };
  const originalWindow = globalThis.window;
  const originalFetch = globalThis.fetch;
  const assigned = [];
  const registrations = [];
  globalThis.window = {
    localStorage: storage(), sessionStorage: storage(),
    location: { href: "https://locus.example/app", origin: "https://locus.example", assign: (value) => assigned.push(value) },
  };
  globalThis.fetch = async (url, init = {}) => {
    if (String(url).endsWith("/_matrix/client/v1/auth_metadata")) return new Response(JSON.stringify({
      issuer: "https://auth.example.org/", authorization_endpoint: "https://auth.example.org/oauth2/auth",
      token_endpoint: "https://auth.example.org/oauth2/token", registration_endpoint: "https://auth.example.org/oauth2/register",
      revocation_endpoint: "https://auth.example.org/oauth2/revoke", code_challenge_methods_supported: ["S256"], response_types_supported: ["code"],
      grant_types_supported: ["authorization_code", "refresh_token"], response_modes_supported: ["query", "fragment"],
    }), { status: 200, headers: { "content-type": "application/json" } });
    assert.equal(init.method, "POST");
    registrations.push(JSON.parse(init.body));
    return new Response(JSON.stringify({ client_id: "locus-test-client" }), { status: 201, headers: { "content-type": "application/json" } });
  };
  try {
    const metadata = await discoverMatrixAuthMetadata("https://example.org");
    assert.equal(metadata.authorization_endpoint, "https://auth.example.org/oauth2/auth");
    await beginMatrixOAuth("https://example.org");
    assert.equal(assigned.length, 1);
    const authorization = new URL(assigned[0]);
    const flow = JSON.parse(window.sessionStorage.getItem("locus.matrix.oauth-flow.v1"));
    assert.equal(authorization.searchParams.get("response_type"), "code");
    assert.equal(authorization.searchParams.get("client_id"), "locus-test-client");
    assert.equal(authorization.searchParams.get("response_mode"), "fragment");
    assert.equal(authorization.searchParams.get("code_challenge_method"), "S256");
    assert.equal(authorization.searchParams.has("login_hint"), false);
    assert.equal(authorization.searchParams.get("state"), flow.state);
    assert.equal(authorization.searchParams.get("scope"), `urn:matrix:client:api:* urn:matrix:client:device:${flow.deviceId}`);
    assert.equal(authorization.searchParams.get("code_challenge"), createHash("sha256").update(flow.verifier).digest("base64url"));
    assert.deepEqual(registrations[0].redirect_uris, ["https://locus.example/app"]);
    assert.equal(registrations[0].client_uri, "https://locus.example/");
    const deviceKey = "locus.matrix.device.v1.https://example.org|@alice:example.org";
    assert.match(flow.deviceId, /^LOCUS-[A-Z0-9]+$/);
    assert.equal(window.sessionStorage.getItem(deviceKey), null, "a fresh auth flow does not reuse a committed or provisional device ID");
    assert.equal(window.localStorage.getItem(deviceKey), null, "a device ID is committed only after crypto setup succeeds");
    window.location.href = "http://127.0.0.1:5173/";
    await assert.rejects(beginMatrixOAuth("https://example.org"), /requires Locus to be opened over HTTPS/);
    assert.equal(registrations.length, 1, "insecure previews must not register an invalid web client");
  } finally {
    globalThis.window = originalWindow;
    globalThis.fetch = originalFetch;
  }
});

test("OAuth metadata selects OAuth only and never probes or redirects to legacy SSO", async () => {
  const storage = () => {
    const entries = new Map();
    return { getItem: (key) => entries.get(key) ?? null, setItem: (key, value) => entries.set(key, String(value)), removeItem: (key) => entries.delete(key) };
  };
  const originalWindow = globalThis.window;
  const originalFetch = globalThis.fetch;
  const requests = [];
  globalThis.window = {
    localStorage: storage(), sessionStorage: storage(),
    location: { href: "https://locus.example/app", origin: "https://locus.example", assign: (url) => requests.push({ redirect: String(url) }) },
  };
  globalThis.fetch = async (url, init = {}) => {
    const target = String(url);
    requests.push({ url: target, method: init.method ?? "GET" });
    if (target.endsWith("/_matrix/client/v1/auth_metadata")) return new Response(JSON.stringify({
      issuer: "https://auth.example.org/", authorization_endpoint: "https://auth.example.org/auth", token_endpoint: "https://auth.example.org/token",
      registration_endpoint: "https://auth.example.org/register", revocation_endpoint: "https://auth.example.org/revoke",
      response_types_supported: ["code"], grant_types_supported: ["authorization_code", "refresh_token"], response_modes_supported: ["fragment"], code_challenge_methods_supported: ["S256"],
    }), { status: 200, headers: { "content-type": "application/json" } });
    if (target.endsWith("/register")) return new Response(JSON.stringify({ client_id: "locus-client" }), { status: 201, headers: { "content-type": "application/json" } });
    if (target.endsWith("/_matrix/client/v3/login")) return new Response(JSON.stringify({ errcode: "M_UNRECOGNIZED" }), { status: 404 });
    throw new Error(`Unexpected request ${target}`);
  };
  try {
    const capabilities = await discoverMatrixAuthCapabilities("https://example.org/");
    assert.equal(capabilities.mode, "oauth");
    assert.equal(capabilities.sso, false);
    assert.equal(capabilities.password, false);
    await beginMatrixOAuth("https://example.org", capabilities);
    assert.equal(requests.some(({ url }) => url?.endsWith("/_matrix/client/v3/login")), false);
    assert.equal(requests.some(({ redirect }) => redirect?.includes("/login/sso/redirect")), false);
    assert.equal(requests.some(({ redirect }) => redirect?.startsWith("https://auth.example.org/auth?")), true);
  } finally { globalThis.window = originalWindow; globalThis.fetch = originalFetch; }
});

test("legacy SSO is shown and usable only when /login advertises m.login.sso", async () => {
  const storage = () => {
    const entries = new Map();
    return { getItem: (key) => entries.get(key) ?? null, setItem: (key, value) => entries.set(key, String(value)), removeItem: (key) => entries.delete(key) };
  };
  const originalWindow = globalThis.window;
  const originalFetch = globalThis.fetch;
  const sessionStorage = storage();
  const assigned = [];
  const requests = [];
  globalThis.window = {
    localStorage: storage(), sessionStorage,
    location: { href: "https://locus.example/app", origin: "https://locus.example", assign: (url) => assigned.push(String(url)) },
    history: { replaceState() {} },
  };
  globalThis.fetch = async (url, init = {}) => {
    const target = String(url);
    requests.push({ target, method: init.method ?? "GET" });
    if (target.endsWith("/_matrix/client/v1/auth_metadata")) return new Response(JSON.stringify({ errcode: "M_UNRECOGNIZED" }), { status: 404 });
    if (target.endsWith("/_matrix/client/v3/login") && !init.method) return new Response(JSON.stringify({ flows: [{ type: "m.login.sso" }] }), { status: 200 });
    if (target.endsWith("/_matrix/client/v3/login") && init.method === "POST") return new Response(JSON.stringify({ access_token: "sso-access", user_id: "@authenticated:example.org", device_id: "ELEMENT-LOGIN" }), { status: 200 });
    throw new Error(`Unexpected request ${target}`);
  };
  try {
    const capabilities = await discoverMatrixAuthCapabilities("https://example.org");
    assert.deepEqual(capabilities, { mode: "legacy", homeserver: "https://example.org", sso: true, password: false });
    await beginMatrixSso("https://example.org", capabilities);
    assert.equal(new URL(assigned[0]).pathname, "/_matrix/client/v3/login/sso/redirect");
    assert.equal(requests.some(({ target }) => target.endsWith("/login/sso/redirect")), false, "the redirect is a browser navigation, never an unguarded fetch");
    const flow = JSON.parse(sessionStorage.getItem("locus.matrix.sso-flow.v1"));
    globalThis.window.location.href = `https://locus.example/app?matrix_sso_state=${flow.state}&loginToken=temporary-token`;
    const completed = await completeMatrixAuthCallback();
    assert.equal(completed.authType, "legacy");
    assert.equal(completed.userId, "@authenticated:example.org", "the SSO login response supplies the authenticated identity");
    assert.equal(completed.deviceId, "ELEMENT-LOGIN");
    assert.equal(requests.some(({ target, method }) => target.endsWith("/login") && method === "POST"), true);
  } finally { globalThis.window = originalWindow; globalThis.fetch = originalFetch; }
});

test("legacy password and unsupported homeservers follow advertised login flows only", async () => {
  const originalFetch = globalThis.fetch;
  let flows = [];
  let loginStatus = 200;
  globalThis.fetch = async (url) => {
    const target = String(url);
    if (target.endsWith("/auth_metadata")) return new Response(JSON.stringify({ errcode: "M_UNRECOGNIZED" }), { status: 404 });
    if (target.endsWith("/v3/login")) return loginStatus === 200
      ? new Response(JSON.stringify({ flows }), { status: 200 })
      : new Response(JSON.stringify({ errcode: "M_UNRECOGNIZED" }), { status: loginStatus });
    throw new Error(`Unexpected request ${target}`);
  };
  try {
    flows = [{ type: "m.login.password" }];
    assert.deepEqual(await discoverMatrixAuthCapabilities("https://password.example"), { mode: "legacy", homeserver: "https://password.example", sso: false, password: true });
    flows = [{ type: "m.login.dummy" }];
    assert.deepEqual(await discoverMatrixAuthCapabilities("https://unsupported.example"), { mode: "legacy", homeserver: "https://unsupported.example", sso: false, password: false });
    loginStatus = 404;
    assert.deepEqual(await discoverMatrixAuthCapabilities("https://no-login.example"), { mode: "legacy", homeserver: "https://no-login.example", sso: false, password: false });
  } finally { globalThis.fetch = originalFetch; }
  const dialog = await fs.readFile(new URL("../web/src/matrix/MatrixLoginDialog.tsx", import.meta.url), "utf8");
  const i18n = await fs.readFile(new URL("../web/src/i18n/I18nProvider.tsx", import.meta.url), "utf8");
  assert.match(dialog, /stage === "password" && legacyCapabilities\?\.password/);
  assert.match(dialog, /legacyCapabilities\.sso &&/);
  assert.match(dialog, /t\("ui\.unsupportedMatrixServer"\)/);
  assert.match(i18n, /unsupportedMatrixServer: "This Matrix server does not advertise a supported sign-in method\./);
});

test("password authentication uses the selected server and trusts the login response user ID", async () => {
  let clientOptions;
  let loginInput;
  let stopped = false;
  const authenticated = await authenticateMatrixPassword(
    "https://selected.example/",
    "typed-account",
    "temporary-password",
    (options) => {
      clientOptions = options;
      return {
        async loginRequest(input) {
          loginInput = input;
          return { access_token: "password-access", refresh_token: "password-refresh", user_id: "@server-authenticated:example.org", device_id: input.device_id };
        },
        stopClient() { stopped = true; },
      };
    },
  );
  assert.deepEqual(clientOptions, { baseUrl: "https://selected.example" });
  assert.equal(loginInput.identifier.user, "typed-account");
  assert.equal(loginInput.password, "temporary-password");
  assert.match(loginInput.device_id, /^LOCUS-[A-Z0-9]+$/);
  assert.equal(authenticated.userId, "@server-authenticated:example.org");
  assert.equal(authenticated.homeserver, "https://selected.example");
  assert.equal(Object.hasOwn(authenticated, "password"), false);
  assert.equal(stopped, true);
});

test("OAuth runtime errors stay actionable and do not unlock legacy fallbacks", async () => {
  const storage = () => {
    const entries = new Map();
    return { getItem: (key) => entries.get(key) ?? null, setItem: (key, value) => entries.set(key, String(value)), removeItem: (key) => entries.delete(key) };
  };
  const originalWindow = globalThis.window;
  const originalFetch = globalThis.fetch;
  const requests = [];
  globalThis.window = { localStorage: storage(), sessionStorage: storage(), location: { href: "https://locus.example/app", origin: "https://locus.example", assign() {} } };
  globalThis.fetch = async (url, init = {}) => {
    const target = String(url);
    requests.push(target);
    if (target.endsWith("/auth_metadata")) return new Response(JSON.stringify({
      issuer: "https://auth.example/", authorization_endpoint: "https://auth.example/auth", token_endpoint: "https://auth.example/token",
      registration_endpoint: "https://auth.example/register", revocation_endpoint: "https://auth.example/revoke",
      response_types_supported: ["code"], grant_types_supported: ["authorization_code", "refresh_token"], response_modes_supported: ["fragment"], code_challenge_methods_supported: ["S256"],
    }), { status: 200 });
    if (target.endsWith("/register")) return new Response(JSON.stringify({ error_description: "registration is disabled by the homeserver" }), { status: 400 });
    throw new Error(`Unexpected request ${target}`);
  };
  try {
    const capabilities = await discoverMatrixAuthCapabilities("https://example.org");
    await assert.rejects(beginMatrixOAuth("https://example.org", capabilities), /registration is disabled by the homeserver/);
    assert.equal(capabilities.mode, "oauth");
    assert.equal(requests.some((url) => url.endsWith("/v3/login")), false);
    assert.equal(requests.some((url) => url.endsWith("/login/sso/redirect")), false);
  } finally { globalThis.window = originalWindow; globalThis.fetch = originalFetch; }
  const dialog = await fs.readFile(new URL("../web/src/matrix/MatrixLoginDialog.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(dialog, /setShowLegacy/);
  assert.match(dialog, /setError\(t\("ui\.matrixSignInStartFailed"\)\)/);
});

test("Matrix login separates server selection from authenticated identity and preserves verification", async () => {
  const dialog = await fs.readFile(new URL("../web/src/matrix/MatrixLoginDialog.tsx", import.meta.url), "utf8");
  const i18n = await fs.readFile(new URL("../web/src/i18n/I18nProvider.tsx", import.meta.url), "utf8");
  const oauth = await fs.readFile(new URL("../web/src/matrix/MatrixOAuth.ts", import.meta.url), "utf8");
  const connector = await fs.readFile(new URL("../web/src/matrix/MatrixConnector.ts", import.meta.url), "utf8");
  const passwordLogin = await fs.readFile(new URL("../web/src/matrix/MatrixPasswordLogin.ts", import.meta.url), "utf8");
  const responsive = await fs.readFile(new URL("../web/src/styles/responsive.css", import.meta.url), "utf8");
  const styles = await fs.readFile(new URL("../web/src/styles.css", import.meta.url), "utf8");
  const provider = await fs.readFile(new URL("../web/src/matrix/MatrixProvider.ts", import.meta.url), "utf8");
  const msc4108 = await fs.readFile(new URL("../docs/matrix-msc4108-feasibility.md", import.meta.url), "utf8");
  assert.match(dialog, /t\("ui\.continueMatrix"\)/);
  assert.match(dialog, /t\("ui\.useAnotherServer"\)/);
  assert.match(dialog, /t\("ui\.matrixServer"\)/);
  assert.match(i18n, /continueMatrix: "Continue with Matrix\.org"/);
  assert.match(i18n, /useAnotherServer: "Use another Matrix server"/);
  assert.match(i18n, /matrixServer: "Matrix server"/);
  assert.doesNotMatch(dialog, /Enter a Matrix ID first/);
  assert.doesNotMatch(dialog, /const \[userId, setUserId\]/);
  assert.match(dialog, /beginMatrixOAuth\(discovered, capabilities\)/);
  assert.match(dialog, /beginMatrixSso\(selectedServer, authCapabilities\)/);
  assert.match(dialog, /stage === "password" && legacyCapabilities\?\.password/);
  assert.match(dialog, /connectMatrixPasswordSession\(\s*selectedServer/);
  assert.match(passwordLogin, /userId: login\.user_id/);
  assert.match(oauth, /async function whoAmI[\s\S]*?return payload\.user_id/);
  assert.match(oauth, /export async function beginMatrixOAuth\(homeserver: string, discovered\?/);
  assert.match(oauth, /export async function beginMatrixSso\(homeserver: string, capabilities:/);
  assert.match(oauth, /export function matrixDeviceId\(\): string/);
  assert.match(connector, /const MATRIX_SESSION_KEY = "locus\.matrix\.session\.v1"/);
  assert.match(connector, /requestOwnUserVerification: async/);
  assert.match(connector, /createMatrixDeviceTrustMonitor\(readAndApplyTrust/);
  assert.match(dialog, /confirmVerification\(true\)/);
  assert.doesNotMatch(dialog, /Copy device ID|pendingConnection!\.stored\.deviceId/);
  assert.doesNotMatch(dialog, /mobile\.element\.io/);
  assert.match(responsive, /@media \(max-width: 767px\)/);
  assert.match(styles, /\.matrix-provider-choice/);
  assert.match(responsive, /\.matrix-auth-button,[\s\S]*?min-height: 48px/);
  assert.match(provider, /\.well-known\/matrix\/client/);
  assert.match(msc4108, /Do not implement MSC4108/);
});

test("Matrix OAuth callback returns a provisional session; committed sessions support refresh and revocation", async () => {
  const storage = () => {
    const entries = new Map();
    return {
      getItem: (key) => entries.get(key) ?? null,
      setItem: (key, value) => entries.set(key, String(value)),
      removeItem: (key) => entries.delete(key),
    };
  };
  const originalWindow = globalThis.window;
  const originalFetch = globalThis.fetch;
  const localStorage = storage();
  const sessionStorage = storage();
  const flow = { homeserver: "https://example.org", clientId: "client", deviceId: "LOCUS-DEVICE", state: "state", verifier: "verifier", redirectUri: "https://locus.example/app", tokenEndpoint: "https://auth.example.org/oauth2/token", revocationEndpoint: "https://auth.example.org/oauth2/revoke" };
  sessionStorage.setItem("locus.matrix.oauth-flow.v1", JSON.stringify(flow));
  globalThis.window = {
    localStorage, sessionStorage,
    location: { href: `https://locus.example/app#code=authorization-code&state=${flow.state}` },
    history: { replaceState() {} },
  };
  const calls = [];
  globalThis.fetch = async (url, init = {}) => {
    calls.push({ url: String(url), init });
    if (String(url) === flow.tokenEndpoint) return new Response(JSON.stringify({ access_token: "access-1", refresh_token: "refresh-1", expires_in: 300 }), { status: 200, headers: { "content-type": "application/json" } });
    if (String(url).endsWith("/account/whoami")) return new Response(JSON.stringify({ user_id: "@alice:example.org" }), { status: 200, headers: { "content-type": "application/json" } });
    if (String(url).endsWith("/_matrix/client/v3/logout")) return new Response("{}", { status: 200 });
    if (String(url) === flow.revocationEndpoint) return new Response("{}", { status: 200 });
    throw new Error(`Unexpected Matrix OAuth request ${url}`);
  };
  try {
    const stored = await completeMatrixAuthCallback();
    assert.equal(stored.userId, "@alice:example.org");
    assert.equal(stored.deviceId, flow.deviceId);
    assert.equal(stored.authType, "oauth");
    assert.equal(localStorage.getItem("locus.matrix.session.v1"), null, "token acquisition alone must not persist a durable session");
    await refreshMatrixOAuthToken(stored, false);
    assert.equal(localStorage.getItem("locus.matrix.session.v1"), null, "refreshing a provisional login must not persist before crypto setup");
    persistMatrixSession(stored);
    assert.equal(JSON.parse(localStorage.getItem("locus.matrix.session.v1")).refreshToken, "refresh-1");
    await refreshMatrixOAuthToken(stored);
    assert.equal(JSON.parse(localStorage.getItem("locus.matrix.session.v1")).accessToken, "access-1");
    await revokeMatrixOAuthSession(stored);
    assert.equal(calls.some(({ url }) => url === flow.revocationEndpoint), true);
    assert.equal(calls.some(({ url }) => url.endsWith("/_matrix/client/v3/logout")), true);
    assert.match(String(calls.find(({ url }) => url === flow.revocationEndpoint).init.body), /refresh-1/);
  } finally {
    globalThis.window = originalWindow;
    globalThis.fetch = originalFetch;
  }
});

test("new Matrix auth gets a fresh device ID; only a successfully initialized device is committed", () => {
  const storage = () => {
    const entries = new Map();
    return { getItem: (key) => entries.get(key) ?? null, setItem: (key, value) => entries.set(key, String(value)), removeItem: (key) => entries.delete(key) };
  };
  const originalWindow = globalThis.window;
  globalThis.window = { localStorage: storage(), sessionStorage: storage() };
  try {
    const deviceId = matrixDeviceId();
    const key = "locus.matrix.device.v1.https://example.org|@alice:example.org";
    assert.equal(window.localStorage.getItem(key), null);
    assert.equal(window.sessionStorage.getItem(key), null);
    assert.equal(matrixDeviceId.length, 0, "device IDs do not take a pre-login server name or user ID");
    assert.notEqual(matrixDeviceId(), deviceId);
    commitMatrixDeviceId("https://example.org", "@alice:example.org", deviceId);
    assert.equal(window.localStorage.getItem(key), deviceId);
    assert.equal(window.sessionStorage.getItem(key), null);
  } finally { globalThis.window = originalWindow; }
});

test("canceling Matrix verification clears the provisional login and closes the connect flow", async () => {
  const dialog = await fs.readFile(new URL("../web/src/matrix/MatrixLoginDialog.tsx", import.meta.url), "utf8");
  const connectDialog = await fs.readFile(new URL("../web/src/session/ConnectDialog.tsx", import.meta.url), "utf8");
  const app = await fs.readFile(new URL("../web/src/app.tsx", import.meta.url), "utf8");
  assert.match(dialog, /onClick=\{cancel\}>\{t\("common\.cancel"\)\}/);
  assert.match(dialog, /onCancel\(pendingConnection\)/);
  assert.match(dialog, /authAttempt\.current \+= 1/);
  assert.match(dialog, /dialogGeneration\.current \+= 1/);
  assert.match(connectDialog, /onCancel=\{onCancelMatrix\}/);
  assert.match(app, /onCancelMatrix=\{cancelMatrixSignIn\}/);
  const cancelHandler = app.match(/function cancelMatrixSignIn\([\s\S]*?\n  \}/)?.[0] ?? "";
  assert.match(cancelHandler, /disconnectSession\(\)/);
  assert.match(cancelHandler, /setConnectOpen\(false\)/);
  assert.match(app, /signOutMatrixSession\(stored\)/);
});

test("Matrix login does not stack its modal over the Ownership chooser", async () => {
  const connectDialog = await fs.readFile(new URL("../web/src/session/ConnectDialog.tsx", import.meta.url), "utf8");
  assert.match(connectDialog, /useState\(Boolean\(initialMatrixConnection\)\)/);
  assert.match(connectDialog, /open=\{open && !matrixOpen && !initialMatrixConnection\}/);
});

test("Matrix crypto WASM, store, and outgoing-request stages retain distinct safe errors", () => {
  const wasm = matrixCryptoStageFailure("CRYPTO_WASM_INIT_FAILED", "WASM could not load.", new Error("WASM TEST ERROR"));
  assert.equal(wasm.code, "CRYPTO_WASM_INIT_FAILED");
  assert.match(wasm.message, /WASM TEST ERROR/);
  assert.equal(wasm.cause.message, "WASM TEST ERROR");
  const store = matrixCryptoStageFailure("CRYPTO_STORE_INIT_FAILED", "Store locus-matrix-v1-test could not open.", new Error("IndexedDB TEST ERROR"));
  assert.equal(store.code, "CRYPTO_STORE_INIT_FAILED");
  assert.match(store.message, /locus-matrix-v1-test.*IndexedDB TEST ERROR/);
  const outgoing = matrixCryptoStageFailure("CRYPTO_OUTGOING_REQUEST_FAILED", "Outgoing requests could not be prepared.", new Error("OUTGOING TEST ERROR"));
  assert.equal(outgoing.code, "CRYPTO_OUTGOING_REQUEST_FAILED");
  assert.match(outgoing.message, /OUTGOING TEST ERROR/);
  assert.match(describeMatrixCause(new Error("Bearer secret access_token=secret refresh_token=secret password=secret code_verifier=secret")), /\[redacted\]/);
  assert.doesNotMatch(describeMatrixCause(new Error("Bearer secret access_token=secret refresh_token=secret password=secret code_verifier=secret")), /secret/);
});

test("Matrix crypto dev optimization is excluded and production build asserts the WASM artifact", async () => {
  const viteConfig = await fs.readFile(new URL("../web/vite.config.ts", import.meta.url), "utf8");
  const packageJson = JSON.parse(await fs.readFile(new URL("../web/package.json", import.meta.url), "utf8"));
  const smoke = await fs.readFile(new URL("../web/scripts/assert-matrix-wasm.mjs", import.meta.url), "utf8");
  assert.match(viteConfig, /optimizeDeps:\s*\{\s*exclude:\s*\["@matrix-org\/matrix-sdk-crypto-wasm"\]/);
  assert.match(packageJson.scripts.build, /assert-matrix-wasm\.mjs/);
  assert.match(smoke, /deepEqual\(emitted, source/);
});

test("Matrix durable-session commit follows crypto initialization and successful keys/query", async () => {
  const connector = await fs.readFile(new URL("../web/src/matrix/MatrixConnector.ts", import.meta.url), "utf8");
  const oauth = await fs.readFile(new URL("../web/src/matrix/MatrixOAuth.ts", import.meta.url), "utf8");
  const commit = connector.indexOf("commitMatrixSessionAfterCryptoSetup(stored, async () => {");
  const cryptoInit = connector.indexOf("await MatrixCryptoDevice.initialize(", commit);
  const keysQuery = connector.indexOf("await queryMatrixKeys(", cryptoInit);
  const cryptoCommit = oauth.indexOf("export async function commitMatrixSessionAfterCryptoSetup");
  const setupAwait = oauth.indexOf("const result = await setup();", cryptoCommit);
  const deviceCommit = oauth.indexOf("commitMatrixDeviceId(", setupAwait);
  const sessionCommit = oauth.indexOf("persistMatrixSession(", deviceCommit);
  assert.ok(commit >= 0 && cryptoInit > commit && keysQuery > cryptoInit);
  assert.ok(cryptoCommit >= 0 && setupAwait > cryptoCommit && deviceCommit > setupAwait && sessionCommit > deviceCommit);
});

test("Matrix session and stable device ID commit waits for successful crypto setup and keys/query", async () => {
  const originalWindow = globalThis.window;
  const storage = () => {
    const entries = new Map();
    return {
      getItem: (key) => entries.get(key) ?? null,
      setItem: (key, value) => entries.set(key, String(value)),
      removeItem: (key) => entries.delete(key),
    };
  };
  const localStorage = storage();
  const sessionStorage = storage();
  globalThis.window = { localStorage, sessionStorage };
  const stored = { accessToken: "token", userId: "@alice:example.org", deviceId: "LOCUS-TEST", homeserver: "https://example.org", authType: "legacy" };
  const deviceKey = `locus.matrix.device.v1.${stored.homeserver}|${stored.userId}`;
  try {
    sessionStorage.setItem(deviceKey, stored.deviceId);
    await assert.rejects(commitMatrixSessionAfterCryptoSetup(stored, async () => { throw new Error("CRYPTO TEST FAILURE"); }), /CRYPTO TEST FAILURE/);
    assert.equal(localStorage.getItem("locus.matrix.session.v1"), null);
    assert.equal(localStorage.getItem(deviceKey), null);
    const keys = { verification: "pending" };
    assert.deepEqual(await commitMatrixSessionAfterCryptoSetup(stored, async () => keys), keys);
    assert.deepEqual(JSON.parse(localStorage.getItem("locus.matrix.session.v1")), stored);
    assert.equal(localStorage.getItem(deviceKey), stored.deviceId);
    assert.equal(sessionStorage.getItem(deviceKey), null);
  } finally {
    globalThis.window = originalWindow;
  }
});

test("Matrix web sessions keep owner/controller/subject distinct and omit actAs", async () => {
  const source = await fs.readFile(new URL("../web/src/matrix/MatrixConnector.ts", import.meta.url), "utf8");
  assert.match(source, /owner,\n    controller:/);
  assert.match(source, /ownershipSession: \{ signer: controller, subject: owner \}/);
  assert.doesNotMatch(source, /actAs/);
});

test("network descriptors do not publish ControlClaim deployment metadata", async () => {
  const config = await fs.readFile(new URL("../web/public/locus-networks.json", import.meta.url), "utf8");
  assert.doesNotMatch(config, /controlClaim|ownershipControlServiceId|codeHash/);
});

test("curated presentation requires deployment, asset ID, metadata, and issuer matches", async () => {
  const assets = await fs.readFile(new URL("../web/src/locus/assets.ts", import.meta.url), "utf8");
  assert.match(assets, /catalog\.genesisHash\.toLowerCase\(\) === deployment\.genesisHash\.toLowerCase\(\)/);
  assert.match(assets, /catalog\.serviceId === deployment\.serviceId/);
  assert.match(assets, /new Map\(\(catalogEnabled \? catalog\.assets : \[\]\)\.map\(\(entry\) => \[entry\.assetId\.toLowerCase\(\), entry\]\)\)/);
  assert.match(assets, /candidate\.name === name[\s\S]*candidate\.symbol === symbol[\s\S]*candidate\.decimals === asset\.decimals[\s\S]*candidate\.issuerKey\.toLowerCase\(\) === issuerKey/);
  assert.doesNotMatch(assets, /symbol\s*===\s*["'](?:DOT|MINI|USDT|AAPL|NVDA|TSLA)["']/);
});

test("Matrix pending-device lookup reuses the same device ID until cross-signing appears", async () => {
  const userId = "@alice:example.org";
  const deviceId = "LOCUS-TEST";
  const master = new Uint8Array(32).fill(1);
  const selfSigning = new Uint8Array(32).fill(2);
  const curve = new Uint8Array(32).fill(3);
  const device = new Uint8Array(32).fill(4);
  const signature = new Uint8Array(64).fill(5);
  let verified = false;
  const fetchImpl = async () => ({
    ok: true,
    async text() {
      return JSON.stringify({
        master_keys: { [userId]: { keys: { "ed25519:MASTER": matrixB64(master) } } },
        self_signing_keys: { [userId]: { keys: { "ed25519:SELF": matrixB64(selfSigning) }, signatures: { [userId]: { "ed25519:MASTER": matrixB64(signature) } } } },
        device_keys: { [userId]: { [deviceId]: { algorithms: ["m.olm.v1.curve25519-aes-sha2"], keys: { [`curve25519:${deviceId}`]: matrixB64(curve), [`ed25519:${deviceId}`]: matrixB64(device) }, signatures: verified ? { [userId]: { "ed25519:SELF": matrixB64(signature) } } : {} } } },
      });
    },
  });
  const pending = await queryMatrixKeys(userId, deviceId, "https://example.org", "token", fetchImpl);
  assert.equal(pending.verification, "pending");
  assert.equal(pending.deviceId, deviceId);
  verified = true;
  const ready = await queryMatrixKeys(userId, deviceId, "https://example.org", "token", fetchImpl);
  assert.equal(ready.verification, "verified");
  assert.equal(ready.deviceId, deviceId);
  assert.deepEqual(ready.masterPublicKey, master);
});

test("identity icons use branded marks, generic EVM, and row-level selection", async () => {
  const identity = await fs.readFile(new URL("../web/src/components/IdentityIcon.tsx", import.meta.url), "utf8");
  const identityOption = await fs.readFile(new URL("../web/src/components/IdentityOption.tsx", import.meta.url), "utf8");
  const recipient = await fs.readFile(new URL("../web/src/locus/RecipientTypeMenu.tsx", import.meta.url), "utf8");
  const connect = await fs.readFile(new URL("../web/src/session/ConnectDialog.tsx", import.meta.url), "utf8");
  const account = await fs.readFile(new URL("../web/src/components/AccountMenu.tsx", import.meta.url), "utf8");
  const styles = await fs.readFile(new URL("../web/src/styles/identity-icons.css", import.meta.url), "utf8");
  const baseStyles = await fs.readFile(new URL("../web/src/styles.css", import.meta.url), "utf8");
  const solana = await fs.readFile(new URL("../web/src/assets/brands/solana.svg", import.meta.url), "utf8");

  for (const kind of ["matrix", "telegram", "github", "polkadot", "solana", "email", "evm", "locus"]) {
    assert.match(identity, new RegExp(`case "${kind}"`), `${kind} identity icon is mapped`);
    assert.match(recipient, new RegExp(`"${kind}"`), `${kind} recipient is available`);
  }
  assert.doesNotMatch(identity, /SiEthereum/);
  assert.doesNotMatch(connect, /SiEthereum/);
  assert.match(connect, /IdentityOption/);
  assert.match(recipient, /IdentityOption/);
  assert.match(connect, /identity-option-row--comfortable/);
  assert.match(recipient, /identity-option-row--compact/);
  assert.match(identityOption, /IdentityIcon kind=\{kind\}/);
  assert.match(identityOption, /variant: IdentityOptionVariant/);
  assert.match(identityOption, /identity-icon-slot/);
  assert.match(identityOption, /trailing === "arrow"/);
  assert.match(identityOption, /trailing === "check"/);
  assert.match(account, /IdentityIcon kind=\{session\.kind\}/);
  assert.doesNotMatch(account, /wallet-mark/);
  assert.match(identity, /case "evm":[\s\S]*evm-address-glyph/);
  assert.match(identity, />0x<\/span>/);
  assert.match(identity, /import solanaMark from "\.\.\/assets\/brands\/solana\.svg"/);
  assert.match(solana, /linearGradient[\s\S]*#9945FF[\s\S]*#19FB9B/);
  assert.match(recipient, /data-selected=\{selected \? "true"/);
  assert.doesNotMatch(recipient, /type-icon|wallet-mark/);
  assert.match(styles, /\.identity-icon-slot\s*\{[\s\S]*width: 32px/);
  assert.match(styles, /--brand-matrix: #111111/);
  assert.match(styles, /--brand-matrix: #f5f5f5/);
  assert.match(styles, /--brand-telegram: #26a5e4/);
  assert.match(styles, /--brand-github: #181717/);
  assert.match(styles, /--brand-github: #f0f6fc/);
  assert.match(styles, /--brand-polkadot: #e6007a/);
  assert.match(styles, /overflow-y: auto/);
  assert.match(styles, /\.identity-option-row\[data-selected="true"\]/);
  assert.match(styles, /identity-option-copy\[data-disabled="true"\]/);
  assert.match(styles, /@media \(hover: hover\) and \(pointer: fine\)/);
  assert.match(styles, /\.identity-option-row:not\(\[data-disabled\]\):hover/);
  assert.doesNotMatch(styles, /connect-option\.connect-option/);
  assert.doesNotMatch(baseStyles, /\.type-icon(?:\.|\s|\{)/);
});
