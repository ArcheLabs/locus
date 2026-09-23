import { MatrixConnectorError } from "./MatrixErrors.ts";

const OAUTH_FLOW_KEY = "locus.matrix.oauth-flow.v1";
const SSO_FLOW_KEY = "locus.matrix.sso-flow.v1";
const DEVICE_KEY_PREFIX = "locus.matrix.device.v1.";

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

export function matrixDeviceId(homeserver: string, userId: string): string {
  const key = `${DEVICE_KEY_PREFIX}${homeserver}|${userId}`;
  const existing = window.localStorage.getItem(key);
  if (existing && /^[A-Z0-9_-]{1,255}$/.test(existing)) return existing;
  const oldSessionDeviceId = window.sessionStorage.getItem(key);
  if (oldSessionDeviceId && /^[A-Z0-9_-]{1,255}$/.test(oldSessionDeviceId)) {
    window.localStorage.setItem(key, oldSessionDeviceId);
    return oldSessionDeviceId;
  }
  const created = `LOCUS-${randomUrlSafe(18).replace(/[-_]/g, "").toUpperCase()}`;
  window.localStorage.setItem(key, created);
  return created;
}

export async function discoverMatrixAuthMetadata(homeserver: string): Promise<MatrixAuthMetadata | null> {
  let response: Response;
  try {
    response = await fetch(`${homeserver.replace(/\/$/, "")}/_matrix/client/v1/auth_metadata`, { headers: { accept: "application/json" } });
  } catch (cause) {
    throw matrixError("Could not reach Matrix authentication metadata. Check the homeserver URL and try again.", cause);
  }
  if (response.status === 404) return null;
  if (!response.ok) throw matrixError(`Matrix authentication discovery failed (HTTP ${response.status}).`);
  const metadata = await response.json() as Partial<MatrixAuthMetadata>;
  if (!metadata.issuer || !metadata.authorization_endpoint || !metadata.token_endpoint) {
    throw matrixError("The homeserver returned incomplete Matrix OAuth metadata.");
  }
  if (!metadata.registration_endpoint || !metadata.revocation_endpoint) throw matrixError("The Matrix OAuth service is missing client registration or token revocation support.");
  if (!metadata.response_types_supported?.includes("code")) throw matrixError("This Matrix server does not support the authorization-code flow.");
  if (!metadata.grant_types_supported?.includes("authorization_code") || !metadata.grant_types_supported.includes("refresh_token")) throw matrixError("This Matrix server does not advertise authorization-code and refresh-token support.");
  if (!metadata.response_modes_supported?.includes("query")) throw matrixError("This Matrix server does not support the query callback needed for sign-in.");
  if (!metadata.code_challenge_methods_supported?.includes("S256")) throw matrixError("This Matrix server does not support PKCE S256.");
  return metadata as MatrixAuthMetadata;
}

function redirectUri(): string {
  const url = new URL(window.location.href);
  url.search = "";
  url.hash = "";
  return url.toString();
}

