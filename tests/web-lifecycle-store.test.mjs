import assert from "node:assert/strict";
import test from "node:test";
import {
  applyLifecycleUpdate,
  beginPendingOperation,
  createPendingOperationTracker,
  currentOperationScope,
  pendingOperationsForScope,
  readPendingOperations,
  unresolvedOperationsForScope,
} from "../web/src/locus/pendingOperations.ts";

function memoryStorage() {
  const values = new Map();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value)),
  };
}

const owner = { version: 1, kind: 0, public: new Uint8Array(32).fill(7) };
const deployment = {
  genesisHash: `0x${"11".repeat(32)}`,
  networkDomain: `0x${"22".repeat(32)}`,
  serviceId: 9,
  serviceKey: `0x${"33".repeat(32)}`,
  codeHash: `0x${"44".repeat(32)}`,
};

test("pending operation records restore exact scope and lifecycle transitions", () => {
  const storage = memoryStorage();
  const locus = { transactionScope: () => deployment };
  const scope = currentOperationScope(locus, "local", owner);
  const tracker = createPendingOperationTracker(locus, "local", owner, "transfer", storage);

  tracker.submissionOptions.onSigned({ actionHash: `0x${"aa".repeat(32)}`, submittedSlot: 10, validUntil: 74 });
  tracker.onSubmitted({
    transactionId: `0x${"bb".repeat(32)}`,
    actionHash: `0x${"aa".repeat(32)}`,
    packageHash: `0x${"cc".repeat(32)}`,
    status: "queued",
  });
  const best = {
    transactionId: `0x${"bb".repeat(32)}`,
    status: { status: "imported", packageHash: `0x${"cc".repeat(32)}`, error: null },
    confirmation: "best",
    actionResult: "applied",
  };
  applyLifecycleUpdate(storage, tracker.operation.operationId, best);
  assert.equal(tracker.getCurrent().phase, "best-included");

  const reorg = { ...best, status: { ...best.status, status: "reorged" }, confirmation: "unknown" };
  applyLifecycleUpdate(storage, tracker.operation.operationId, reorg);
  assert.equal(tracker.getCurrent().phase, "reorged");
  applyLifecycleUpdate(storage, tracker.operation.operationId, best);
  assert.equal(tracker.getCurrent().phase, "best-included");

  tracker.onFinalized({
    transactionId: best.transactionId,
    packageHash: best.status.packageHash,
    status: "applied",
    transactionStatus: "imported",
    actionHash: `0x${"aa".repeat(32)}`,
    actionReceipt: { actionHash: `0x${"aa".repeat(32)}`, status: "applied", errorCode: null },
  });
  assert.equal(tracker.getCurrent().phase, "finalized");
  assert.deepEqual(unresolvedOperationsForScope(storage, scope), []);
  assert.equal(pendingOperationsForScope(storage, { ...scope, networkId: "other" }).length, 0);
  assert.equal(readPendingOperations(storage)[0].actionResult, "applied");
  assert.doesNotMatch(storage.getItem("locus.pending-operations.v1"), /signature|privateKey|payload/i);
});

test("an unknown signed submission stays pending and an unsigned cancellation is not submitted", () => {
  const storage = memoryStorage();
  const locus = { transactionScope: () => deployment };
  const signed = createPendingOperationTracker(locus, "local", owner, "swap", storage);
  signed.submissionOptions.onSigned({ actionHash: `0x${"dd".repeat(32)}`, submittedSlot: 20, validUntil: 84 });
  signed.onSubmissionUnknown(new TypeError("network disconnected"));
  assert.equal(signed.getCurrent().phase, "submission-unknown");

  const unsigned = beginPendingOperation(storage, currentOperationScope(locus, "local", owner), "transfer");
  const another = createPendingOperationTracker(locus, "local", owner, "transfer", storage);
  another.onSubmissionUnknown(new Error("wallet rejected signature"));
  assert.equal(another.getCurrent().phase, "not-submitted");
  assert.equal(readPendingOperations(storage).find((row) => row.operationId === unsigned.operationId).phase, "prepared");

  const rejected = createPendingOperationTracker(locus, "local", owner, "mint", storage);
  rejected.submissionOptions.onSigned({ actionHash: `0x${"ee".repeat(32)}`, submittedSlot: 30, validUntil: 94 });
  rejected.onSubmissionUnknown(Object.assign(new Error("rejected by Backend"), { code: -32045 }));
  assert.equal(rejected.getCurrent().phase, "not-submitted");

  const ambiguousRpc = createPendingOperationTracker(locus, "local", owner, "approve", storage);
  ambiguousRpc.submissionOptions.onSigned({ actionHash: `0x${"ff".repeat(32)}`, submittedSlot: 31, validUntil: 95 });
  ambiguousRpc.onSubmissionUnknown(Object.assign(new Error("backend request outcome unknown"), { code: -32030 }));
  assert.equal(ambiguousRpc.getCurrent().phase, "submission-unknown");

  const knownLocalAbort = createPendingOperationTracker(locus, "local", owner, "burn", storage);
  knownLocalAbort.submissionOptions.onSigned({ actionHash: `0x${"ff".repeat(32)}`, submittedSlot: 40, validUntil: 104 });
  knownLocalAbort.onNotSubmitted(new Error("account changed before submit"));
  knownLocalAbort.onSubmissionUnknown(new Error("outer handler saw the local abort"));
  assert.equal(knownLocalAbort.getCurrent().phase, "not-submitted");
});
