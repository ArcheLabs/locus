import { createClient, type MatrixClient } from "matrix-js-sdk";
import { MatrixConnectorError } from "./MatrixErrors.ts";
import { matrixDeviceId, type MatrixOAuthSession } from "./MatrixOAuth.ts";

type PasswordLoginClient = Pick<MatrixClient, "loginRequest" | "stopClient">;
type PasswordClientFactory = (options: { baseUrl: string }) => PasswordLoginClient;

function classifyLoginFailure(cause: unknown): MatrixConnectorError {
  if (cause instanceof MatrixConnectorError) return cause;
  const candidate = cause as { errcode?: unknown; httpStatus?: unknown; statusCode?: unknown } | null;
  const status = typeof candidate?.httpStatus === "number"
    ? candidate.httpStatus
    : typeof candidate?.statusCode === "number" ? candidate.statusCode : undefined;
  const errcode = typeof candidate?.errcode === "string" ? candidate.errcode : "";
  if (status === 401 || status === 403 || errcode === "M_FORBIDDEN" || errcode === "M_UNKNOWN_TOKEN") {
    return new MatrixConnectorError("INVALID_LOGIN", "Matrix login was rejected", { cause });
  }
  return new MatrixConnectorError("HOMESERVER_UNAVAILABLE", "Unable to reach or initialize the Matrix homeserver", { cause });
}

/** Authenticate against the already selected server; the login response supplies the identity. */
export async function authenticateMatrixPassword(
  homeserver: string,
  userId: string,
  password: string,
  createLoginClient: PasswordClientFactory = createClient,
): Promise<MatrixOAuthSession> {
  const selectedHomeserver = homeserver.replace(/\/+$/, "");
  let loginClient: PasswordLoginClient;
  try {
    loginClient = createLoginClient({ baseUrl: selectedHomeserver });
  } catch (cause) {
    throw new MatrixConnectorError("HOMESERVER_UNAVAILABLE", "Unable to initialize Matrix homeserver client", { cause });
  }
  let login: Awaited<ReturnType<MatrixClient["loginRequest"]>>;
  try {
    const deviceId = matrixDeviceId();
    login = await loginClient.loginRequest({
      type: "m.login.password",
      identifier: { type: "m.id.user", user: userId },
      password,
      device_id: deviceId,
      initial_device_display_name: "Locus",
      refresh_token: true,
    });
  } catch (cause) {
    throw classifyLoginFailure(cause);
  } finally {
    loginClient.stopClient();
  }
  return {
    accessToken: login.access_token,
    refreshToken: login.refresh_token,
    expiresAtMs: typeof login.expires_in_ms === "number" ? Date.now() + login.expires_in_ms : undefined,
    userId: login.user_id,
    deviceId: login.device_id,
    homeserver: selectedHomeserver,
    authType: "legacy",
  };
}
