import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { ownershipKey, toHex } from "@jamscript/client";
import { formatLocusId, matrixOwnership } from "../dist/sdk/index.js";
import {
  fetchJoinedMembers,
  main,
  parseCommandLine,
  resetState,
  resolveMatrixOwnership,
  showStatus,
  syncAirdrop,
} from "../scripts/matrix-airdrop/index.mjs";

const ROOM = "!community:minijam.xyz";
const ASSET = `0x${"12".repeat(32)}`;
const ALICE = "@alice:minijam.xyz";
const BOB = "@bob:minijam.xyz";

function ownerFor(seed) {
  return matrixOwnership(new Uint8Array(32).fill(seed));
}

function resolvedFor(userId) {
  const owner = ownerFor(userId === ALICE ? 1 : 2);
  return {
    owner,
    ownershipId: formatLocusId(owner),
    ownershipKey: toHex(ownershipKey(owner)).toLowerCase(),
  };
}

async function temporaryDirectory() {
  return fs.mkdtemp(path.join(os.tmpdir(), "locus-matrix-airdrop-"));
}

function syncOptions(stateDirectory, overrides = {}) {
  return {
    command: "sync",
    room: ROOM,
    asset: ASSET,
    amount: "100000000",
    stateDirectory,
    ...overrides,
  };
}

function dependencies({ members = [ALICE], transfer, waitForAction, output = () => {} } = {}) {
  let transactionSequence = 0;
  const waitCalls = [];
  const transferCalls = [];
  const protocolClient = {
    async waitForAction(transactionId, options) {
      waitCalls.push({ transactionId, options });
      return waitForAction
        ? waitForAction(transactionId, waitCalls.length)
        : { actionReceipt: { status: "applied" } };
    },
  };
  const locus = {
    async getAsset(assetId) {
      assert.deepEqual(assetId, Uint8Array.from(Buffer.from(ASSET.slice(2), "hex")));
      return { symbol: Buffer.from("MINI"), decimals: 6 };
    },
    async transfer(assetId, owner, amount) {
      transferCalls.push({ assetId, owner, amount });
      if (transfer) return transfer({ assetId, owner, amount, index: transferCalls.length });
      transactionSequence += 1;
      return { transactionId: `0x${transactionSequence.toString(16).padStart(64, "0")}`, actionHash: `hash-${transactionSequence}` };
    },
  };
  return {
    waitCalls,
    transferCalls,
    output,
    fetchJoinedMembers: async () => members,
    createReadOnlyRuntime: async () => ({ protocolClient, locus: { getAsset: locus.getAsset } }),
    createTreasuryRuntime: async () => ({ protocolClient, locus }),
    resolveOwnership: async (userId) => resolvedFor(userId),
  };
}

test("CLI parses sync, dry-run, state, and explicit unknown-outcome retry", () => {
  assert.deepEqual(parseCommandLine([
    "sync", "--room", ROOM, "--asset", ASSET, "--amount", "10", "--dry-run",
    "--state", "/tmp/airdrop-state", "--retry-unknown", ALICE,
  ]), {
    command: "sync",
    room: ROOM,
    asset: ASSET,
    amount: "10",
    dryRun: true,
    stateDirectory: "/tmp/airdrop-state",
    retryUnknown: [ALICE],
  });
  assert.throws(() => parseCommandLine(["status", "--dry-run"]), /only valid for sync/);
  assert.throws(() => parseCommandLine(["reset", "--reset-all", "--room", ROOM]), /only valid for sync/);
});

