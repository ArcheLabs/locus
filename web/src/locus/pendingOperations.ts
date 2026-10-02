import type { LocusClient, Ownership } from "@archelabs/locus";
import { ownershipKey, toHex } from "@jamscript/client";
import type { SubmitActionResult, TransactionLifecycleUpdate } from "@jamscript/client";
import type { LocusActionSubmissionOptions } from "@archelabs/locus";

export type PendingOperationPhase = "prepared" | "signed" | "submitted" | "best-included" | "reorged" | "finalized" | "failed" | "submission-unknown" | "not-submitted";

function definiteSubmissionRejection(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const code = (error as { code?: unknown }).code;
  return typeof code === "number"
    && ([-32600, -32601, -32602, -32003, -32010, -32011, -32031, -32032, -32033, -32043, -32044, -32045].includes(code)
      || [400, 401, 403, 404, 409, 422].includes(code));
}

export type PendingOperation = {
  schemaVersion: 1;
  operationId: string;
  operationType: string;
  networkId: string;
  genesisHash: string;
  networkDomain: string;
  serviceId: number;
  serviceKey: string;
  codeHash: string;
  subjectIdentity: string;
  transactionId?: string;
  actionHash?: string;
  packageHash?: string | null;
  phase: PendingOperationPhase;
  confirmation: "unknown" | "best" | "finalized";
  actionResult?: "applied" | "failed" | "rejected";
  lastKnownStatus?: string;
  lastError?: string;
  validUntil?: number;
  createdAt: number;
  updatedAt: number;
};

export type PendingOperationStorage = Pick<Storage, "getItem" | "setItem">;
export type OperationScope = Pick<PendingOperation, "networkId" | "genesisHash" | "networkDomain" | "serviceId" | "serviceKey" | "codeHash" | "subjectIdentity">;

