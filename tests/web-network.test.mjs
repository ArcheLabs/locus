import assert from "node:assert/strict";
import fs from "node:fs/promises";
import test from "node:test";
import { formatUnits, parseUnits, evmOwnership, polkadotOwnership, solanaOwnership, formatLocusId, parseLocusId } from "../dist/sdk/index.js";
import { encodeAddress } from "@polkadot/util-crypto";
import { selectNetwork } from "../web/src/network/selection.ts";
import { queryMatrixKeys } from "../web/src/matrix/MatrixKeysQuery.ts";
import { beginMatrixOAuth, commitMatrixDeviceId, commitMatrixSessionAfterCryptoSetup, completeMatrixAuthCallback, discoverMatrixAuthMetadata, matrixDeviceId, persistMatrixSession, refreshMatrixOAuthToken, revokeMatrixOAuthSession } from "../web/src/matrix/MatrixOAuth.ts";
import { describeMatrixCause, matrixCryptoStageFailure } from "../web/src/matrix/MatrixErrors.ts";
import { createHash } from "node:crypto";

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

test("network deployment does not silently configure Testnet as Local", async () => {
  const config = JSON.parse(await fs.readFile(new URL("../web/public/locus-networks.json", import.meta.url), "utf8"));
  assert.equal(config.networks.local.backendUrl, "http://127.0.0.1:8090");
  assert.equal(config.networks.testnet.backendUrl, null);
  assert.equal(config.networks.testnet.deploymentUrl, null);
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
    await beginMatrixOAuth("https://example.org", "@alice:example.org");
    assert.equal(assigned.length, 1);
    const authorization = new URL(assigned[0]);
    const flow = JSON.parse(window.sessionStorage.getItem("locus.matrix.oauth-flow.v1"));
    assert.equal(authorization.searchParams.get("response_type"), "code");
    assert.equal(authorization.searchParams.get("client_id"), "locus-test-client");
    assert.equal(authorization.searchParams.get("response_mode"), "fragment");
    assert.equal(authorization.searchParams.get("code_challenge_method"), "S256");
    assert.equal(authorization.searchParams.get("state"), flow.state);
    assert.equal(authorization.searchParams.get("scope"), `urn:matrix:client:api:* urn:matrix:client:device:${flow.deviceId}`);
    assert.equal(authorization.searchParams.get("code_challenge"), createHash("sha256").update(flow.verifier).digest("base64url"));
    assert.deepEqual(registrations[0].redirect_uris, ["https://locus.example/app"]);
    assert.equal(registrations[0].client_uri, "https://locus.example/");
    const deviceKey = "locus.matrix.device.v1.https://example.org|@alice:example.org";
    assert.equal(window.sessionStorage.getItem(deviceKey), flow.deviceId);
    assert.equal(window.localStorage.getItem(deviceKey), null, "a device ID is provisional until crypto setup succeeds");
    window.location.href = "http://127.0.0.1:5173/";
    await assert.rejects(beginMatrixOAuth("https://example.org", "@alice:example.org"), /requires Locus to be opened over HTTPS/);
    assert.equal(registrations.length, 1, "insecure previews must not register an invalid web client");
  } finally {
    globalThis.window = originalWindow;
    globalThis.fetch = originalFetch;
  }
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
    assert.match(String(calls.find(({ url }) => url === flow.revocationEndpoint).init.body), /refresh-1/);
  } finally {
    globalThis.window = originalWindow;
    globalThis.fetch = originalFetch;
  }
});

test("Matrix device IDs stay pending in session storage until the crypto setup commit", () => {
  const storage = () => {
    const entries = new Map();
    return { getItem: (key) => entries.get(key) ?? null, setItem: (key, value) => entries.set(key, String(value)), removeItem: (key) => entries.delete(key) };
  };
  const originalWindow = globalThis.window;
  globalThis.window = { localStorage: storage(), sessionStorage: storage() };
  try {
    const deviceId = matrixDeviceId("https://example.org", "@alice:example.org");
    const key = "locus.matrix.device.v1.https://example.org|@alice:example.org";
    assert.equal(window.localStorage.getItem(key), null);
    assert.equal(window.sessionStorage.getItem(key), deviceId);
    assert.equal(matrixDeviceId("https://example.org", "@alice:example.org"), deviceId);
    commitMatrixDeviceId("https://example.org", "@alice:example.org", deviceId);
    assert.equal(window.localStorage.getItem(key), deviceId);
    assert.equal(window.sessionStorage.getItem(key), null);
  } finally { globalThis.window = originalWindow; }
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
  assert.match(connect, /IdentityIcon kind=\{entry\.kind\}/);
  assert.match(account, /IdentityIcon kind=\{session\.kind\}/);
  assert.doesNotMatch(account, /wallet-mark/);
  assert.match(identity, /case "evm":[\s\S]*EvmAddressIcon/);
  assert.match(identity, /import solanaMark from "\.\.\/assets\/brands\/solana\.svg"/);
  assert.match(solana, /linearGradient[\s\S]*#9945FF[\s\S]*#19FB9B/);
  assert.match(recipient, /data-selected=\{selected \? "true"/);
  assert.match(recipient, /className="identity-icon-slot"/);
  assert.doesNotMatch(recipient, /type-icon|wallet-mark/);
  assert.match(styles, /\.identity-icon-slot\s*\{[\s\S]*width: 32px/);
  assert.match(styles, /--brand-matrix: #111111/);
  assert.match(styles, /--brand-matrix: #f5f5f5/);
  assert.match(styles, /--brand-telegram: #26a5e4/);
  assert.match(styles, /--brand-github: #181717/);
  assert.match(styles, /--brand-github: #f0f6fc/);
  assert.match(styles, /--brand-polkadot: #e6007a/);
  assert.match(styles, /overflow-y: auto/);
  assert.match(styles, /\.type-menu \.type-menu-item\[data-selected="true"\]/);
  assert.match(styles, /@media \(hover: hover\) and \(pointer: fine\)/);
  assert.match(styles, /\.connect-option\.connect-option:disabled\s*\{\s*opacity: 1/);
  assert.doesNotMatch(baseStyles, /\.type-icon(?:\.|\s|\{)/);
});