test("Matrix membership uses the temporary bearer token and rejects invalid MXIDs", async () => {
  const headers = [];
  const env = { MATRIX_HOMESERVER: "https://matrix.minijam.xyz/", MATRIX_ACCESS_TOKEN: "temporary-token" };
  const members = await fetchJoinedMembers(ROOM, env, async (url, options) => {
    assert.match(url, /rooms\/!community%3Aminijam\.xyz\/joined_members$/);
    headers.push(options.headers.authorization);
    return new Response(JSON.stringify({ joined: { [BOB]: {}, [ALICE]: {} } }), { status: 200 });
  });
  assert.deepEqual(members, [ALICE, BOB]);
  assert.deepEqual(headers, ["Bearer temporary-token"]);

  await assert.rejects(fetchJoinedMembers(ROOM, env, async () => new Response(
    JSON.stringify({ joined: { "not-a-mxid": {} } }), { status: 200 },
  )), /invalid user ID/);
});

test("resolver response is parsed by the existing Ownership codec", async () => {
  const owner = ownerFor(7);
  const ownershipId = formatLocusId(owner);
  let request;
  const resolved = await resolveMatrixOwnership(ALICE, {
    env: { LOCUS_MATRIX_RESOLVER_URL: "https://locus.minijam.xyz/matrix-resolver/" },
    fetchImpl: async (url, options) => {
      request = { url, options };
      return new Response(JSON.stringify({ userId: ALICE, ownership: ownershipId }), { status: 200 });
    },
  });
  assert.equal(request.url, "https://locus.minijam.xyz/matrix-resolver/v1/resolve");
  assert.deepEqual(JSON.parse(request.options.body), { userId: ALICE });
  assert.equal(resolved.ownershipId, ownershipId);
  assert.equal(resolved.ownershipKey, toHex(ownershipKey(owner)).toLowerCase());
});

test("dry-run resolves new members without writing state or creating a Treasury signer", async (t) => {
  const parent = await temporaryDirectory();
  t.after(() => fs.rm(parent, { recursive: true, force: true }));
  const stateDirectory = path.join(parent, "state");
  const lines = [];
  const deps = dependencies({ members: [ALICE, BOB], output: (line) => lines.push(line) });
  let treasuryCreated = false;
  deps.createTreasuryRuntime = async () => { treasuryCreated = true; throw new Error("must not create signer"); };

  const result = await syncAirdrop(syncOptions(stateDirectory, { dryRun: true }), deps);
  assert.equal(result.plans.length, 2);
  assert.equal(treasuryCreated, false);
  assert.ok(lines.some((line) => line === "Total: 200 MINI across 2 transfer(s)"));
  assert.ok(lines.every((line) => !line.includes("temporary-token")));
  await assert.rejects(fs.access(stateDirectory), { code: "ENOENT" });
});

test("sync sends once, records applied receipts, and skips recipients already recorded as applied", async (t) => {
  const parent = await temporaryDirectory();
  t.after(() => fs.rm(parent, { recursive: true, force: true }));
  const stateDirectory = path.join(parent, "state");
  const deps = dependencies({ members: [ALICE, BOB] });
  deps.env = { MATRIX_ACCESS_TOKEN: "do-not-persist-this-token" };

  const first = await syncAirdrop(syncOptions(stateDirectory), deps);
  assert.equal(first.applied, 2);
  assert.equal(deps.transferCalls.length, 2);
  assert.ok(deps.transferCalls.every((call) => call.amount === 100000000n));

  const state = JSON.parse(await fs.readFile(path.join(stateDirectory, "transfers.json"), "utf8"));
  assert.equal(state.transfers[ALICE].status, "applied");
  assert.equal(state.transfers[ALICE].ownershipId, resolvedFor(ALICE).ownershipId);
  assert.equal(state.transfers[ALICE].ownershipKey, resolvedFor(ALICE).ownershipKey);
  assert.equal(state.transfers[ALICE].transactionId, `0x${"0".repeat(63)}1`);
  assert.ok(!JSON.stringify(state).includes("do-not-persist-this-token"));
  assert.equal((await fs.stat(path.join(stateDirectory, "transfers.json"))).mode & 0o777, 0o600);
  assert.equal((await fs.stat(stateDirectory)).mode & 0o777, 0o700);

  const second = await syncAirdrop(syncOptions(stateDirectory), deps);
  assert.equal(second.applied, 0);
  assert.equal(deps.transferCalls.length, 2);
  assert.deepEqual(second.candidates, []);
  await assert.rejects(syncAirdrop(syncOptions(stateDirectory, { amount: "100000001" }), deps), /different room, asset, or amount/);
});

