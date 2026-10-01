import { MatrixConnectorError } from "./MatrixErrors.ts";

const OAUTH_FLOW_KEY = "locus.matrix.oauth-flow.v1";
const SSO_FLOW_KEY = "locus.matrix.sso-flow.v1";
const DEVICE_KEY_PREFIX = "locus.matrix.device.v1.";
const MATRIX_SESSION_KEY = "locus.matrix.session.v1";

export type MatrixAuthMetadata = {
  issuer: string;
  authorization_endpoint: string;
  token_endpoint: string;
  registration_endpoint?: string;
  revocation_endpoint?: string;
  response_types_supported?: string[];
  grant_types_supported?: string[];
  response_modes_supported?: string[];
  code_challenge_methods_supported?: string[];
};

export type MatrixAuthCapabilities =
  | { mode: "oauth"; homeserver: string; metadata: MatrixAuthMetadata; sso: false; password: false }
  | { mode: "legacy"; homeserver: string; sso: boolean; password: boolean };

export type MatrixOAuthSession = {
  accessToken: string;
  refreshToken?: string;
  expiresAtMs?: number;
  userId: string;
  deviceId: string;
  homeserver: string;
  authType: "oauth" | "legacy";
  clientId?: string;
  tokenEndpoint?: string;
  revocationEndpoint?: string;
};

type OAuthFlow = {
  homeserver: string;
  clientId: string;
  deviceId: string;
  state: string;
  verifier: string;
  redirectUri: string;
  tokenEndpoint: string;
  revocationEndpoint?: string;
};

type LegacySsoFlow = { homeserver: string; deviceId: string; state: string; redirectUri: string };
type MatrixCallbackPayload = { search: string; hash: string };

declare global {
  interface Window {
    __locusMatrixAuthCallback?: {
      hasPending: () => boolean;
      take: () => MatrixCallbackPayload | null;
    };
  }
}

function matrixError(message: string, cause?: unknown): MatrixConnectorError {
  return new MatrixConnectorError("OAUTH_FAILED", message, cause === undefined ? undefined : { cause });
}

