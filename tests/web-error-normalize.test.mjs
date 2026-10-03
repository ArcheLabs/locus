import assert from "node:assert/strict";
import test from "node:test";
import { RpcError, TransactionTrackingError } from "@jamscript/client";
import { knownBackendErrorMessage } from "../web/src/errors/backendExecutionError.ts";

test("RC7 structured preflight heap faults are clear and definite no-submit errors", () => {
  const error = new RpcError("NOT_SUBMITTED: GUEST_HEAP_LIMIT_EXCEEDED", -32045, {
    code: "NOT_SUBMITTED",
    cause: {
      code: "GUEST_HEAP_LIMIT_EXCEEDED",
      message: "Guest allocation exceeded the configured heap budget",
      stage: "plan",
      serviceId: 42,
      details: { requestedBytes: 530000, heapMaxBytes: 524288 },
    },
  });

  assert.equal(error.structuredError?.code, "GUEST_HEAP_LIMIT_EXCEEDED");
  assert.equal(error.structuredError?.submissionState, "not_submitted");
  assert.match(knownBackendErrorMessage(error), /530000 bytes requested; 512 KiB limit/);
  assert.match(knownBackendErrorMessage(error), /It was not submitted/);
});

test("structured transaction faults never claim that a submitted transaction was not sent", () => {
  const error = new TransactionTrackingError(
    "transaction failed",
    "TRANSACTION_FAILED",
    "tx-1",
    undefined,
    undefined,
    "finalized",
    undefined,
    { code: "GUEST_HEAP_LIMIT_EXCEEDED", message: "Guest heap limit exceeded", details: { heapMaxBytes: 16777216 } },
  );

  const message = knownBackendErrorMessage(error);
  assert.match(message, /16 MiB limit/);
  assert.match(message, /Check transaction status before retrying/);
  assert.doesNotMatch(message, /was not submitted/);
});

test("unrecognized structured execution errors keep the SDK message", () => {
  const error = new RpcError("NOT_SUBMITTED: GUEST_MEMORY_CONFIG_INVALID", -32045, {
    code: "NOT_SUBMITTED",
    cause: { code: "GUEST_MEMORY_CONFIG_INVALID", message: "Guest memory configuration is invalid" },
  });

  assert.equal(knownBackendErrorMessage(error), null);
});