test("a definitive failed receipt retries on a later sync", async (t) => {
  const parent = await temporaryDirectory();
  t.after(() => fs.rm(parent, { recursive: true, force: true }));
  const stateDirectory = path.join(parent, "state");
  const deps = dependencies({
    members: [ALICE],
    waitForAction: (_transactionId, attempt) => ({
      actionReceipt: attempt === 1 ? { status: "failed", errorCode: 25 } : { status: "applied" },
    }),
  });

  const first = await syncAirdrop(syncOptions(stateDirectory), deps);
  assert.equal(first.failed, 1);
  const second = await syncAirdrop(syncOptions(stateDirectory), deps);
  assert.equal(second.applied, 1);
  assert.equal(deps.transferCalls.length, 2);
  const state = JSON.parse(await fs.readFile(path.join(stateDirectory, "transfers.json"), "utf8"));
  assert.equal(state.transfers[ALICE].status, "applied");
});

test("membership sync tracks new, already-seen, and removed members without re-airdropping rejoiners", async (t) => {
  const parent = await temporaryDirectory();
  t.after(() => fs.rm(parent, { recursive: true, force: true }));
  const stateDirectory = path.join(parent, "state");
  const deps = dependencies({ members: [ALICE] });

  await syncAirdrop(syncOptions(stateDirectory), deps);
  deps.fetchJoinedMembers = async () => [ALICE, BOB];
  const second = await syncAirdrop(syncOptions(stateDirectory), deps);
  assert.deepEqual(second.newIds, [BOB]);
  assert.deepEqual(second.alreadySeen, [ALICE]);
  assert.equal(deps.transferCalls.length, 2);

  deps.fetchJoinedMembers = async () => [BOB];
  const third = await syncAirdrop(syncOptions(stateDirectory), deps);
  assert.deepEqual(third.removedIds, [ALICE]);
  const membersAfterLeave = JSON.parse(await fs.readFile(path.join(stateDirectory, "members.json"), "utf8"));
  assert.equal(membersAfterLeave.members[ALICE].status, "left");

  deps.fetchJoinedMembers = async () => [ALICE, BOB];
  const rejoin = await syncAirdrop(syncOptions(stateDirectory), deps);
  assert.deepEqual(rejoin.newIds, []);
  assert.equal(deps.transferCalls.length, 2);
});

test("pending transactions are resumed by ID without a duplicate transfer", async (t) => {
  const parent = await temporaryDirectory();
  t.after(() => fs.rm(parent, { recursive: true, force: true }));
  const stateDirectory = path.join(parent, "state");
  let poll = 0;
  const deps = dependencies({
    members: [ALICE],
    waitForAction: () => {
      poll += 1;
      if (poll === 1) throw new Error("RPC timeout");
      return { actionReceipt: { status: "applied" } };
    },
  });

  const first = await syncAirdrop(syncOptions(stateDirectory), deps);
  assert.equal(first.pending, 1);
  assert.equal(deps.transferCalls.length, 1);
  const second = await syncAirdrop(syncOptions(stateDirectory), deps);
  assert.equal(second.applied, 1);
  assert.equal(deps.transferCalls.length, 1);
  assert.deepEqual(deps.waitCalls.map(({ transactionId }) => transactionId), [`0x${"0".repeat(63)}1`, `0x${"0".repeat(63)}1`]);
});