function randomUrlSafe(byteLength = 32): string {
  const bytes = crypto.getRandomValues(new Uint8Array(byteLength));
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function matrixDeviceId(): string {
  // This helper is for a new authentication flow only. A durable device ID is
  // reused exclusively by restoreMatrixSession after server/local key parity.
  // New sign-ins always receive a fresh ID so a deleted Matrix device cannot
  // be resurrected from an old IndexedDB store.
  const created = `LOCUS-${randomUrlSafe(18).replace(/[-_]/g, "").toUpperCase()}`;
  return created;
}

export function commitMatrixDeviceId(homeserver: string, userId: string, deviceId: string): void {
  if (!/^[A-Z0-9_-]{1,255}$/.test(deviceId)) throw matrixError("Matrix returned an invalid device ID; sign in again.");
  const key = `${DEVICE_KEY_PREFIX}${homeserver.replace(/\/$/, "")}|${userId}`;
  window.localStorage.setItem(key, deviceId);
  window.sessionStorage.removeItem(key);
}

export function committedMatrixDeviceId(homeserver: string, userId: string): string | null {
  const value = window.localStorage.getItem(`${DEVICE_KEY_PREFIX}${homeserver.replace(/\/$/, "")}|${userId}`);
  return value && /^[A-Z0-9_-]{1,255}$/.test(value) ? value : null;
}

export function clearMatrixDeviceId(homeserver: string, userId: string, expectedDeviceId?: string): void {
  const key = `${DEVICE_KEY_PREFIX}${homeserver.replace(/\/$/, "")}|${userId}`;
  if (expectedDeviceId === undefined || window.localStorage.getItem(key) === expectedDeviceId) window.localStorage.removeItem(key);
  window.sessionStorage.removeItem(key);
}

export function persistMatrixSession(stored: MatrixOAuthSession): void {
  window.localStorage.setItem(MATRIX_SESSION_KEY, JSON.stringify(stored));
}

export async function commitMatrixSessionAfterCryptoSetup<T>(stored: MatrixOAuthSession, setup: () => Promise<T>): Promise<T> {
  const result = await setup();
  commitMatrixDeviceId(stored.homeserver.replace(/\/$/, ""), stored.userId, stored.deviceId);
  persistMatrixSession(stored);
  return result;
}

function normalizedHomeserver(homeserver: string): string {
  return homeserver.replace(/\/$/, "");
}

async function responseError(response: Response): Promise<{ errcode?: string; error?: string }> {
  return response.json().catch(() => ({})) as Promise<{ errcode?: string; error?: string }>;
}

function validateOAuthMetadata(metadata: Partial<MatrixAuthMetadata>): MatrixAuthMetadata {
  if (!metadata.issuer || !metadata.authorization_endpoint || !metadata.token_endpoint) {
    throw matrixError("The homeserver returned incomplete Matrix OAuth metadata.");
  }
  if (!metadata.registration_endpoint || !metadata.revocation_endpoint) throw matrixError("The Matrix OAuth service is missing client registration or token revocation support.");
  if (!metadata.response_types_supported?.includes("code")) throw matrixError("This Matrix server does not support the authorization-code flow.");
  if (!metadata.grant_types_supported?.includes("authorization_code") || !metadata.grant_types_supported.includes("refresh_token")) throw matrixError("This Matrix server does not advertise authorization-code and refresh-token support.");
  if (!metadata.response_modes_supported?.includes("fragment")) throw matrixError("This Matrix server does not support the fragment callback required for secure web sign-in.");
  if (!metadata.code_challenge_methods_supported?.includes("S256")) throw matrixError("This Matrix server does not support PKCE S256.");
  return metadata as MatrixAuthMetadata;
}

export async function discoverMatrixAuthCapabilities(homeserver: string): Promise<MatrixAuthCapabilities> {
  const server = normalizedHomeserver(homeserver);
  let response: Response;
  try {
    response = await fetch(`${server}/_matrix/client/v1/auth_metadata`, { headers: { accept: "application/json" } });
  } catch (cause) {
    throw matrixError("Could not reach Matrix authentication metadata. Check the homeserver URL and try again.", cause);
  }
  if (response.status === 200) {
    let metadata: Partial<MatrixAuthMetadata>;
    try { metadata = await response.json() as Partial<MatrixAuthMetadata>; }
    catch (cause) { throw matrixError("The homeserver returned invalid Matrix OAuth metadata.", cause); }
    // A homeserver advertising OAuth is an OAuth login path. Runtime failures
    // must stay OAuth failures; they do not imply that legacy auth is usable.
    return { mode: "oauth", homeserver: server, metadata: validateOAuthMetadata(metadata), sso: false, password: false };
  }
  const metadataError = await responseError(response);
  if (response.status !== 404 || metadataError.errcode !== "M_UNRECOGNIZED") {
    throw matrixError(metadataError.error || `Matrix authentication discovery failed (HTTP ${response.status}${metadataError.errcode ? `, ${metadataError.errcode}` : ""}).`);
  }

  let loginResponse: Response;
  try {
    loginResponse = await fetch(`${server}/_matrix/client/v3/login`, { headers: { accept: "application/json" } });
  } catch (cause) {
    throw matrixError("Could not discover legacy Matrix login methods.", cause);
  }
  if (!loginResponse.ok) {
    const loginError = await responseError(loginResponse);
    if (loginResponse.status === 404 && loginError.errcode === "M_UNRECOGNIZED") {
      return { mode: "legacy", homeserver: server, sso: false, password: false };
    }
    throw matrixError(loginError.error || `Legacy Matrix login discovery failed (HTTP ${loginResponse.status}${loginError.errcode ? `, ${loginError.errcode}` : ""}).`);
  }
  let login: { flows?: Array<{ type?: unknown }> };
  try { login = await loginResponse.json() as { flows?: Array<{ type?: unknown }> }; }
  catch (cause) { throw matrixError("The homeserver returned invalid legacy Matrix login flows.", cause); }
  const flowTypes = new Set((login.flows ?? []).map((flow) => flow.type).filter((type): type is string => typeof type === "string"));
  return { mode: "legacy", homeserver: server, sso: flowTypes.has("m.login.sso"), password: flowTypes.has("m.login.password") };
}

/** Compatibility helper for callers that only need to check OAuth metadata. */
export async function discoverMatrixAuthMetadata(homeserver: string): Promise<MatrixAuthMetadata | null> {
  const capabilities = await discoverMatrixAuthCapabilities(homeserver);
  return capabilities.mode === "oauth" ? capabilities.metadata : null;
}

function redirectUri(): string {
  const url = new URL(window.location.href);
  url.search = "";
  url.hash = "";
  return url.toString();
}

export function hasMatrixAuthCallback(): boolean {
  if (window.__locusMatrixAuthCallback?.hasPending()) return true;
  const url = new URL(window.location.href);
  const fragment = new URLSearchParams(url.hash.replace(/^#/, ""));
  return ["code", "loginToken", "matrix_sso_state", "error"].some((key) => url.searchParams.has(key) || fragment.has(key));
}

function clearAuthCallbackUrl(): void {
  const cleanUrl = new URL(window.location.href);
  cleanUrl.search = "";
  cleanUrl.hash = "";
  window.history.replaceState(window.history.state, "", cleanUrl.toString());
}

function matrixWebClientUris(): { clientUri: string; redirectUri: string } {
  const callback = new URL(redirectUri());
  if (callback.protocol !== "https:") {
    throw matrixError("Matrix OAuth web sign-in requires Locus to be opened over HTTPS. Open the HTTPS Locus site and start Matrix sign-in again.");
  }
  return { clientUri: new URL("/", callback.origin).toString(), redirectUri: callback.toString() };
}

export async function beginMatrixOAuth(homeserver: string, discovered?: MatrixAuthCapabilities): Promise<void> {
  const capabilities = discovered ?? await discoverMatrixAuthCapabilities(homeserver);
  if (capabilities.mode !== "oauth" || capabilities.homeserver !== normalizedHomeserver(homeserver)) {
    throw matrixError("Matrix OAuth is not advertised by this homeserver.");
  }
  const metadata = capabilities.metadata;
  const deviceId = matrixDeviceId();
  const { clientUri, redirectUri: uri } = matrixWebClientUris();
  let registration: Response;
  try {
    registration = await fetch(metadata.registration_endpoint!, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({
        client_name: "Locus",
        client_uri: clientUri,
        application_type: "web",
        redirect_uris: [uri],
        grant_types: ["authorization_code", "refresh_token"],
        response_types: ["code"],
        token_endpoint_auth_method: "none",
      }),
    });
  } catch (cause) { throw matrixError("Could not register Locus with the Matrix authentication service.", cause); }
  const registered = await registration.json().catch(() => ({})) as { client_id?: string; error?: string; error_description?: string };
  if (!registration.ok || typeof registered.client_id !== "string") {
    throw matrixError(registered.error_description || `Matrix OAuth client registration failed (HTTP ${registration.status}).`);
  }
  const state = randomUrlSafe();
  const verifier = randomUrlSafe(48);
  const challenge = base64Url(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier))));
  const flow: OAuthFlow = {
    homeserver,
    clientId: registered.client_id,
    deviceId,
    state,
    verifier,
    redirectUri: uri,
    tokenEndpoint: metadata.token_endpoint,
    revocationEndpoint: metadata.revocation_endpoint,
  };
  window.sessionStorage.setItem(OAUTH_FLOW_KEY, JSON.stringify(flow));
  const authorization = new URL(metadata.authorization_endpoint);
  authorization.searchParams.set("response_type", "code");
  authorization.searchParams.set("client_id", flow.clientId);
  authorization.searchParams.set("redirect_uri", uri);
  authorization.searchParams.set("scope", `urn:matrix:client:api:* urn:matrix:client:device:${deviceId}`);
  authorization.searchParams.set("state", state);
  authorization.searchParams.set("response_mode", "fragment");
  authorization.searchParams.set("code_challenge", challenge);
  authorization.searchParams.set("code_challenge_method", "S256");
  window.location.assign(authorization.toString());
}

