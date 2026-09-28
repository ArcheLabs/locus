export type CreateAssetStage =
  | "EDITING"
  | "PREPARING"
  | "AWAITING_WALLET"
  | "SIGNED"
  | "SUBMITTING"
  | "SUBMITTED"
  | "FINALIZING"
  | "APPLIED"
  | "FAILED";

export type CreateAssetPendingRecord = {
  version: 1;
  key: string;
  assetId: string;
  name: string;
  symbol: string;
  decimals: number;
  initialSupply: string;
  state: "submission-unknown" | "submitted";
  transactionId?: string;
  actionHash?: string;
  error?: string;
  updatedAt: number;
};

export interface CreateAssetStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface VisibilitySource {
  isHidden(): boolean;
  subscribe(listener: (hidden: boolean) => void): () => void;
}

export const CREATE_ASSET_PENDING_STORAGE_KEY = "locus.create-asset.pending.v1";

export class WalletSignatureTimeoutError extends Error {
  constructor(timeoutMs: number) {
    super(`The wallet did not return a signature within ${Math.ceil(timeoutMs / 1000)} seconds after returning to Locus.`);
    this.name = "WalletSignatureTimeoutError";
  }
}

export class PreparationTimeoutError extends Error {
  constructor(timeoutMs: number) {
    super(`Create action preparation did not finish within ${Math.ceil(timeoutMs / 1000)} seconds. It was not signed or submitted.`);
    this.name = "PreparationTimeoutError";
  }
}

export class OperationTimeoutError extends Error {
  readonly stage: "submission" | "finalization";

  constructor(stage: "submission" | "finalization", timeoutMs: number) {
    super(`${stage === "submission" ? "The submission response" : "Transaction finalization"} did not arrive within ${Math.ceil(timeoutMs / 1000)} seconds.`);
    this.name = "OperationTimeoutError";
    this.stage = stage;
  }
}

export class DuplicateCreateAssetSubmissionError extends Error {
  constructor() {
    super("This create-asset action already has a saved submission or recovery record.");
    this.name = "DuplicateCreateAssetSubmissionError";
  }
}

const browserVisibility: VisibilitySource = {
  isHidden: () => typeof document !== "undefined" && document.visibilityState === "hidden",
  subscribe(listener) {
    if (typeof document === "undefined") return () => {};
    const onChange = () => listener(document.visibilityState === "hidden");
    document.addEventListener("visibilitychange", onChange);
    return () => document.removeEventListener("visibilitychange", onChange);
  },
};

/**
 * The wallet prompt can background Safari while OKX/another wallet is open.
 * Count only time when the Locus page is visible so returning from the wallet
 * does not consume the entire response window.
 */
export function waitForWalletSignature<T>(
  signature: Promise<T>,
  timeoutMs = 120_000,
  visibility: VisibilitySource = browserVisibility,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let remaining = timeoutMs;
    let startedAt = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let settled = false;
    const finish = (callback: (value: T) => void, value: T) => {
      if (settled) return;
      settled = true;
      if (timer !== undefined) clearTimeout(timer);
      unsubscribe();
      callback(value);
    };
    const fail = (error: unknown) => {
      if (settled) return;
      settled = true;
      if (timer !== undefined) clearTimeout(timer);
      unsubscribe();
      reject(error);
    };
    const pause = () => {
      if (timer === undefined) return;
      clearTimeout(timer);
      timer = undefined;
      remaining = Math.max(0, remaining - (Date.now() - startedAt));
    };
    const resume = () => {
      if (settled || timer !== undefined || visibility.isHidden()) return;
      if (remaining <= 0) {
        fail(new WalletSignatureTimeoutError(timeoutMs));
        return;
      }
      startedAt = Date.now();
      timer = setTimeout(() => fail(new WalletSignatureTimeoutError(timeoutMs)), remaining);
    };
    const unsubscribe = visibility.subscribe((hidden) => hidden ? pause() : resume());
    signature.then((value) => finish(resolve, value), fail);
    resume();
  });
}

export function withOperationTimeout<T>(
  promise: Promise<T>,
  stage: "submission" | "finalization",
  timeoutMs: number,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new OperationTimeoutError(stage, timeoutMs)), timeoutMs);
    promise.then(
      (value) => { clearTimeout(timer); resolve(value); },
      (error) => { clearTimeout(timer); reject(error); },
    );
  });
}

/**
 * Bound the preparation UI while reclaiming a prepared action that arrives
 * after the user has already been told the read timed out.
 */
export function withPreparationTimeout<T>(
  preparation: Promise<T>,
  timeoutMs: number,
  abandonLateResult?: (value: T) => void,
): Promise<T> {
  let timedOut = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  void preparation.then((value) => {
    if (!timedOut) return;
    try { abandonLateResult?.(value); } catch { /* Best-effort release of an unsigned action. */ }
  }, () => {});
  const timeout = new Promise<T>((_resolve, reject) => {
    timer = setTimeout(() => {
      timedOut = true;
      reject(new PreparationTimeoutError(timeoutMs));
    }, timeoutMs);
  });
  return Promise.race([preparation, timeout]).finally(() => {
    if (timer !== undefined) clearTimeout(timer);
  });
}

