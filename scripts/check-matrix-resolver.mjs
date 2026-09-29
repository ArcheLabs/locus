import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");
const [server, client, clientRequest, app, networkConfig, compose, caddy] = await Promise.all([
  read("../apps/matrix-resolver/server.mjs"),
  read("../web/src/matrix/MatrixRecipientResolver.ts"),
  read("../web/src/matrix/MatrixRecipientRequest.mjs"),
  read("../web/src/app.tsx"),
  read("../web/public/locus-networks.json"),
  read("../ops/matrix/docker-compose.example.yml"),
  read("../ops/matrix/Caddyfile.example"),
]);

assert.match(server, /TUWUNEL_ORIGIN\s*=\s*"http:\/\/127\.0\.0\.1:8008"/);
assert.match(server, /MATRIX_HOMESERVER_AS_TOKEN_FILE/);
assert.match(server, /redirect:\s*"error"/);
assert.match(server, /MAX_REQUEST_BYTES\s*=\s*4096/);
assert.match(server, /MATRIX_QUERY_TIMEOUT_MS\s*=\s*10_000/);
assert.match(server, /HTTP_TIMEOUT_MS\s*=\s*15_000/);
assert.match(server, /validateMatrixMasterKey/);
assert.match(server, /matrixOwnership\(masterKey\)/);
assert.match(server, /formatLocusId\(owner\)/);
assert.match(server, /MATRIX_MASTER_KEY_CHANGED/);
assert.match(server, /tmp-\$\{process\.pid\}-\$\{\+\+temporaryFileCounter\}/);
assert.doesNotMatch(server, /homeserverFromUserId|discoverHomeserver|MATRIX_RESOLVER_ACCESS_TOKEN|accessToken\s*:/i);
assert.match(client, /resolverUrl\?/);
assert.doesNotMatch(client, /discoverHomeserver|accessToken/);
assert.match(clientRequest, /JSON\.stringify\(\{ userId \}\)/);
assert.match(clientRequest, /redirect:\s*"error"/);
assert.match(clientRequest, /credentials:\s*"omit"/);
assert.match(clientRequest, /mode:\s*"same-origin"/);
assert.doesNotMatch(clientRequest, /authorization\s*:/i);
const networkConfigDocument = JSON.parse(networkConfig);
assert.equal(networkConfigDocument.networks?.local?.matrixResolverUrl, undefined);
assert.equal(networkConfigDocument.networks?.testnet?.matrixResolverUrl, undefined);
assert.match(app, /MATRIX_RECIPIENT_DEBOUNCE_MS\s*=\s*400/);
assert.match(app, /new AbortController\(\)/);
assert.match(app, /controller\.abort\(\)/);
assert.match(app, /status === "key-changed"/);
assert.match(app, /network\.network\?\.matrixResolverUrl/);
assert.match(compose, /127\.0\.0\.1:8008:8008/);
assert.match(compose, /@sha256:[a-f0-9]{64}/);
assert.doesNotMatch(caddy, /\/_matrix\/client/);

console.log("MATRIX_RESOLVER_STATIC_BOUNDARY=PASS");
console.log("RECIPIENT_CONTROLLED_HTTP_TARGET=false");
console.log("CANONICAL_OWNERSHIP_ENCODING=PASS");
console.log("FRONTEND_MATRIX_RESOLVER_UNADVERTISED_UNTIL_CONFIGURED=PASS");