export async function beginMatrixOAuth(homeserver: string, userId: string): Promise<void> {
  const metadata = await discoverMatrixAuthMetadata(homeserver);
  if (!metadata) throw matrixError("OAuth is not available on this Matrix server. Choose Matrix SSO or the legacy password option.");
  if (!metadata.registration_endpoint) throw matrixError("This Matrix server does not advertise OAuth client registration.");
  const deviceId = matrixDeviceId(homeserver, userId);
  const uri = redirectUri();
  let registration: Response;
  try {
    registration = await fetch(metadata.registration_endpoint, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({
        client_name: "Locus",
        client_uri: window.location.origin,
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
  authorization.searchParams.set("response_mode", "query");
  authorization.searchParams.set("code_challenge", challenge);
  authorization.searchParams.set("code_challenge_method", "S256");
  window.location.assign(authorization.toString());
}

export async function beginMatrixSso(homeserver: string, userId: string): Promise<void> {
  const deviceId = matrixDeviceId(homeserver, userId);
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
  const url = new URL(window.location.href);
  const oauthCode = url.searchParams.get("code");
  const oauthState = url.searchParams.get("state");
  const oauthError = url.searchParams.get("error");
  const ssoState = url.searchParams.get("matrix_sso_state");
  const loginToken = url.searchParams.get("loginToken") ?? new URLSearchParams(url.hash.replace(/^#/, "")).get("loginToken");
  if (oauthCode || oauthState || oauthError) {
    const raw = window.sessionStorage.getItem(OAUTH_FLOW_KEY);
    if (!raw) throw matrixError("Matrix OAuth callback has no matching sign-in request. Start sign-in again.");
    window.sessionStorage.removeItem(OAUTH_FLOW_KEY);
    const flow = JSON.parse(raw) as OAuthFlow;
    if (oauthError) throw matrixError(`Matrix sign-in was not completed: ${oauthError}.`);
    if (!oauthCode || oauthState !== flow.state) throw matrixError("Matrix OAuth state did not match. Start sign-in again.");
    const response = await fetch(flow.tokenEndpoint, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
      body: new URLSearchParams({ grant_type: "authorization_code", code: oauthCode, redirect_uri: flow.redirectUri, client_id: flow.clientId, code_verifier: flow.verifier }),
    });
    const tokens = await parseTokenResponse(response, "Matrix OAuth token exchange");
    const userId = await whoAmI(flow.homeserver, tokens.access_token!);
    const cleanUrl = new URL(window.location.href);
    cleanUrl.search = "";
    cleanUrl.hash = "";
    window.history.replaceState({}, "", cleanUrl.toString());
    const stored: MatrixOAuthSession = {
      accessToken: tokens.access_token!, refreshToken: tokens.refresh_token,
      expiresAtMs: typeof tokens.expires_in === "number" ? Date.now() + tokens.expires_in * 1000 : undefined,
      userId, deviceId: flow.deviceId, homeserver: flow.homeserver, authType: "oauth", clientId: flow.clientId,
      tokenEndpoint: flow.tokenEndpoint, revocationEndpoint: flow.revocationEndpoint,
    };
    window.localStorage.setItem("locus.matrix.session.v1", JSON.stringify(stored));
    return stored;
  }
  if (loginToken || ssoState) {
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
    const cleanUrl = new URL(window.location.href);
    cleanUrl.search = "";
    cleanUrl.hash = "";
    window.history.replaceState({}, "", cleanUrl.toString());
    const stored: MatrixOAuthSession = { accessToken: payload.access_token, refreshToken: payload.refresh_token, expiresAtMs: typeof payload.expires_in_ms === "number" ? Date.now() + payload.expires_in_ms : undefined, userId: payload.user_id, deviceId: payload.device_id, homeserver: flow.homeserver, authType: "legacy" };
    window.localStorage.setItem("locus.matrix.session.v1", JSON.stringify(stored));
    return stored;
  }
  return null;
}

export async function refreshMatrixOAuthToken(stored: MatrixOAuthSession): Promise<void> {
  if (!stored.refreshToken || !stored.tokenEndpoint || !stored.clientId) throw matrixError("The Matrix session cannot be refreshed; sign in again.");
  const response = await fetch(stored.tokenEndpoint, {
    method: "POST", headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
    body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: stored.refreshToken, client_id: stored.clientId }),
  });
  const tokens = await parseTokenResponse(response, "Matrix OAuth refresh");
  stored.accessToken = tokens.access_token!;
  if (tokens.refresh_token) stored.refreshToken = tokens.refresh_token;
  if (typeof tokens.expires_in === "number") stored.expiresAtMs = Date.now() + tokens.expires_in * 1000;
  window.localStorage.setItem("locus.matrix.session.v1", JSON.stringify(stored));
}

export async function revokeMatrixOAuthSession(stored: MatrixOAuthSession): Promise<void> {
  if (stored.authType === "oauth" && stored.revocationEndpoint && stored.refreshToken && stored.clientId) {
    const response = await fetch(stored.revocationEndpoint, {
      method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ token: stored.refreshToken, token_type_hint: "refresh_token", client_id: stored.clientId }),
    });
    if (!response.ok) throw matrixError(`Matrix token revocation failed (HTTP ${response.status}); this browser was signed out locally.`);
  } else {
    const response = await fetch(`${stored.homeserver.replace(/\/$/, "")}/_matrix/client/v3/logout`, {
      method: "POST", headers: { authorization: `Bearer ${stored.accessToken}` },
    });
    if (!response.ok) throw matrixError(`Matrix sign-out failed (HTTP ${response.status}); this browser was signed out locally.`);
  }
  window.localStorage.removeItem("locus.matrix.session.v1");
}