export async function beginMatrixSso(homeserver: string, capabilities: MatrixAuthCapabilities): Promise<void> {
  if (capabilities.mode !== "legacy" || !capabilities.sso || capabilities.homeserver !== normalizedHomeserver(homeserver)) {
    throw matrixError("This homeserver has not advertised Matrix SSO login.");
  }
  const deviceId = matrixDeviceId();
  const state = randomUrlSafe();
  const uri = new URL(redirectUri());
  uri.searchParams.set("matrix_sso_state", state);
  window.sessionStorage.setItem(SSO_FLOW_KEY, JSON.stringify({ homeserver, deviceId, state, redirectUri: uri.toString() } satisfies LegacySsoFlow));
  const sso = new URL(`${homeserver.replace(/\/$/, "")}/_matrix/client/v3/login/sso/redirect`);
  sso.searchParams.set("redirectUrl", uri.toString());
  window.location.assign(sso.toString());
}

async function parseTokenResponse(response: Response, context: string): Promise<{ access_token?: string; refresh_token?: string; expires_in?: number; error?: string; error_description?: string }> {
  const payload = await response.json().catch(() => ({})) as { access_token?: string; refresh_token?: string; expires_in?: number; error?: string; error_description?: string };
  if (!response.ok || typeof payload.access_token !== "string") {
    if (context.toLowerCase().includes("refresh") && payload.error === "invalid_grant") {
      throw new MatrixConnectorError("MATRIX_SESSION_INVALID", "The Matrix session is no longer valid. Sign in again.");
    }
    throw matrixError(payload.error_description || `${context} failed (HTTP ${response.status}${payload.error ? `, ${payload.error}` : ""}).`);
  }
  return payload;
}