test("unknown submission outcome is never retried without explicit acknowledgement", async (t) => {
  const parent = await temporaryDirectory();
  t.after(() => fs.rm(parent, { recursive: true, force: true }));
  const stateDirectory = path.join(parent, "state");
  const deps = dependencies({ members: [ALICE] });
  let transferAttempts = 0;
  deps.createTreasuryRuntime = async () => {
    return {
      protocolClient: { async waitForAction() { return { actionReceipt: { status: "applied" } }; } },
      locus: {
        async transfer(...args) {
          transferAttempts += 1;
          deps.transferCalls.push({ args });
          if (transferAttempts === 1) throw new Error("connection dropped while submitting");
          return { transactionId: `0x${"ab".repeat(32)}`, actionHash: "hash-retried" };
        },
      },
    };
  };

  const first = await syncAirdrop(syncOptions(stateDirectory), deps);
  assert.equal(first.unknown, 1);
  const noRetry = await syncAirdrop(syncOptions(stateDirectory), deps);
  assert.deepEqual(noRetry.candidates, []);
  assert.equal(deps.transferCalls.length, 1);
  const status = await showStatus({ stateDirectory }, { output: () => {} });
  assert.equal(status.unknown, 1);

  const retry = await syncAirdrop(syncOptions(stateDirectory, { retryUnknown: [ALICE] }), deps);
  assert.equal(retry.applied, 1);
  assert.equal(transferAttempts, 2);
});

test("an interrupted submitting record becomes unknown and is not resubmitted", async (t) => {
  const parent = await temporaryDirectory();
  t.after(() => fs.rm(parent, { recursive: true, force: true }));
  const stateDirectory = path.join(parent, "state");
  await fs.mkdir(stateDirectory, { mode: 0o700 });
  await fs.writeFile(path.join(stateDirectory, "members.json"), JSON.stringify({
    version: 1,
    roomId: ROOM,
    updatedAt: "2026-10-01T00:00:00.000Z",
    members: { [ALICE]: { firstSeen: "2026-10-01", lastSeen: "2026-10-01T00:00:00.000Z", status: "joined" } },
  }), { mode: 0o600 });
  await fs.writeFile(path.join(stateDirectory, "transfers.json"), JSON.stringify({
    version: 1,
    roomId: ROOM,
    assetId: ASSET,
    amount: "100000000",
    transfers: { [ALICE]: { status: "submitting" } },
  }), { mode: 0o600 });
  const deps = dependencies({ members: [ALICE] });
  let treasuryCreated = false;
  deps.createTreasuryRuntime = async () => { treasuryCreated = true; throw new Error("must not submit"); };

  const result = await syncAirdrop(syncOptions(stateDirectory), deps);
  assert.equal(result.unknown, 1);
  assert.equal(treasuryCreated, false);
  assert.equal(deps.transferCalls.length, 0);
  const status = await showStatus({ stateDirectory }, { output: () => {} });
  assert.equal(status.unknown, 1);
});

test("status and reset preserve the membership baseline unless reset-all is selected", async (t) => {
  const parent = await temporaryDirectory();
  t.after(() => fs.rm(parent, { recursive: true, force: true }));
  const stateDirectory = path.join(parent, "state");
  const deps = dependencies({ members: [ALICE] });
  await syncAirdrop(syncOptions(stateDirectory), deps);

  const lines = [];
  const status = await showStatus({ stateDirectory }, { output: (line) => lines.push(line) });
  assert.equal(status.members, 1);
  assert.equal(status.transferred, 1);
  await resetState({ stateDirectory }, { output: () => {} });
  await assert.rejects(fs.access(path.join(stateDirectory, "transfers.json")), { code: "ENOENT" });
  assert.ok(await fs.readFile(path.join(stateDirectory, "members.json"), "utf8"));

  await main(["reset", "--reset-all", "--state", stateDirectory], { output: () => {} });
  await assert.rejects(fs.access(path.join(stateDirectory, "members.json")), { code: "ENOENT" });
  assert.ok(lines.some((line) => line.includes("Transferred: 1")));
});