export function submitCreateAssetOnce<T extends { transactionId: string; actionHash: string }>(
  recordBase: CreateAssetPendingRecord,
  storage: CreateAssetStorage,
  submit: () => Promise<T>,
  onStarted?: (record: CreateAssetPendingRecord) => void,
  onSubmitted?: (record: CreateAssetPendingRecord, result: T) => void,
): Promise<CreateAssetPendingRecord> {
  if (readCreateAssetPending(storage, recordBase.key)) {
    return Promise.reject(new DuplicateCreateAssetSubmissionError());
  }
  const unknown: CreateAssetPendingRecord = { ...recordBase, state: "submission-unknown", updatedAt: Date.now() };
  writeCreateAssetPending(storage, unknown);
  onStarted?.(unknown);
  let submission: Promise<T>;
  try { submission = submit(); }
  catch (cause) { submission = Promise.reject(cause); }
  return submission.then((result) => {
    const record: CreateAssetPendingRecord = {
      ...unknown,
      state: "submitted",
      transactionId: result.transactionId,
      actionHash: result.actionHash,
      updatedAt: Date.now(),
    };
    writeCreateAssetPending(storage, record);
    onSubmitted?.(record, result);
    return record;
  });
}

export function resumeCreateAssetFinalization<T>(
  record: CreateAssetPendingRecord,
  wait: (transactionId: string, actionHash: string) => Promise<T>,
  timeoutMs: number,
): Promise<T> {
  if (record.state !== "submitted" || !record.transactionId || !record.actionHash) {
    return Promise.reject(new Error("A saved transaction ID and action hash are required to resume finalization."));
  }
  let waitPromise: Promise<T>;
  try { waitPromise = wait(record.transactionId, record.actionHash); }
  catch (cause) { waitPromise = Promise.reject(cause); }
  return withOperationTimeout(waitPromise, "finalization", timeoutMs);
}

export function createAssetPendingKey(networkId: string, serviceId: number, owner: string, assetId: string): string {
  return `${networkId}:${serviceId}:${owner.toLowerCase()}:${assetId.toLowerCase()}`;
}

export function readCreateAssetPending(storage: CreateAssetStorage, key: string): CreateAssetPendingRecord | null {
  const raw = storage.getItem(CREATE_ASSET_PENDING_STORAGE_KEY);
  if (!raw) return null;
  let parsed: unknown;
  try { parsed = JSON.parse(raw); }
  catch { return null; }
  if (!Array.isArray(parsed)) return null;
  const record = parsed.find((item) => item && typeof item === "object" && (item as CreateAssetPendingRecord).key === key) as CreateAssetPendingRecord | undefined;
  if (!record || record.version !== 1 || typeof record.assetId !== "string" || typeof record.name !== "string"
    || typeof record.symbol !== "string" || !Number.isSafeInteger(record.decimals) || typeof record.initialSupply !== "string"
    || (record.state !== "submission-unknown" && record.state !== "submitted")
    || (record.state === "submitted" && (typeof record.transactionId !== "string" || typeof record.actionHash !== "string"))) return null;
  return record;
}

export function readCreateAssetPendings(storage: CreateAssetStorage): CreateAssetPendingRecord[] {
  const raw = storage.getItem(CREATE_ASSET_PENDING_STORAGE_KEY);
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((record): record is CreateAssetPendingRecord => Boolean(record && typeof record === "object"
      && (record as CreateAssetPendingRecord).version === 1 && typeof (record as CreateAssetPendingRecord).key === "string"
      && typeof (record as CreateAssetPendingRecord).assetId === "string"
      && ((record as CreateAssetPendingRecord).state === "submitted" || (record as CreateAssetPendingRecord).state === "submission-unknown")));
  } catch { return []; }
}

export function writeCreateAssetPending(storage: CreateAssetStorage, record: CreateAssetPendingRecord): void {
  const raw = storage.getItem(CREATE_ASSET_PENDING_STORAGE_KEY);
  let records: CreateAssetPendingRecord[] = [];
  if (raw) {
    try {
      const parsed: unknown = JSON.parse(raw);
      if (Array.isArray(parsed)) records = parsed.filter((item): item is CreateAssetPendingRecord => Boolean(item && typeof item === "object" && typeof (item as CreateAssetPendingRecord).key === "string"));
    } catch { /* Preserve the new recovery record instead of trusting malformed data. */ }
  }
  const next = records.filter((item) => item.key !== record.key);
  next.push({ ...record, updatedAt: Date.now() });
  storage.setItem(CREATE_ASSET_PENDING_STORAGE_KEY, JSON.stringify(next.slice(-20)));
}

export function removeCreateAssetPending(storage: CreateAssetStorage, key: string): void {
  const raw = storage.getItem(CREATE_ASSET_PENDING_STORAGE_KEY);
  if (!raw) return;
  let parsed: unknown;
  try { parsed = JSON.parse(raw); }
  catch { return; }
  if (!Array.isArray(parsed)) return;
  const next = parsed.filter((item) => !item || typeof item !== "object" || (item as CreateAssetPendingRecord).key !== key);
  if (next.length === 0) storage.removeItem(CREATE_ASSET_PENDING_STORAGE_KEY);
  else storage.setItem(CREATE_ASSET_PENDING_STORAGE_KEY, JSON.stringify(next));
}