async function whoAmI(homeserver: string, accessToken: string): Promise<string> {
  const response = await fetch(`${homeserver.replace(/\/$/, "")}/_matrix/client/v3/account/whoami`, { headers: { authorization: `Bearer ${accessToken}` } });
  const payload = await response.json().catch(() => ({})) as { user_id?: string };
  if (!response.ok || !payload.user_id) throw matrixError("Matrix accepted the login but could not confirm the account identity.");
  return payload.user_id;
}

export async function completeMatrixAuthCallback(): Promise<MatrixOAuthSession | null> {
  const captured = window.__locusMatrixAuthCallback?.take();
  const url = captured
    ? new URL(`${window.location.origin}${window.location.pathname}${captured.search}${captured.hash}`)
    : new URL(window.location.href);
  const fragment = new URLSearchParams(url.hash.replace(/^#/, ""));
  const oauthCode = url.searchParams.get("code") ?? fragment.get("code");
  const oauthState = url.searchParams.get("state") ?? fragment.get("state");
  const oauthError = url.searchParams.get("error") ?? fragment.get("error");
  const oauthErrorDescription = url.searchParams.get("error_description") ?? fragment.get("error_description");
  const ssoState = url.searchParams.get("matrix_sso_state");
  const loginToken = url.searchParams.get("loginToken") ?? new URLSearchParams(url.hash.replace(/^#/, "")).get("loginToken");
  if (oauthCode || oauthState || oauthError) {
    // The authorization code arrives in the fragment. Remove it before any
    // network await so Locus callbacks and later page diagnostics do not keep
    // the one-time code in the address bar.
    clearAuthCallbackUrl();
    const raw = window.sessionStorage.getItem(OAUTH_FLOW_KEY);
    if (!raw) throw matrixError("Matrix OAuth callback has no matching sign-in request. Start sign-in again.");
    window.sessionStorage.removeItem(OAUTH_FLOW_KEY);
    const flow = JSON.parse(raw) as OAuthFlow;
    if (oauthError) throw matrixError(`Matrix sign-in was not completed: ${oauthError}${oauthErrorDescription ? ` — ${oauthErrorDescription}` : ""}.`);
    if (!oauthCode || oauthState !== flow.state) throw matrixError("Matrix OAuth state did not match. Start sign-in again.");
    const response = await fetch(flow.tokenEndpoint, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
      body: new URLSearchParams({ grant_type: "authorization_code", code: oauthCode, redirect_uri: flow.redirectUri, client_id: flow.clientId, code_verifier: flow.verifier }),
    });
    const tokens = await parseTokenResponse(response, "Matrix OAuth token exchange");
    const userId = await whoAmI(flow.homeserver, tokens.access_token!);
    const stored: MatrixOAuthSession = {
      accessToken: tokens.access_token!, refreshToken: tokens.refresh_token,
      expiresAtMs: typeof tokens.expires_in === "number" ? Date.now() + tokens.expires_in * 1000 : undefined,
      userId, deviceId: flow.deviceId, homeserver: flow.homeserver, authType: "oauth", clientId: flow.clientId,
      tokenEndpoint: flow.tokenEndpoint, revocationEndpoint: flow.revocationEndpoint,
    };
    return stored;
  }
  if (loginToken || ssoState) {
    clearAuthCallbackUrl();
    const raw = window.sessionStorage.getItem(SSO_FLOW_KEY);
    if (!raw) throw matrixError("Matrix SSO callback has no matching sign-in request. Start sign-in again.");
    const flow = JSON.parse(raw) as LegacySsoFlow;
    if (!loginToken || ssoState !== flow.state) throw matrixError("Matrix SSO state did not match. Start sign-in again.");
    window.sessionStorage.removeItem(SSO_FLOW_KEY);
    const response = await fetch(`${flow.homeserver.replace(/\/$/, "")}/_matrix/client/v3/login`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ type: "m.login.token", token: loginToken, device_id: flow.deviceId, initial_device_display_name: "Locus", refresh_token: true }),
    });
    const payload = await response.json().catch(() => ({})) as { access_token?: string; refresh_token?: string; expires_in_ms?: number; user_id?: string; device_id?: string };
    if (!response.ok || !payload.access_token || !payload.user_id || !payload.device_id) throw matrixError(`Matrix SSO login failed (HTTP ${response.status}).`);
    const stored: MatrixOAuthSession = { accessToken: payload.access_token, refreshToken: payload.refresh_token, expiresAtMs: typeof payload.expires_in_ms === "number" ? Date.now() + payload.expires_in_ms : undefined, userId: payload.user_id, deviceId: payload.device_id, homeserver: flow.homeserver, authType: "legacy" };
    return stored;
  }
  return null;
}

