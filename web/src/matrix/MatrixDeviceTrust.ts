export type MatrixDeviceTrustState =
  | "VERIFIED"
  | "UNVERIFIED"
  | "UNKNOWN"
  | "IDENTITY_CHANGED"
  | "DEVICE_REVOKED"
  | "SESSION_INVALID";

export type MatrixDeviceTrustSignals = {
  identityAvailable: boolean;
  deviceAvailable: boolean;
  identityChanged: boolean;
  deviceRevoked: boolean;
  masterKeyAvailable: boolean;
  deviceKeyAvailable: boolean;
  masterKeyMatches: boolean;
  deviceKeyMatches: boolean;
  identityVerified: boolean;
  identityTrustsOwnDevice: boolean;
  deviceCrossSignedByOwner: boolean;
  deviceCrossSigningTrusted: boolean;
};

export type MatrixDeviceTrustSnapshot = {
  state: MatrixDeviceTrustState;
  reason?: string;
};

/**
 * Trust policy for Locus's current Matrix device.
 *
 * This deliberately excludes a device's generic/local `isVerified()` bit. A
 * local verification mark is weaker than the cross-signing trust chain used
 * by Locus's Matrix ownership proof.
 */
export function evaluateMatrixDeviceTrust(signals: MatrixDeviceTrustSignals): MatrixDeviceTrustSnapshot {
  if (!signals.identityAvailable || !signals.deviceAvailable) {
    return { state: "UNKNOWN", reason: "crypto-device-data-unavailable" };
  }
  if (signals.identityChanged) {
    return { state: "IDENTITY_CHANGED", reason: "cross-signing-identity-changed" };
  }
  if (signals.deviceRevoked) {
    return { state: "DEVICE_REVOKED", reason: "current-device-key-unavailable" };
  }
  if (!signals.masterKeyAvailable || !signals.deviceKeyAvailable) {
    return { state: "UNKNOWN", reason: "current-identity-or-device-key-unavailable" };
  }
  if (!signals.masterKeyMatches) return { state: "IDENTITY_CHANGED", reason: "cross-signing-identity-changed" };
  if (!signals.deviceKeyMatches) return { state: "DEVICE_REVOKED", reason: "current-device-key-unavailable" };
  if (!signals.identityVerified
    || !signals.identityTrustsOwnDevice
    || !signals.deviceCrossSignedByOwner
    || !signals.deviceCrossSigningTrusted) {
    return { state: "UNVERIFIED", reason: "trusted-cross-signing-chain-incomplete" };
  }
  return { state: "VERIFIED" };
}

export const MATRIX_TRUST_POLL_INTERVAL_MS = 30_000;

type EventTargetLike = {
  addEventListener: (type: string, listener: () => void) => void;
  removeEventListener: (type: string, listener: () => void) => void;
};

type DocumentTargetLike = EventTargetLike & { visibilityState: string };
type TimerHandle = unknown;

export type MatrixDeviceTrustMonitorOptions = {
  documentTarget?: DocumentTargetLike;
  windowTarget?: EventTargetLike;
  subscribeToChanges?: (listener: () => void) => () => void;
  scheduleInterval?: (callback: () => void, delayMs: number) => TimerHandle;
  clearScheduledInterval?: (timer: TimerHandle) => void;
  pollIntervalMs?: number;
};

/**
 * Keep one trust read active per login context. Changes observed during a read
 * set a dirty bit so a second read runs instead of dropping the notification.
 */
export function createMatrixDeviceTrustMonitor(
  refresh: () => Promise<MatrixDeviceTrustSnapshot>,
  options: MatrixDeviceTrustMonitorOptions = {},
): { refreshNow: () => Promise<MatrixDeviceTrustSnapshot>; dispose: () => void } {
  const documentTarget = options.documentTarget ?? (globalThis.document as unknown as DocumentTargetLike);
  const windowTarget = options.windowTarget ?? (globalThis.window as unknown as EventTargetLike);
  const scheduleInterval = options.scheduleInterval ?? ((callback, delayMs) => globalThis.setInterval(callback, delayMs));
  const clearScheduledInterval = options.clearScheduledInterval ?? ((timer) => globalThis.clearInterval(timer as ReturnType<typeof setInterval>));
  const pollIntervalMs = options.pollIntervalMs ?? MATRIX_TRUST_POLL_INTERVAL_MS;

  let disposed = false;
  let dirty = false;
  let inFlight: Promise<MatrixDeviceTrustSnapshot> | null = null;
  let pollTimer: TimerHandle | null = null;
  let unsubscribeChanges = () => {};

  const dispose = () => {
    if (disposed) return;
    disposed = true;
    if (pollTimer !== null) clearScheduledInterval(pollTimer);
    pollTimer = null;
    unsubscribeChanges();
    documentTarget.removeEventListener("visibilitychange", onResume);
    windowTarget.removeEventListener("focus", onResume);
    windowTarget.removeEventListener("pageshow", onResume);
  };

  const refreshNow = (): Promise<MatrixDeviceTrustSnapshot> => {
    if (disposed) return Promise.resolve({ state: "UNKNOWN", reason: "monitor-disposed" });
    if (inFlight) {
      dirty = true;
      return inFlight;
    }
    inFlight = (async () => {
      let result: MatrixDeviceTrustSnapshot = { state: "UNKNOWN", reason: "trust-read-not-started" };
      do {
        dirty = false;
        try { result = await refresh(); }
        catch { result = { state: "UNKNOWN", reason: "trust-read-failed" }; }
      } while (dirty && !disposed);
      return result;
    })().finally(() => { inFlight = null; });
    return inFlight;
  };

  const onResume = () => {
    if (documentTarget.visibilityState === "visible") void refreshNow();
  };
  const onCryptoChange = () => { void refreshNow(); };

  documentTarget.addEventListener("visibilitychange", onResume);
  windowTarget.addEventListener("focus", onResume);
  windowTarget.addEventListener("pageshow", onResume);
  unsubscribeChanges = options.subscribeToChanges?.(onCryptoChange) ?? (() => {});
  pollTimer = scheduleInterval(() => {
    if (documentTarget.visibilityState === "visible") void refreshNow();
  }, pollIntervalMs);
  void refreshNow();

  return { refreshNow, dispose };
}
