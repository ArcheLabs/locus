import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { FetchRpcTransport, JamScriptClient, ownershipKey } from "@jamscript/client";
import { LocusClient, formatLocusId, formatUnits, parseLocusId } from "../../dist/sdk/index.js";
import { createCuratedRuntime } from "../curated/runtime.mjs";

const SCRIPT_DIRECTORY = path.dirname(fileURLToPath(import.meta.url));
const REPOSITORY_ROOT = path.resolve(SCRIPT_DIRECTORY, "../..");
export const DEFAULT_STATE_DIRECTORY = path.join(SCRIPT_DIRECTORY, "state");
const UINT128_MAX = (1n << 128n) - 1n;
const WAIT_OPTIONS = { intervalMs: 500, timeoutMs: 180_000 };

const retryableStatuses = new Set(["queued", "submitting", "failed", "pending"]);
const transferStatuses = new Set(["queued", "submitting", "pending", "applied", "failed", "unknown"]);

export class MatrixAirdropError extends Error {
  constructor(code, message = code, options) {
    super(message, options);
    this.name = "MatrixAirdropError";
    this.code = code;
  }
}

function own(record, key) {
  return Object.prototype.hasOwnProperty.call(record, key);
}

function hex(bytes) {
  return `0x${Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}

function parseAssetId(value) {
  if (typeof value !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(value)) {
    throw new MatrixAirdropError("INVALID_ASSET_ID", "--asset must be a 32-byte 0x-prefixed hex ID");
  }
  const bytes = Uint8Array.from(Buffer.from(value.slice(2), "hex"));
  if (bytes.every((byte) => byte === 0)) throw new MatrixAirdropError("INVALID_ASSET_ID", "--asset cannot be zero");
  return { bytes, normalized: value.toLowerCase() };
}

function parseAmount(value) {
  if (typeof value !== "string" || !/^\d+$/.test(value)) {
    throw new MatrixAirdropError("INVALID_AMOUNT", "--amount must be an integer in the asset's smallest units");
  }
  const amount = BigInt(value);
  if (amount < 1n || amount > UINT128_MAX) throw new MatrixAirdropError("INVALID_AMOUNT", "--amount must be between 1 and u128 max");
  return amount;
}

function validateRoomId(roomId) {
  if (typeof roomId !== "string" || /[\u0000-\u0020\u007f]/.test(roomId) || !/^![^:\s/]+:[^\s/]+$/.test(roomId)) {
    throw new MatrixAirdropError("INVALID_ROOM_ID", "--room must be a Matrix room ID such as !abc:matrix.example.org");
  }
  return roomId;
}

function isTransactionId(value) {
  return typeof value === "string" && /^0x[0-9a-fA-F]{64}$/.test(value);
}

function validateHttpsUrl(value, label, { allowLoopbackHttp = false } = {}) {
  let url;
  try { url = new URL(value); }
  catch { throw new MatrixAirdropError("INVALID_CONFIGURATION", `${label} must be an absolute HTTPS URL`); }
  const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if (url.protocol !== "https:" && !(allowLoopbackHttp && loopback && url.protocol === "http:")) {
    throw new MatrixAirdropError("INVALID_CONFIGURATION", `${label} must use HTTPS`);
  }
  if (url.username || url.password || url.search || url.hash) {
    throw new MatrixAirdropError("INVALID_CONFIGURATION", `${label} cannot contain credentials, query parameters, or a fragment`);
  }
  return url;
}

export function parseCommandLine(argv) {
  const [command, ...tokens] = argv;
  if (!command || !["sync", "status", "reset"].includes(command)) {
    throw new MatrixAirdropError("USAGE", "Usage: node scripts/matrix-airdrop/index.mjs <sync|status|reset> [options]");
  }
  const options = { command, retryUnknown: [] };
  const valueOptions = new Set(["room", "asset", "amount", "state", "resolver", "retry-unknown"]);
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (token === "--dry-run") { options.dryRun = true; continue; }
    if (token === "--reset-all") { options.resetAll = true; continue; }
    if (!token.startsWith("--") || !valueOptions.has(token.slice(2))) {
      throw new MatrixAirdropError("USAGE", `Unknown option: ${token}`);
    }
    const name = token.slice(2);
    const value = tokens[index + 1];
    if (!value || value.startsWith("--")) throw new MatrixAirdropError("USAGE", `${token} requires a value`);
    index += 1;
    if (name === "retry-unknown") options.retryUnknown.push(value);
    else options[name === "state" ? "stateDirectory" : name === "resolver" ? "resolverUrl" : name] = value;
  }
  if (command !== "sync" && (options.dryRun || options.retryUnknown.length > 0 || options.room || options.asset || options.amount || options.resolverUrl)) {
    throw new MatrixAirdropError("USAGE", `Options --room/--asset/--amount/--resolver/--dry-run/--retry-unknown are only valid for sync`);
  }
  if (command !== "reset" && options.resetAll) throw new MatrixAirdropError("USAGE", "--reset-all is only valid for reset");
  return options;
}

function statePaths(stateDirectory) {
  return {
    directory: path.resolve(stateDirectory ?? DEFAULT_STATE_DIRECTORY),
    members: path.join(path.resolve(stateDirectory ?? DEFAULT_STATE_DIRECTORY), "members.json"),
    transfers: path.join(path.resolve(stateDirectory ?? DEFAULT_STATE_DIRECTORY), "transfers.json"),
    lock: path.join(path.resolve(stateDirectory ?? DEFAULT_STATE_DIRECTORY), ".sync.lock"),
  };
}

async function ensurePrivateStateDirectory(directory) {
  await fs.mkdir(directory, { recursive: true, mode: 0o700 });
  const metadata = await fs.lstat(directory);
  if (!metadata.isDirectory() || metadata.isSymbolicLink()) {
    throw new MatrixAirdropError("STATE_DIRECTORY_INVALID", "State path must be a real directory, not a symlink");
  }
  if ((metadata.mode & 0o077) !== 0) {
    throw new MatrixAirdropError("STATE_DIRECTORY_PERMISSIONS", `State directory must have permissions 0700: ${directory}`);
  }
}

async function readJsonOptional(filePath) {
  try {
    const metadata = await fs.lstat(filePath);
    if (!metadata.isFile() || metadata.isSymbolicLink()) {
      throw new MatrixAirdropError("STATE_FILE_INVALID", `State file must be a regular file: ${path.basename(filePath)}`);
    }
    if ((metadata.mode & 0o077) !== 0) {
      throw new MatrixAirdropError("STATE_FILE_PERMISSIONS", `${path.basename(filePath)} must have permissions 0600`);
    }
    return JSON.parse(await fs.readFile(filePath, "utf8"));
  }
  catch (cause) {
    if (cause?.code === "ENOENT") return null;
    if (cause instanceof SyntaxError) throw new MatrixAirdropError("STATE_FILE_INVALID", `Invalid JSON state file: ${path.basename(filePath)}`);
    throw cause;
  }
}

async function writeJsonAtomic(filePath, value) {
  const directory = path.dirname(filePath);
  await ensurePrivateStateDirectory(directory);
  const temporary = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  let handle;
  try {
    handle = await fs.open(temporary, "wx", 0o600);
    await handle.writeFile(`${JSON.stringify(value, null, 2)}\n`, "utf8");
    await handle.sync();
    await handle.close();
    handle = null;
    await fs.rename(temporary, filePath);
    await fs.chmod(filePath, 0o600);
    const directoryHandle = await fs.open(directory, "r");
    try { await directoryHandle.sync(); } finally { await directoryHandle.close(); }
  } catch (cause) {
    await handle?.close().catch(() => {});
    await fs.rm(temporary, { force: true }).catch(() => {});
    throw cause;
  }
}

async function acquireSyncLock(lockPath) {
  await ensurePrivateStateDirectory(path.dirname(lockPath));
  let handle;
  try { handle = await fs.open(lockPath, "wx", 0o600); }
  catch (cause) {
    if (cause?.code === "EEXIST") throw new MatrixAirdropError("SYNC_ALREADY_RUNNING", `A sync lock exists at ${lockPath}; ensure no sync is active before removing it`);
    throw cause;
  }
  try {
    await handle.writeFile(`${JSON.stringify({ pid: process.pid, createdAt: new Date().toISOString() })}\n`);
    await handle.sync();
  } catch (cause) {
    await handle.close().catch(() => {});
    await fs.rm(lockPath, { force: true }).catch(() => {});
    throw cause;
  }
  let released = false;
  return async () => {
    if (released) return;
    released = true;
    try { await handle.close(); }
    finally { await fs.rm(lockPath, { force: true }); }
  };
}

function normalizeMembersState(value, roomId) {
  if (value === null) return { version: 1, roomId, updatedAt: null, members: {} };
  if (value.version !== 1 || value.roomId !== roomId || !value.members || typeof value.members !== "object" || Array.isArray(value.members)) {
    throw new MatrixAirdropError("STATE_SCOPE_MISMATCH", "members.json is invalid or belongs to a different room; choose another --state directory or reset it");
  }
  for (const [userId, record] of Object.entries(value.members)) {
    if (!isValidMatrixUserId(userId) || !record || typeof record !== "object"
        || typeof record.firstSeen !== "string" || !["joined", "left"].includes(record.status ?? "joined")) {
      throw new MatrixAirdropError("STATE_FILE_INVALID", "members.json contains an invalid membership record");
    }
  }
  return value;
}

function normalizeTransfersState(value, { roomId, assetId, amount }) {
  if (value === null) return { version: 1, roomId, assetId, amount: amount.toString(), updatedAt: null, transfers: {} };
  if (value.version !== 1 || !value.transfers || typeof value.transfers !== "object" || Array.isArray(value.transfers)) {
    throw new MatrixAirdropError("STATE_FILE_INVALID", "transfers.json has an unsupported format");
  }
  if (value.roomId !== roomId || value.assetId?.toLowerCase() !== assetId || value.amount !== amount.toString()) {
    throw new MatrixAirdropError("STATE_SCOPE_MISMATCH", "transfers.json belongs to a different room, asset, or amount; use another --state directory or reset transfers");
  }
  for (const record of Object.values(value.transfers)) {
    if (!record || typeof record !== "object" || !transferStatuses.has(record.status)) {
      throw new MatrixAirdropError("STATE_FILE_INVALID", "transfers.json contains an unsupported transfer status");
    }
    if (["pending", "applied"].includes(record.status) && !isTransactionId(record.transactionId)) {
      throw new MatrixAirdropError("STATE_FILE_INVALID", "A pending or applied transfer has an invalid transaction ID; inspect transfers.json before continuing");
    }
  }
  for (const [userId, record] of Object.entries(value.transfers)) {
    if (!isValidMatrixUserId(userId)) {
      throw new MatrixAirdropError("STATE_FILE_INVALID", "transfers.json contains an invalid Matrix user ID");
    }
    if (record.transactionId !== undefined && !isTransactionId(record.transactionId)) {
      throw new MatrixAirdropError("STATE_FILE_INVALID", "transfers.json contains an invalid transaction ID");
    }
  }
  return value;
}

function updateMembershipSnapshot(previous, userIds, timestamp) {
  const members = { ...previous.members };
  const current = new Set(userIds);
  const firstSeenDate = timestamp.slice(0, 10);
  for (const [userId, member] of Object.entries(members)) {
    const oldStatus = member.status ?? "joined";
    if (oldStatus === "joined" && !current.has(userId)) {
      members[userId] = { ...member, status: "left", leftAt: timestamp };
    }
  }
  for (const userId of userIds) {
    const existing = members[userId];
    members[userId] = {
      ...(existing ?? {}),
      firstSeen: existing?.firstSeen ?? firstSeenDate,
      lastSeen: timestamp,
      status: "joined",
    };
    delete members[userId].leftAt;
  }
  return { version: 1, roomId: previous.roomId, updatedAt: timestamp, members };
}

function currentRoomIds(membersState) {
  return Object.entries(membersState?.members ?? {})
    .filter(([, member]) => (member.status ?? "joined") === "joined")
    .map(([userId]) => userId);
}

export async function fetchJoinedMembers(roomId, env = process.env, fetchImpl = fetch) {
  const homeserver = validateHttpsUrl(env.MATRIX_HOMESERVER, "MATRIX_HOMESERVER", { allowLoopbackHttp: true }).toString().replace(/\/$/, "");
  const token = env.MATRIX_ACCESS_TOKEN;
  if (typeof token !== "string" || token.length === 0 || /\s/.test(token)) {
    throw new MatrixAirdropError("MATRIX_ACCESS_TOKEN_REQUIRED", "Set MATRIX_ACCESS_TOKEN for this run; it is not saved by the tool");
  }
  let response;
  try {
    response = await fetchImpl(`${homeserver}/_matrix/client/v3/rooms/${encodeURIComponent(roomId)}/joined_members`, {
      method: "GET",
      headers: { authorization: `Bearer ${token}`, accept: "application/json" },
      redirect: "error",
      signal: AbortSignal.timeout(20_000),
    });
  } catch (cause) {
    throw new MatrixAirdropError(cause?.name === "TimeoutError" || cause?.name === "AbortError" ? "MATRIX_QUERY_TIMEOUT" : "MATRIX_HOMESERVER_UNAVAILABLE", "Could not retrieve Matrix room membership");
  }
  if (response.redirected) throw new MatrixAirdropError("MATRIX_HOMESERVER_UNAVAILABLE", "Matrix room membership request was redirected");
  if (!response.ok) {
    if (response.status === 401 || response.status === 403) throw new MatrixAirdropError("MATRIX_ACCESS_TOKEN_INVALID", `Matrix rejected the access token (HTTP ${response.status})`);
    if (response.status === 429) throw new MatrixAirdropError("MATRIX_RATE_LIMITED", "Matrix rate-limited the membership request");
    throw new MatrixAirdropError("MATRIX_ROOM_MEMBERS_FAILED", `Matrix room membership request failed (HTTP ${response.status})`);
  }
  let payload;
  try { payload = await response.json(); }
  catch { throw new MatrixAirdropError("MATRIX_ROOM_MEMBERS_FAILED", "Matrix returned invalid room membership data"); }
  if (!payload?.joined || typeof payload.joined !== "object" || Array.isArray(payload.joined)) {
    throw new MatrixAirdropError("MATRIX_ROOM_MEMBERS_FAILED", "Matrix returned invalid room membership data");
  }
  const members = Object.keys(payload.joined).sort();
  for (const userId of members) {
    if (!isValidMatrixUserId(userId)) {
      throw new MatrixAirdropError("MATRIX_ROOM_MEMBERS_FAILED", "Matrix returned an invalid user ID in the room membership list");
    }
  }
  return members;
}

function isValidMatrixUserId(userId) {
  if (typeof userId !== "string" || /[\u0000-\u0020\u007f]/.test(userId)) return false;
  const match = /^@[^:\s/]+:(?:\[[0-9a-fA-F:.]+\]|[A-Za-z0-9.-]+)(?::([0-9]{1,5}))?$/.exec(userId);
  if (!match) return false;
  if (match[1] !== undefined) {
    const port = Number(match[1]);
    if (!Number.isInteger(port) || port < 1 || port > 65535) return false;
  }
  return true;
}

function matrixResolverEndpoint(env, optionUrl) {
  const base = optionUrl ?? env.LOCUS_MATRIX_RESOLVER_URL ?? "https://locus.minijam.xyz/matrix-resolver";
  const url = validateHttpsUrl(base, "Matrix resolver URL", { allowLoopbackHttp: true });
  url.pathname = url.pathname.replace(/\/+$/, "");
  if (!url.pathname.endsWith("/v1/resolve")) url.pathname = `${url.pathname}/v1/resolve`;
  return url.toString();
}

export async function resolveMatrixOwnership(userId, { env = process.env, resolverUrl, fetchImpl = fetch } = {}) {
  let response;
  try {
    response = await fetchImpl(matrixResolverEndpoint(env, resolverUrl), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ userId }),
      redirect: "error",
      signal: AbortSignal.timeout(20_000),
    });
  } catch (cause) {
    throw new MatrixAirdropError(cause?.name === "TimeoutError" || cause?.name === "AbortError" ? "RPC_TIMEOUT" : "MATRIX_HOMESERVER_UNAVAILABLE", "Could not reach the Matrix Ownership resolver");
  }
  if (response.redirected) throw new MatrixAirdropError("MATRIX_HOMESERVER_UNAVAILABLE", "Matrix Ownership resolver request was redirected");
  let payload;
  try { payload = await response.json(); }
  catch { throw new MatrixAirdropError("MATRIX_HOMESERVER_UNAVAILABLE", "Matrix Ownership resolver returned invalid data"); }
  if (!response.ok) {
    const code = typeof payload?.error === "string" && /^[A-Z][A-Z0-9_]{1,63}$/.test(payload.error)
      ? payload.error
      : response.status === 404 ? "MATRIX_CROSS_SIGNING_UNAVAILABLE" : "MATRIX_HOMESERVER_UNAVAILABLE";
    throw new MatrixAirdropError(code, code);
  }
  if (payload?.userId !== userId) throw new MatrixAirdropError("MATRIX_RESOLVER_RESPONSE_MISMATCH", "Resolver returned a different Matrix user");
  if (typeof payload?.ownership !== "string") throw new MatrixAirdropError("MATRIX_CROSS_SIGNING_UNAVAILABLE", "Resolver returned no Ownership");
  let owner;
  try { owner = parseLocusId(payload.ownership); }
  catch { throw new MatrixAirdropError("MATRIX_INVALID_OWNERSHIP", "Resolver returned an invalid Ownership"); }
  const ownershipId = formatLocusId(owner);
  if (ownershipId !== payload.ownership) throw new MatrixAirdropError("MATRIX_INVALID_OWNERSHIP", "Resolver returned a non-canonical Ownership");
  return { owner, ownershipId, ownershipKey: hex(ownershipKey(owner)) };
}

function ownershipFromRecord(record) {
  if (typeof record.ownershipId !== "string") return null;
  let owner;
  try { owner = parseLocusId(record.ownershipId); }
  catch { throw new MatrixAirdropError("STATE_OWNERSHIP_INVALID", "Saved Ownership is invalid; inspect transfers.json before continuing"); }
  const derivedKey = hex(ownershipKey(owner));
  if (record.ownershipKey && record.ownershipKey.toLowerCase() !== derivedKey.toLowerCase()) {
    throw new MatrixAirdropError("STATE_OWNERSHIP_MISMATCH", "Saved Ownership and ownershipKey do not match");
  }
  return { owner, ownershipId: formatLocusId(owner), ownershipKey: derivedKey };
}

function errorCode(cause, fallback = "ACTION_FAILED") {
  if (cause instanceof MatrixAirdropError) return cause.code;
  if (cause?.name === "TimeoutError" || cause?.name === "AbortError") return "RPC_TIMEOUT";
  if (typeof cause?.code === "string" && /^[A-Z][A-Z0-9_]{1,63}$/.test(cause.code)) return cause.code;
  if (/timed?\s*out|timeout/i.test(cause instanceof Error ? cause.message : "")) return "RPC_TIMEOUT";
  return fallback;
}

async function createReadOnlyRuntime(env = process.env) {
  const descriptorPath = path.resolve(env.LOCUS_CURATED_DEPLOYMENT ?? path.join(REPOSITORY_ROOT, "web/public/deployments/local.json"));
  let descriptor;
  try { descriptor = JSON.parse(await fs.readFile(descriptorPath, "utf8")); }
  catch { throw new MatrixAirdropError("LOCUS_DEPLOYMENT_UNAVAILABLE", "Could not load the selected Locus deployment descriptor"); }
  if (descriptor.network !== "local") throw new MatrixAirdropError("UNSUPPORTED_NETWORK", "Matrix room airdrops are currently restricted to the Local deployment");
  const backendRpc = env.LOCUS_CURATED_BACKEND_RPC ?? descriptor.backendUrl;
  if (typeof backendRpc !== "string" || !/^https?:\/\//.test(backendRpc)) {
    throw new MatrixAirdropError("LOCUS_BACKEND_REQUIRED", "Set LOCUS_CURATED_BACKEND_RPC to the trusted absolute backend RPC URL");
  }
  const protocolClient = new JamScriptClient(descriptor, new FetchRpcTransport(backendRpc));
  await protocolClient.validateDeployment();
  return { descriptor, protocolClient, locus: new LocusClient(protocolClient) };
}

async function createTreasuryRuntime(env = process.env) {
  if (!env.LOCUS_TREASURY_KEY_FILE) {
    throw new MatrixAirdropError("TREASURY_KEY_FILE_REQUIRED", "Set LOCUS_TREASURY_KEY_FILE to the protected Treasury key file");
  }
  return createCuratedRuntime("LOCUS_CURATED_TREASURY_SIGNER_MODULE", { requireTreasurySigner: true });
}

function assetDisplay(asset) {
  if (!asset) throw new MatrixAirdropError("ASSET_NOT_FOUND", "The selected Locus Asset does not exist on the configured deployment");
  const symbol = Buffer.from(asset.symbol).toString("utf8");
  if (!symbol || /[\u0000-\u001f\u007f]/.test(symbol) || !Number.isInteger(asset.decimals) || asset.decimals < 0 || asset.decimals > 38) {
    throw new MatrixAirdropError("ASSET_METADATA_INVALID", "The selected Locus Asset has invalid metadata");
  }
  return { symbol, decimals: asset.decimals };
}

function formatAggregateAmount(amount, decimals) {
  if (amount <= UINT128_MAX) return formatUnits(amount, decimals);
  if (decimals === 0) return amount.toString();
  const scale = 10n ** BigInt(decimals);
  const whole = amount / scale;
  const fraction = amount % scale;
  if (fraction === 0n) return whole.toString();
  return `${whole}.${fraction.toString().padStart(decimals, "0").replace(/0+$/, "")}`;
}

function newTransferRecord(timestamp) {
  return { status: "queued", createdAt: timestamp, updatedAt: timestamp };
}

async function updateAndSaveTransfer(doc, userId, patch, transfersPath, timestamp) {
  const old = doc.transfers[userId] ?? newTransferRecord(timestamp);
  doc.transfers[userId] = { ...old, ...patch, updatedAt: timestamp };
  doc.updatedAt = timestamp;
  await writeJsonAtomic(transfersPath, doc);
}

function print(output, line) { output(line); }

function safeTimestamp(now) {
  const value = now();
  return (value instanceof Date ? value : new Date(value)).toISOString();
}

export async function syncAirdrop(options, dependencies = {}) {
  const env = dependencies.env ?? process.env;
  const output = dependencies.output ?? console.log;
  const now = dependencies.now ?? (() => new Date());
  const fetchImpl = dependencies.fetchImpl ?? fetch;
  const roomId = validateRoomId(options.room);
  const { bytes: assetBytes, normalized: assetId } = parseAssetId(options.asset);
  const amount = parseAmount(options.amount);
  const paths = statePaths(options.stateDirectory);
  const dryRun = Boolean(options.dryRun);
  const releaseLock = dryRun ? null : await acquireSyncLock(paths.lock);

  try {
    const oldMembersState = normalizeMembersState(await readJsonOptional(paths.members), roomId);
    let transfersState = normalizeTransfersState(await readJsonOptional(paths.transfers), { roomId, assetId, amount });
    const oldMembers = oldMembersState.members;
    const currentIds = await (dependencies.fetchJoinedMembers ?? fetchJoinedMembers)(roomId, env, fetchImpl);
    if (!Array.isArray(currentIds) || currentIds.some((userId) => !isValidMatrixUserId(userId))) {
      throw new MatrixAirdropError("MATRIX_ROOM_MEMBERS_FAILED", "Matrix returned an invalid user ID in the room membership list");
    }
    const currentSet = new Set(currentIds);
    const knownSet = new Set(Object.keys(oldMembers));
    const newIds = currentIds.filter((userId) => !knownSet.has(userId));
    const alreadySeen = currentIds.filter((userId) => knownSet.has(userId));
    const removedIds = Object.entries(oldMembers)
      .filter(([userId, member]) => (member.status ?? "joined") === "joined" && !currentSet.has(userId))
      .map(([userId]) => userId);

    const retryUnknown = new Set(options.retryUnknown ?? []);
    for (const userId of retryUnknown) {
      if (transfersState.transfers[userId]?.status !== "unknown" && transfersState.transfers[userId]?.status !== "submitting") {
        throw new MatrixAirdropError("NOT_UNKNOWN_TRANSFER", `--retry-unknown was given for a member without an unknown transfer: ${userId}`);
      }
    }
    const candidates = new Set(newIds);
    for (const [userId, record] of Object.entries(transfersState.transfers)) {
      if (retryableStatuses.has(record.status) || retryUnknown.has(userId)) candidates.add(userId);
    }

    print(output, `Room: ${roomId}`);
    print(output, `Members: ${currentIds.length}`);
    print(output, `New: ${newIds.length}`);
    print(output, `Already seen: ${alreadySeen.length}`);
    print(output, `Removed: ${removedIds.length}`);

    if (!dryRun) {
      const timestamp = safeTimestamp(now);
      for (const userId of newIds) {
        const existing = transfersState.transfers[userId];
        if (!existing || existing.status !== "applied") {
          transfersState.transfers[userId] = existing ?? newTransferRecord(timestamp);
        }
      }
      for (const userId of retryUnknown) {
        const existing = transfersState.transfers[userId];
        transfersState.transfers[userId] = {
          ...existing,
          status: "failed",
          error: "SUBMISSION_OUTCOME_UNKNOWN_RETRY_CONFIRMED",
          updatedAt: timestamp,
        };
      }
      transfersState.updatedAt = timestamp;
      await writeJsonAtomic(paths.transfers, transfersState);
      const nextMembers = updateMembershipSnapshot(oldMembersState, currentIds, timestamp);
      await writeJsonAtomic(paths.members, nextMembers);
    }

    const shouldShowDryRun = dryRun;
    if (candidates.size === 0) {
      print(output, "No new or failed transfers to process.");
      const records = Object.values(transfersState.transfers);
      const unknown = records.filter((record) => record.status === "unknown").length;
      if (unknown > 0) print(output, `Unknown submission outcomes: ${unknown}; inspect status and reconcile before retrying.`);
      return {
        currentIds,
        newIds,
        alreadySeen,
        removedIds,
        candidates: [],
        applied: 0,
        failed: 0,
        pending: 0,
        unknown,
      };
    }

    const readOnly = await (dependencies.createReadOnlyRuntime ?? createReadOnlyRuntime)(env);
    const asset = assetDisplay(await readOnly.locus.getAsset(assetBytes));
    const plans = [];
    const pendingIds = [];
    const failedIds = [];
    const unknownIds = [];
    const resolveOwnership = dependencies.resolveOwnership ?? ((userId) => resolveMatrixOwnership(userId, {
      env,
      resolverUrl: options.resolverUrl,
      fetchImpl,
    }));
    const timestamp = safeTimestamp(now);

    for (const userId of [...candidates].sort()) {
      let record = transfersState.transfers[userId] ?? newTransferRecord(timestamp);
      if (record.status === "applied") continue;
      if (record.status === "pending" && typeof record.transactionId === "string") {
        pendingIds.push(userId);
        print(output, `${userId} -> resume ${record.transactionId}`);
        continue;
      }
      if (record.status === "submitting") {
        record = { ...record, status: "unknown", error: "SUBMISSION_OUTCOME_UNKNOWN", updatedAt: timestamp };
        transfersState.transfers[userId] = record;
        if (!dryRun) await writeJsonAtomic(paths.transfers, transfersState);
      }
      if (record.status === "unknown" && !retryUnknown.has(userId)) {
        unknownIds.push(userId);
        print(output, `${userId} -> UNKNOWN_SUBMISSION_OUTCOME (manual reconciliation required)`);
        continue;
      }
      let resolved;
      try {
        resolved = ownershipFromRecord(record) ?? await resolveOwnership(userId);
      } catch (cause) {
        const code = errorCode(cause, "MATRIX_CROSS_SIGNING_UNAVAILABLE");
        failedIds.push(userId);
        print(output, `${userId} -> ${code}`);
        if (!dryRun) await updateAndSaveTransfer(transfersState, userId, { status: "failed", error: code }, paths.transfers, safeTimestamp(now));
        continue;
      }
      const preparedRecord = {
        ...record,
        ownershipId: resolved.ownershipId,
        ownershipKey: resolved.ownershipKey,
        status: dryRun ? record.status : "queued",
        error: undefined,
        updatedAt: timestamp,
      };
      if (!dryRun) await updateAndSaveTransfer(transfersState, userId, preparedRecord, paths.transfers, timestamp);
      plans.push({ userId, resolved, record: preparedRecord });
      print(output, `${userId} -> Ownership ${resolved.ownershipKey}`);
    }

    const amountDisplay = formatUnits(amount, asset.decimals);
    if (shouldShowDryRun) {
      print(output, `Amount each: ${amountDisplay} ${asset.symbol}`);
      print(output, `Total: ${formatAggregateAmount(amount * BigInt(plans.length), asset.decimals)} ${asset.symbol} across ${plans.length} transfer(s)`);
      print(output, "DRY_RUN: no state was written and no transfer was submitted.");
      return { currentIds, newIds, alreadySeen, removedIds, candidates: [...candidates], plans, dryRun: true };
    }

    const treasury = plans.length > 0
      ? await (dependencies.createTreasuryRuntime ?? createTreasuryRuntime)(env)
      : null;
    const protocolClient = treasury?.protocolClient ?? readOnly.protocolClient;
    const locus = treasury?.locus;
    let applied = 0;
    let failed = failedIds.length;
    let pending = 0;
    let unknown = unknownIds.length;

    for (const userId of pendingIds) {
      const record = transfersState.transfers[userId];
      try {
        const result = await protocolClient.waitForAction(record.transactionId, WAIT_OPTIONS);
        const receipt = result?.actionReceipt;
        if (receipt?.status === "applied") {
          await updateAndSaveTransfer(transfersState, userId, { status: "applied", error: undefined, errorCode: undefined, appliedAt: safeTimestamp(now) }, paths.transfers, safeTimestamp(now));
          applied += 1;
          print(output, `${userId} -> APPLIED ${record.transactionId}`);
        } else if (receipt?.status === "failed" || receipt?.status === "rejected") {
          await updateAndSaveTransfer(transfersState, userId, { status: "failed", error: "ACTION_FAILED", errorCode: receipt.errorCode ?? null }, paths.transfers, safeTimestamp(now));
          failed += 1;
          print(output, `${userId} -> ACTION_FAILED`);
        } else {
          throw new MatrixAirdropError("ACTION_RECEIPT_UNAVAILABLE", "No action receipt was produced");
        }
      } catch (cause) {
        const code = errorCode(cause, "RPC_TIMEOUT");
        await updateAndSaveTransfer(transfersState, userId, { status: "pending", error: code }, paths.transfers, safeTimestamp(now));
        pending += 1;
        print(output, `${userId} -> PENDING ${code} ${record.transactionId}`);
      }
    }

    for (const { userId, resolved } of plans) {
      const submitAt = safeTimestamp(now);
      await updateAndSaveTransfer(transfersState, userId, {
        status: "submitting",
        ownershipId: resolved.ownershipId,
        ownershipKey: resolved.ownershipKey,
        error: undefined,
        transactionId: undefined,
        actionHash: undefined,
        lastAttemptAt: submitAt,
      }, paths.transfers, submitAt);
      let submitted;
      try {
        submitted = await locus.transfer(assetBytes, resolved.owner, amount);
        if (!isTransactionId(submitted?.transactionId)) {
          throw new MatrixAirdropError("SUBMISSION_OUTCOME_UNKNOWN", "Locus transfer did not return a transaction ID");
        }
        await updateAndSaveTransfer(transfersState, userId, {
          status: "pending",
          transactionId: submitted.transactionId,
          actionHash: submitted.actionHash,
          error: undefined,
        }, paths.transfers, safeTimestamp(now));
      } catch (cause) {
        const code = errorCode(cause);
        const outcomeUnknown = cause?.code === "SUBMISSION_OUTCOME_UNKNOWN" || !(cause instanceof MatrixAirdropError);
        await updateAndSaveTransfer(transfersState, userId, {
          status: outcomeUnknown ? "unknown" : "failed",
          error: outcomeUnknown ? "SUBMISSION_OUTCOME_UNKNOWN" : code,
          errorCode: code,
        }, paths.transfers, safeTimestamp(now));
        if (outcomeUnknown) unknown += 1;
        else failed += 1;
        print(output, `${userId} -> ${outcomeUnknown ? "UNKNOWN_SUBMISSION_OUTCOME" : code}`);
        continue;
      }

      const transactionId = submitted.transactionId;
      print(output, `${userId} -> submitted ${transactionId}`);
      try {
        const result = await protocolClient.waitForAction(transactionId, WAIT_OPTIONS);
        const receipt = result?.actionReceipt;
        if (receipt?.status === "applied") {
          await updateAndSaveTransfer(transfersState, userId, { status: "applied", error: undefined, errorCode: undefined, appliedAt: safeTimestamp(now) }, paths.transfers, safeTimestamp(now));
          applied += 1;
          print(output, `${userId} -> APPLIED ${transactionId}`);
        } else if (receipt?.status === "failed" || receipt?.status === "rejected") {
          await updateAndSaveTransfer(transfersState, userId, { status: "failed", error: "ACTION_FAILED", errorCode: receipt.errorCode ?? null }, paths.transfers, safeTimestamp(now));
          failed += 1;
          print(output, `${userId} -> ACTION_FAILED`);
        } else {
          await updateAndSaveTransfer(transfersState, userId, { status: "pending", error: "ACTION_RECEIPT_UNAVAILABLE" }, paths.transfers, safeTimestamp(now));
          pending += 1;
          print(output, `${userId} -> PENDING ACTION_RECEIPT_UNAVAILABLE ${transactionId}`);
        }
      } catch (cause) {
        const code = errorCode(cause, "RPC_TIMEOUT");
        await updateAndSaveTransfer(transfersState, userId, { status: "pending", error: code }, paths.transfers, safeTimestamp(now));
        pending += 1;
        print(output, `${userId} -> PENDING ${code} ${transactionId}`);
      }
    }

    print(output, `Transferred: ${applied}`);
    print(output, `Failed: ${failed}`);
    print(output, `Pending: ${pending}`);
    print(output, `Unknown: ${unknown}`);
    return { currentIds, newIds, alreadySeen, removedIds, candidates: [...candidates], applied, failed, pending, unknown };
  } finally {
    await releaseLock?.();
  }
}

export async function showStatus(options, dependencies = {}) {
  const output = dependencies.output ?? console.log;
  const paths = statePaths(options.stateDirectory);
  const [membersState, transfersState] = await Promise.all([
    readJsonOptional(paths.members),
    readJsonOptional(paths.transfers),
  ]);
  if (!membersState && !transfersState) {
    print(output, "No Matrix airdrop state found.");
    return { roomId: null, members: 0, resolved: 0, transferred: 0, failed: 0, pending: 0, unknown: 0 };
  }
  const roomId = membersState?.roomId ?? transfersState?.roomId ?? "unknown";
  const activeIds = currentRoomIds(membersState);
  const transferRecords = transfersState?.transfers ?? {};
  const records = Object.values(transferRecords);
  const resolved = records.filter((record) => typeof record?.ownershipKey === "string").length;
  const transferred = records.filter((record) => record?.status === "applied").length;
  const failed = records.filter((record) => record?.status === "failed").length;
  const pending = records.filter((record) => ["queued", "pending"].includes(record?.status)).length;
  const unknownCount = records.filter((record) => ["submitting", "unknown"].includes(record?.status)).length;
  print(output, `Room: ${roomId}`);
  print(output, `Members: ${activeIds.length}`);
  print(output, `Resolved: ${resolved}`);
  print(output, `Transferred: ${transferred}`);
  print(output, `Failed: ${failed}`);
  print(output, `Pending: ${pending}`);
  print(output, `Unknown: ${unknownCount}`);
  const failures = Object.entries(transferRecords).filter(([, record]) => record?.status === "failed");
  if (failures.length > 0) {
    print(output, "Failure reasons:");
    const groups = new Map();
    for (const [userId, record] of failures) {
      const reason = record.errorCode ?? record.error ?? "ACTION_FAILED";
      const group = groups.get(reason) ?? [];
      group.push(userId);
      groups.set(reason, group);
    }
    for (const [reason, userIds] of groups) print(output, `  ${reason} (${userIds.length}): ${userIds.join(", ")}`);
  }
  const unknown = Object.entries(transferRecords).filter(([, record]) => ["submitting", "unknown"].includes(record?.status));
  if (unknown.length > 0) {
    print(output, "Unknown submission outcomes (reconcile before retry):");
    for (const [userId, record] of unknown) print(output, `  ${userId}: ${record.error ?? "SUBMISSION_OUTCOME_UNKNOWN"}`);
  }
  return { roomId, members: activeIds.length, resolved, transferred, failed, pending, unknown: unknownCount };
}

export async function resetState(options, dependencies = {}) {
  const output = dependencies.output ?? console.log;
  const paths = statePaths(options.stateDirectory);
  const releaseLock = await acquireSyncLock(paths.lock);
  try {
    await fs.rm(paths.transfers, { force: true });
    if (options.resetAll) await fs.rm(paths.members, { force: true });
    print(output, options.resetAll ? "Removed members.json and transfers.json." : "Removed transfers.json; members.json was preserved.");
  } finally {
    await releaseLock();
  }
}

export async function main(argv, dependencies = {}) {
  const options = parseCommandLine(argv);
  if (options.command === "sync") {
    for (const field of ["room", "asset", "amount"]) {
      if (!options[field]) throw new MatrixAirdropError("USAGE", `sync requires --${field}`);
    }
    return syncAirdrop(options, dependencies);
  }
  if (options.command === "status") return showStatus(options, dependencies);
  return resetState(options, dependencies);
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  main(process.argv.slice(2)).catch((cause) => {
    const code = errorCode(cause, "AIRDROP_FAILED");
    const message = cause instanceof MatrixAirdropError ? cause.message : code;
    console.error(`MATRIX_AIRDROP_ERROR=${code}: ${message}`);
    process.exitCode = 1;
  });
}
