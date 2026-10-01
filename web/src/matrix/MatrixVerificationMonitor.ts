export const MATRIX_VERIFICATION_POLL_INTERVAL_MS = 2_000;
export const MATRIX_VERIFICATION_POLL_WINDOW_MS = 120_000;

type MatrixEventTarget = {
  addEventListener: (type: string, listener: () => void) => void;
  removeEventListener: (type: string, listener: () => void) => void;
};

type MatrixDocumentTarget = MatrixEventTarget & { visibilityState: string };
type TimerHandle = unknown;

export type MatrixVerificationMonitorOptions = {
  documentTarget?: MatrixDocumentTarget;
  windowTarget?: MatrixEventTarget;
  now?: () => number;
  scheduleInterval?: (callback: () => void, delayMs: number) => TimerHandle;
  clearScheduledInterval?: (timer: TimerHandle) => void;
  pollIntervalMs?: number;
  pollWindowMs?: number;
};

export function matrixProofIsPublished(keys: {
  verification: "verified" | "pending";
  selfSigningSignature: Uint8Array | null;
}): boolean {
  return keys.verification === "verified" && keys.selfSigningSignature !== null;
}

export function createMatrixVerificationMonitor(
  refresh: () => Promise<boolean>,
  options: MatrixVerificationMonitorOptions = {},
): { refreshNow: () => Promise<boolean>; dispose: () => void } {
  const documentTarget = options.documentTarget ?? (globalThis.document as unknown as MatrixDocumentTarget);
  const windowTarget = options.windowTarget ?? (globalThis.window as unknown as MatrixEventTarget);
  const now = options.now ?? Date.now;
  const scheduleInterval = options.scheduleInterval ?? ((callback, delayMs) => globalThis.setInterval(callback, delayMs));
  const clearScheduledInterval = options.clearScheduledInterval ?? ((timer) => globalThis.clearInterval(timer as ReturnType<typeof setInterval>));
  const pollIntervalMs = options.pollIntervalMs ?? MATRIX_VERIFICATION_POLL_INTERVAL_MS;
  const pollWindowMs = options.pollWindowMs ?? MATRIX_VERIFICATION_POLL_WINDOW_MS;
  const pollingStartedAt = now();

  let disposed = false;
  let pollTimer: TimerHandle | null = null;
  let inFlight: Promise<boolean> | null = null;

  const dispose = () => {
    if (disposed) return;
    disposed = true;
    if (pollTimer !== null) clearScheduledInterval(pollTimer);
    pollTimer = null;
    documentTarget.removeEventListener("visibilitychange", onResume);
    windowTarget.removeEventListener("focus", onResume);
    windowTarget.removeEventListener("pageshow", onResume);
  };

  const refreshNow = (): Promise<boolean> => {
    if (disposed) return Promise.resolve(false);
    if (inFlight) return inFlight;
    inFlight = Promise.resolve()
      .then(refresh)
      .then((verified) => {
        if (verified) dispose();
        return verified;
      })
      .catch(() => false)
      .finally(() => { inFlight = null; });
    return inFlight;
  };

  function onResume(): void {
    if (documentTarget.visibilityState === "visible") void refreshNow();
  }

  documentTarget.addEventListener("visibilitychange", onResume);
  windowTarget.addEventListener("focus", onResume);
  windowTarget.addEventListener("pageshow", onResume);
  pollTimer = scheduleInterval(() => {
    if (now() - pollingStartedAt >= pollWindowMs) {
      if (pollTimer !== null) clearScheduledInterval(pollTimer);
      pollTimer = null;
      return;
    }
    void refreshNow();
  }, pollIntervalMs);
  void refreshNow();

  return { refreshNow, dispose };
}