export async function refreshMatrixOAuthToken(stored: MatrixOAuthSession, persist = true): Promise<void> {
  if (!stored.refreshToken || !stored.tokenEndpoint || !stored.clientId) throw matrixError("The Matrix session cannot be refreshed; sign in again.");
  const response = await fetch(stored.tokenEndpoint, {
    method: "POST", headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
    body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: stored.refreshToken, client_id: stored.clientId }),
  });
  const tokens = await parseTokenResponse(response, "Matrix OAuth refresh");
  stored.accessToken = tokens.access_token!;
  if (tokens.refresh_token) stored.refreshToken = tokens.refresh_token;
  if (typeof tokens.expires_in === "number") stored.expiresAtMs = Date.now() + tokens.expires_in * 1000;
  if (persist) persistMatrixSession(stored);
}

export async function revokeMatrixOAuthSession(stored: MatrixOAuthSession, clearLocal = true): Promise<void> {
  const failures: string[] = [];
  try {
    const response = await fetch(`${stored.homeserver.replace(/\/$/, "")}/_matrix/client/v3/logout`, {
      method: "POST", headers: { authorization: `Bearer ${stored.accessToken}` },
    });
    if (!response.ok) {
      const payload = await response.clone().json().catch(() => ({})) as { errcode?: unknown };
      const alreadyLoggedOut = response.status === 401
        || payload.errcode === "M_UNKNOWN_TOKEN"
        || payload.errcode === "M_MISSING_TOKEN";
      if (!alreadyLoggedOut) failures.push(`Matrix device logout failed (HTTP ${response.status})`);
    }
  } catch (cause) { failures.push(`Matrix device logout failed: ${cause instanceof Error ? cause.message : "network error"}`); }

  if (stored.authType === "oauth" && stored.revocationEndpoint && stored.refreshToken && stored.clientId) {
    try {
      const response = await fetch(stored.revocationEndpoint, {
        method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ token: stored.refreshToken, token_type_hint: "refresh_token", client_id: stored.clientId }),
      });
      if (!response.ok) failures.push(`Matrix OAuth token revocation failed (HTTP ${response.status})`);
    } catch (cause) { failures.push(`Matrix OAuth token revocation failed: ${cause instanceof Error ? cause.message : "network error"}`); }
  }

  if (clearLocal) {
    window.localStorage.removeItem(MATRIX_SESSION_KEY);
    window.sessionStorage.removeItem(MATRIX_SESSION_KEY);
  }
  if (failures.length) throw matrixError(`${failures.join("; ")}. This browser was signed out locally.`);
}
