import { readFile, stat } from "node:fs/promises";
import { validateMatrixMasterKey, TUWUNEL_ORIGIN } from "../apps/matrix-resolver/server.mjs";

const tokenPath = process.env.MATRIX_HOMESERVER_AS_TOKEN_FILE;
const testUserId = process.env.MATRIX_TEST_MXID;
const whoamiUrl = `${TUWUNEL_ORIGIN}/_matrix/client/v3/account/whoami`;
const keysQueryUrl = `${TUWUNEL_ORIGIN}/_matrix/client/v3/keys/query`;

function validUserId(value) {
  return typeof value === "string" && /^@[^:\s/]+:(?:\[[0-9A-Fa-f:.]+\]|[A-Za-z0-9.-]+)(?::[0-9]{1,5})?$/.test(value);
}

async function getToken() {
  if (!tokenPath) throw new Error("configuration");
  const metadata = await stat(tokenPath);
  if (!metadata.isFile() || (metadata.mode & 0o077) !== 0) throw new Error("configuration");
  const token = (await readFile(tokenPath, "utf8")).trim();
  if (token.length < 32 || /\s/.test(token)) throw new Error("configuration");
  return token;
}

async function json(url, options) {
  const response = await fetch(url, { ...options, redirect: "error", signal: AbortSignal.timeout(15_000) });
  if (!response.ok || response.redirected) throw new Error("request");
  return response.json();
}

async function main() {
  let whoamiPass = false;
  let keysQueryPass = false;
  try {
    if (!validUserId(testUserId)) throw new Error("configuration");
    const token = await getToken();
    const headers = { authorization: `Bearer ${token}`, "content-type": "application/json" };
    const whoami = await json(whoamiUrl, { method: "GET", headers });
    whoamiPass = whoami?.user_id === "@locus-resolver:matrix.minijam.xyz";
    if (!whoamiPass) throw new Error("whoami");
    const result = await json(keysQueryUrl, {
      method: "POST",
      headers,
      body: JSON.stringify({ device_keys: { [testUserId]: [] }, timeout: 10_000 }),
    });
    if (!result?.failures || Object.keys(result.failures).length === 0) {
      try {
        validateMatrixMasterKey(testUserId, result?.master_keys?.[testUserId]);
        keysQueryPass = true;
      } catch {
        keysQueryPass = false;
      }
    }
  } catch {
    // Print only gate results. Never print a token, remote response, or filesystem path.
  }
  console.log(`TUWUNEL_APPSERVICE_WHOAMI=${whoamiPass ? "PASS" : "FAIL"}`);
  console.log(`TUWUNEL_APPSERVICE_KEYS_QUERY=${keysQueryPass ? "PASS" : "FAIL"}`);
  if (!whoamiPass || !keysQueryPass) process.exitCode = 1;
}

await main();
