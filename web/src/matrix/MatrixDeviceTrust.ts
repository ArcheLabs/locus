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

/** OwnUserIdentity.masterKey is a JSON-encoded CrossSigningKey, not Base64. */
export function matrixMasterPublicKeyFromSdk(serialized: string, userId: string): string | null {
  let key: unknown;
  try { key = JSON.parse(serialized); }
  catch { return null; }
  if (!key || typeof key !== "object" || Array.isArray(key)) return null;
  const candidate = key as { user_id?: unknown; usage?: unknown; keys?: unknown };
  if (candidate.user_id !== userId
    || !Array.isArray(candidate.usage) || candidate.usage.length !== 1 || candidate.usage[0] !== "master"
    || !candidate.keys || typeof candidate.keys !== "object" || Array.isArray(candidate.keys)) return null;
  const entries = Object.entries(candidate.keys).filter(([id]) => id.startsWith("ed25519:"));
  if (entries.length !== 1) return null;
  const value = entries[0][1];
  if (typeof value !== "string" || !/^[A-Za-z0-9+/_-]+={0,2}$/.test(value)) return null;
  try {
    const normalized = value.replace(/-/g, "+").replace(/_/g, "/").replace(/=+$/, "");
    const decoded = atob(normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "="));
    return decoded.length === 32 ? value : null;
  } catch { return null; }
}

/**
 * Trust policy for Locus's current Matrix device.
 *
 * Confirm the SDK-validated M→S→D chain for the master and device keys bound
 * to this login's Locus ownership. Locus still validates and authorizes the
 * ownership proof before READY. This is not a general E2EE recipient policy.
 *
 * Local identity verification is separate: an externally signed device can
 * have a valid owner signature while this fresh OlmMachine has not verified
 * the master locally. Requiring isVerified/isCrossSigningTrusted here would
 * reject the external verification supported by the existing proof protocol.
 * Neither a local device trust mark nor raw server signature presence suffices.
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
  if (!signals.identityTrustsOwnDevice || !signals.deviceCrossSignedByOwner) {
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