const STORE_KEY = "locus.pending-operations.v1";
const PHASES: ReadonlySet<string> = new Set([
  "prepared", "signed", "submitted", "best-included", "reorged", "finalized", "failed", "submission-unknown", "not-submitted",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function validOperation(value: unknown): value is PendingOperation {
  if (!isRecord(value)) return false;
  return value.schemaVersion === 1
    && typeof value.operationId === "string"
    && typeof value.operationType === "string"
    && typeof value.networkId === "string"
    && typeof value.genesisHash === "string"
    && typeof value.networkDomain === "string"
    && typeof value.serviceId === "number"
    && typeof value.serviceKey === "string"
    && typeof value.codeHash === "string"
    && typeof value.subjectIdentity === "string"
    && typeof value.phase === "string"
    && PHASES.has(value.phase)
    && ["unknown", "best", "finalized"].includes(String(value.confirmation))
    && typeof value.createdAt === "number"
    && typeof value.updatedAt === "number";
}

export function readPendingOperations(storage: PendingOperationStorage): PendingOperation[] {
  try {
    const parsed: unknown = JSON.parse(storage.getItem(STORE_KEY) ?? "[]");
    return Array.isArray(parsed) ? parsed.filter(validOperation) : [];
  } catch {
    return [];
  }
}

function writePendingOperations(storage: PendingOperationStorage, rows: PendingOperation[]): void {
  // Retain unresolved operations indefinitely. Prune only old terminal records.
  const cutoff = Date.now() - 90 * 24 * 60 * 60 * 1000;
  const retained = rows.filter((row) => !["finalized", "failed", "not-submitted"].includes(row.phase) || row.updatedAt >= cutoff);
  storage.setItem(STORE_KEY, JSON.stringify(retained));
}

export function currentOperationScope(locus: LocusClient, networkId: string, subject: Ownership): OperationScope {
  const deployment = locus.transactionScope();
  return {
    networkId,
    genesisHash: deployment.genesisHash.toLowerCase(),
    networkDomain: deployment.networkDomain.toLowerCase(),
    serviceId: deployment.serviceId,
    serviceKey: deployment.serviceKey.toLowerCase(),
    codeHash: deployment.codeHash.toLowerCase(),
    subjectIdentity: toHex(ownershipKey(subject)).toLowerCase(),
  };
}

export function sameOperationScope(left: OperationScope, right: OperationScope): boolean {
  return left.networkId === right.networkId
    && left.genesisHash.toLowerCase() === right.genesisHash.toLowerCase()
    && left.networkDomain.toLowerCase() === right.networkDomain.toLowerCase()
    && left.serviceId === right.serviceId
    && left.serviceKey.toLowerCase() === right.serviceKey.toLowerCase()
    && left.codeHash.toLowerCase() === right.codeHash.toLowerCase()
    && left.subjectIdentity.toLowerCase() === right.subjectIdentity.toLowerCase();
}

export function beginPendingOperation(
  storage: PendingOperationStorage,
  scope: OperationScope,
  operationType: string,
): PendingOperation {
  const timestamp = Date.now();
  const operation: PendingOperation = {
    schemaVersion: 1,
    operationId: globalThis.crypto?.randomUUID?.() ?? `op-${timestamp}-${Math.random().toString(16).slice(2)}`,
    operationType,
    ...scope,
    phase: "prepared",
    confirmation: "unknown",
    createdAt: timestamp,
    updatedAt: timestamp,
  };
  writePendingOperations(storage, [...readPendingOperations(storage), operation]);
  return operation;
}

export function updatePendingOperation(
  storage: PendingOperationStorage,
  operationId: string,
  patch: Partial<Omit<PendingOperation, "schemaVersion" | "operationId" | "createdAt">>,
): PendingOperation | null {
  const rows = readPendingOperations(storage);
  const index = rows.findIndex((row) => row.operationId === operationId);
  if (index < 0) return null;
  const updated = { ...rows[index], ...patch, updatedAt: Date.now() };
  rows[index] = updated;
  writePendingOperations(storage, rows);
  return updated;
}

export function pendingOperationsForScope(storage: PendingOperationStorage, scope: OperationScope): PendingOperation[] {
  return readPendingOperations(storage).filter((operation) => sameOperationScope(operation, scope));
}

export function applyLifecycleUpdate(
  storage: PendingOperationStorage,
  operationId: string,
  update: TransactionLifecycleUpdate,
): PendingOperation | null {
  const status = update.status;
  const phase: PendingOperationPhase = update.confirmation === "finalized"
    ? (update.actionResult === "applied" ? "finalized" : update.actionResult ? "failed" : "submitted")
    : status.status === "submission_unknown"
      ? "submission-unknown"
      : status.status === "reorged"
        ? "reorged"
        : update.confirmation === "best"
          ? "best-included"
          : "submitted";
  return updatePendingOperation(storage, operationId, {
    transactionId: update.transactionId,
    packageHash: status.packageHash,
    phase,
    confirmation: update.confirmation,
    ...(update.actionResult ? { actionResult: update.actionResult } : {}),
    lastKnownStatus: status.status,
    ...(status.error ? { lastError: status.error } : {}),
  });
}

export function createPendingOperationTracker(
  locus: LocusClient,
  networkId: string,
  subject: Ownership,
  operationType: string,
  storage: PendingOperationStorage = window.localStorage,
) {
  const operation = beginPendingOperation(storage, currentOperationScope(locus, networkId, subject), operationType);
  let signed = false;
  let submitted = false;
  return {
    operation,
    getCurrent: () => readPendingOperations(storage).find((row) => row.operationId === operation.operationId) ?? null,
    submissionOptions: {
      onPrepared: (info) => {
        updatePendingOperation(storage, operation.operationId, {
          phase: "prepared",
          validUntil: info.validUntil,
        });
      },
      onSigned: (info) => {
        signed = true;
        updatePendingOperation(storage, operation.operationId, {
          phase: "signed",
          actionHash: info.actionHash,
          validUntil: info.validUntil,
        });
      },
    } satisfies LocusActionSubmissionOptions,
    onSubmitted: (result: SubmitActionResult) => {
      const updated = updatePendingOperation(storage, operation.operationId, {
        phase: "submitted",
        confirmation: "unknown",
        transactionId: result.transactionId,
        actionHash: result.actionHash,
        packageHash: result.packageHash ?? null,
        lastKnownStatus: result.status,
      });
      submitted = true;
      return updated;
    },
    onUpdate: (update: TransactionLifecycleUpdate) => applyLifecycleUpdate(storage, operation.operationId, update),
    onFinalized: (result: Awaited<ReturnType<LocusClient["waitForFinalized"]>>) => updatePendingOperation(storage, operation.operationId, {
      transactionId: result.transactionId,
      actionHash: result.actionHash,
      packageHash: result.packageHash,
      phase: result.actionReceipt.status === "applied" ? "finalized" : "failed",
      confirmation: "finalized",
      actionResult: result.actionReceipt.status,
      lastKnownStatus: result.transactionStatus,
      ...(result.error ? { lastError: result.error } : {}),
    }),
    onSubmissionUnknown: (error: unknown) => {
      if (submitted) {
        if (error && typeof error === "object" && (error as { code?: unknown }).code === "WORK_FAILED") {
          const lastStatus = (error as { lastStatus?: { status?: string } }).lastStatus;
          return updatePendingOperation(storage, operation.operationId, {
            phase: "failed",
            lastKnownStatus: lastStatus?.status ?? "failed",
            confirmation: "unknown",
            ...(error instanceof Error ? { lastError: error.message } : {}),
          });
        }
        return null;
      }
      if (readPendingOperations(storage).find((row) => row.operationId === operation.operationId)?.phase === "not-submitted") return null;
      return updatePendingOperation(storage, operation.operationId, {
        phase: signed && !definiteSubmissionRejection(error) ? "submission-unknown" : "not-submitted",
        confirmation: "unknown",
        ...(error instanceof Error ? { lastError: error.message } : {}),
      });
    },
    onNotSubmitted: (error?: unknown) => updatePendingOperation(storage, operation.operationId, {
      phase: "not-submitted",
      confirmation: "unknown",
      ...(error instanceof Error ? { lastError: error.message } : {}),
    }),
  };
}

export type PendingOperationTracker = ReturnType<typeof createPendingOperationTracker>;

export function unresolvedOperationsForScope(storage: PendingOperationStorage, scope: OperationScope): PendingOperation[] {
  return pendingOperationsForScope(storage, scope).filter((operation) => [
    "signed", "submitted", "best-included", "reorged", "submission-unknown",
  ].includes(operation.phase));
}
