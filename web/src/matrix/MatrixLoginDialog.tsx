import { useEffect, useRef, useState } from "react";
import { Modal } from "../components/Modal.js";
import type { LocusWebSession } from "../session/types.js";
import { connectMatrixSession, type MatrixConnected, type MatrixConnectionState } from "./MatrixConnector.js";
import { discoverHomeserver } from "./MatrixConnector.js";
import { beginMatrixOAuth, beginMatrixSso, discoverMatrixAuthCapabilities, type MatrixAuthCapabilities } from "./MatrixOAuth.js";
import type { LocusClient } from "@archelabs/locus";

function verificationTitle(state: MatrixConnectionState): string {
  switch (state) {
    case "AUTHENTICATED": return "Signed in to Matrix";
    case "DEVICE_KEYS_READY": return "Locus device is ready";
    case "VERIFICATION_REQUIRED": return "Verification required";
    case "VERIFICATION_REQUESTED": return "Verification requested";
    case "VERIFICATION_SAS_READY": return "Compare these emoji";
    case "VERIFICATION_CONFIRMING": return "Verification confirmed";
    case "VERIFIED": return "Device verified";
    case "CONTROLLER_BOOTSTRAPPING": return "Authorizing device";
    case "CONTROLLER_BOOTSTRAP_QUEUED": return "Authorization queued";
    case "CONTROLLER_BOOTSTRAP_FINALIZING": return "Authorizing device";
    case "CONTROLLER_BOOTSTRAP_UNKNOWN": return "Authorization status unavailable";
    case "CONTROLLER_AUTHORIZATION_FAILED": return "Authorization needs attention";
    case "READY": return "Connected";
  }
}

export function MatrixLoginDialog({ open, onClose, onCancel, onConnected, locus, initialConnection = null }: {
  open: boolean;
  onClose: () => void;
  onCancel: (connection: MatrixConnected | null) => void;
  onConnected: (session: LocusWebSession) => void;
  locus: LocusClient | null;
  initialConnection?: MatrixConnected | null;
}) {
  const [userId, setUserId] = useState("");
  const [password, setPassword] = useState("");
  const [homeserver, setHomeserver] = useState("");
  const [advanced, setAdvanced] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [authCapabilities, setAuthCapabilities] = useState<MatrixAuthCapabilities | null>(null);
  const [deviceIdCopied, setDeviceIdCopied] = useState(false);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState("");
  const [pendingConnection, setPendingConnection] = useState<MatrixConnected | null>(initialConnection);
  const [connectionState, setConnectionState] = useState<MatrixConnectionState>(initialConnection?.state ?? "AUTHENTICATED");
  const [, refreshConnection] = useState(0);
  const authAttempt = useRef(0);
  const passwordAbort = useRef<AbortController | null>(null);

  useEffect(() => {
    if (!initialConnection) return;
    setPendingConnection(initialConnection);
    setConnectionState(initialConnection.state);
    setUserId(initialConnection.stored.userId);
    setHomeserver(initialConnection.stored.homeserver);
    setError(initialConnection.error);
  }, [initialConnection]);

  useEffect(() => {
    if (!pendingConnection) return;
    const refresh = () => {
      setConnectionState(pendingConnection.state);
      setError(pendingConnection.error);
      refreshConnection((value) => value + 1);
      if (pendingConnection.state === "READY") {
        const connected = pendingConnection;
        setPendingConnection(null);
        onConnected(connected.session);
        onClose();
      }
    };
    const unsubscribe = pendingConnection.subscribe(refresh);
    refresh();
    return unsubscribe;
  }, [onClose, onConnected, pendingConnection]);

  async function continueWithMatrix() {
    setWorking(true);
    setError("");
    try {
      if (!userId.trim()) throw new Error("Enter a Matrix ID first so Locus can discover its homeserver.");
      const discovered = await discoverHomeserver(userId.trim(), advanced ? homeserver.trim() || undefined : undefined);
      const capabilities = await discoverMatrixAuthCapabilities(discovered);
      setAuthCapabilities(capabilities);
      setShowPassword(false);
      if (capabilities.mode === "oauth") {
        await beginMatrixOAuth(discovered, userId.trim(), capabilities);
      } else if (!capabilities.sso && !capabilities.password) {
        setError("This homeserver does not advertise a supported Matrix login method (OAuth, SSO, or password).");
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Matrix OAuth sign-in could not start.");
    } finally { setWorking(false); }
  }

  async function startSso() {
    setWorking(true);
    setError("");
    try {
      if (!userId.trim()) throw new Error("Enter a Matrix ID first so Locus can discover its homeserver.");
      const discovered = await discoverHomeserver(userId.trim(), advanced ? homeserver.trim() || undefined : undefined);
      if (!authCapabilities) throw new Error("Discover this homeserver’s supported login methods first.");
      await beginMatrixSso(discovered, userId.trim(), authCapabilities);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Matrix SSO sign-in could not start."); }
    finally { setWorking(false); }
  }

  async function passwordLogin() {
    if (authCapabilities?.mode !== "legacy" || !authCapabilities.password) {
      setError("This homeserver has not advertised password login.");
      return;
    }
    const attempt = ++authAttempt.current;
    const abortController = new AbortController();
    passwordAbort.current = abortController;
    setWorking(true);
    setError("");
    try {
      const connected = await connectMatrixSession(
        userId.trim(),
        password,
        advanced ? homeserver.trim() || undefined : undefined,
        { locus, onState: setConnectionState, signal: abortController.signal },
      );
      if (attempt !== authAttempt.current) {
        connected.session.cleanup?.();
        return;
      }
      if (connected.state === "READY") {
        onConnected(connected.session);
        onClose();
        return;
      }
      setPendingConnection(connected);
      setConnectionState(connected.state);
      setError(connected.error);
      setPassword("");
    } catch (cause) {
      if (attempt === authAttempt.current) setError(cause instanceof Error ? cause.message : "Matrix sign-in failed.");
    } finally {
      if (passwordAbort.current === abortController) passwordAbort.current = null;
      if (attempt === authAttempt.current) { setPassword(""); setWorking(false); }
    }
  }

  async function performVerification(action: () => Promise<void>) {
    if (!pendingConnection) return;
    setWorking(true);
    setError("");
    try { await action(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Matrix verification failed."); }
    finally { setWorking(false); }
  }

  function cancel() {
    authAttempt.current += 1;
    passwordAbort.current?.abort();
    passwordAbort.current = null;
    onCancel(pendingConnection);
    setPendingConnection(null);
    setPassword("");
    setWorking(false);
    setError("");
    setShowPassword(false);
    setAuthCapabilities(null);
    setDeviceIdCopied(false);
    onClose();
  }

  async function copyDeviceId() {
    const deviceId = pendingConnection?.stored.deviceId;
    if (!deviceId) return;
    try {
      await navigator.clipboard.writeText(deviceId);
      setDeviceIdCopied(true);
      window.setTimeout(() => setDeviceIdCopied(false), 1800);
    } catch {
      setError("Could not copy the Matrix device ID. Select and copy it manually.");
    }
  }

  const verification = pendingConnection?.verification ?? null;
  const showingVerification = Boolean(pendingConnection);
  const canCompare = connectionState === "VERIFICATION_SAS_READY" && verification?.phase === "sas-ready";
  const legacyCapabilities = authCapabilities?.mode === "legacy" ? authCapabilities : null;
  return (
    <Modal open={open} title="Connect Matrix" onClose={cancel} footer={<>
      <button type="button" className="secondary" onClick={cancel}>Cancel</button>
      {connectionState === "CONTROLLER_AUTHORIZATION_FAILED" && <button type="button" className="primary modal-primary" disabled={working} onClick={() => void performVerification(() => pendingConnection!.retryControllerAuthorization())}>{working ? "Retrying…" : "Retry authorization"}</button>}
      {(connectionState === "CONTROLLER_BOOTSTRAP_QUEUED" || connectionState === "CONTROLLER_BOOTSTRAP_FINALIZING" || connectionState === "CONTROLLER_BOOTSTRAP_UNKNOWN") && <button type="button" className="primary modal-primary" disabled={working} onClick={() => void performVerification(() => pendingConnection!.retryControllerAuthorization())}>{working ? "Checking…" : "Check authorization status"}</button>}
      {showingVerification && verification?.phase === "requested" && !verification.startedByLocus && <button type="button" className="primary modal-primary" disabled={working} onClick={() => void performVerification(() => pendingConnection!.startVerification())}>{working ? "Starting…" : "Accept verification"}</button>}
      {canCompare && <>
        <button type="button" className="secondary" disabled={working} onClick={() => void performVerification(() => pendingConnection!.confirmVerification(false))}>They don’t match</button>
        <button type="button" className="primary modal-primary" disabled={working} onClick={() => void performVerification(() => pendingConnection!.confirmVerification(true))}>They match</button>
      </>}
    </>}>
      <p className="modal-lead">Sign in to Matrix with this homeserver’s supported login method. Then verify Locus as a trusted second Matrix device in Element. A verified device signs through its device key; your cross-signing master key remains the Locus Ownership.</p>
      {showingVerification ? <div className="matrix-verification-flow" aria-live="polite">
        <section className="verification-card">
          <strong>{verificationTitle(connectionState)}</strong>
          {(connectionState === "VERIFICATION_REQUIRED" || (connectionState === "VERIFICATION_REQUESTED" && verification?.startedByLocus)) && <>
            <p>Locus has requested verification from your other Matrix devices. On this phone, switch to Element and accept the incoming SAS request. Element is a trusted second Matrix device; it is separate from signing in to Locus.</p>
            <ol className="matrix-verification-steps">
              <li>Switch to Element on this phone.</li>
              <li>Accept the incoming verification request for the new <strong>Locus</strong> device. If it is not visible, open Sessions or Security, find the Locus session, and choose Verify.</li>
              <li>Accept SAS verification in Element, then return here and compare the emoji.</li>
            </ol>
            {(connectionState === "VERIFICATION_REQUIRED" || (connectionState === "VERIFICATION_REQUESTED" && verification?.startedByLocus)) && <button type="button" className="secondary full" disabled={working} onClick={() => void performVerification(() => pendingConnection!.requestOwnUserVerification())}>{working ? "Requesting verification…" : verification?.startedByLocus ? "Retry request delivery" : "Request verification again"}</button>}
            <details className="matrix-device-id matrix-device-id--troubleshooting">
              <summary>Troubleshooting: device ID</summary>
              <span>Your Locus Matrix device ID</span>
              <code>{pendingConnection!.stored.deviceId}</code>
              <button type="button" className="secondary" onClick={() => void copyDeviceId()}>{deviceIdCopied ? "Copied" : "Copy device ID"}</button>
            </details>
          </>}
          {connectionState === "VERIFICATION_REQUESTED" && !verification?.startedByLocus && (verification?.phase === "sas-waiting"
            ? <p>Locus accepted the request from Element device <code>{verification.otherDeviceId}</code>. Waiting for Element to accept SAS verification…</p>
            : <p>A verification request arrived from Element device <code>{verification?.otherDeviceId ?? "Unknown device"}</code>. Accept it here to continue.</p>)}
          {verification?.startedByLocus && verification.phase === "sas-waiting" && <p>Verification request sent to your other Matrix devices. Accept it in Element; Locus will continue when Element responds.</p>}
          {connectionState === "VERIFICATION_SAS_READY" && <p>Compare these emoji with the other device in Element. Confirm only when all seven match.</p>}
          {connectionState === "VERIFICATION_CONFIRMING" && <p>Verification was confirmed. Locus is waiting for the Matrix cross-signing proof before it can authorize this device.</p>}
          {connectionState === "VERIFIED" && <p>The public M → S → D signatures are verified. Authorizing this device for Locus…</p>}
          {connectionState === "CONTROLLER_BOOTSTRAPPING" && <p>Matrix verification is complete. Waiting for MiniJAM to confirm this device’s controller authorization…</p>}
          {connectionState === "CONTROLLER_BOOTSTRAP_QUEUED" && <p>The authorization transaction is queued. Keep this window open. Locus will continue checking it in the background; do not repeat Matrix verification.</p>}
          {connectionState === "CONTROLLER_BOOTSTRAP_FINALIZING" && <p>The authorization transaction was submitted. Waiting for MiniJAM to finalize it…</p>}
          {connectionState === "CONTROLLER_BOOTSTRAP_UNKNOWN" && <p>The authorization transaction is still pending or its status is temporarily unavailable. Your Matrix device remains verified. Check its status here; do not repeat verification.</p>}
          {connectionState === "CONTROLLER_AUTHORIZATION_FAILED" && <p>Matrix verification is complete, but Locus could not finish authorizing this device. The error is shown below. Retry after addressing it.</p>}
          {connectionState === "AUTHENTICATED" || connectionState === "DEVICE_KEYS_READY" ? <p>Preparing the Locus Matrix device. Keep this window open.</p> : null}
          {canCompare && <div className="matrix-sas-emojis" aria-label="Short authentication string emojis">
            {verification.emojis.map((emoji, index) => <span className="matrix-sas-emoji" key={`${index}-${emoji.symbol}`} title={emoji.description}><span aria-hidden="true">{emoji.symbol}</span><small>{emoji.description}</small></span>)}
          </div>}
          {verification?.phase === "sas-waiting" && !verification.startedByLocus && <p>Waiting for Element to accept SAS verification…</p>}
          {verification?.phase === "confirming" && <p>Waiting for Element to confirm and publish the cross-signing proof…</p>}
          {verification?.phase === "cancelled" && <p>The verification was cancelled. You can send a fresh request when ready.</p>}
          {verification && verification.phase !== "done" && <button type="button" className="text-button" disabled={working} onClick={() => void performVerification(() => pendingConnection!.cancelVerification())}>Cancel verification</button>}
        </section>
      </div> : <>
        <label className="matrix-id-field">Matrix ID<input autoComplete="username" disabled={working} value={userId} placeholder="@alice:example.org" onChange={(event) => { setUserId(event.target.value); setAuthCapabilities(null); setError(""); setShowPassword(false); }} /></label>
        <button type="button" className="primary matrix-auth-button" disabled={working || !userId.trim()} onClick={() => void continueWithMatrix()}>{working ? "Checking Matrix sign-in…" : authCapabilities?.mode === "legacy" ? "Refresh sign-in options" : "Continue with Matrix"}</button>
        <p className="auth-caption">Locus checks Matrix authentication metadata first. OAuth uses authorization code with PKCE S256; legacy methods appear only when the homeserver advertises them.</p>
        {authCapabilities?.mode === "oauth" && <p className="auth-capability-note">This homeserver advertises OAuth. SSO and password fallback are not enabled for this login.</p>}
        {legacyCapabilities && (legacyCapabilities.sso || legacyCapabilities.password) && <div className="legacy-auth-options">
          <strong>Supported sign-in options</strong>
          <p>Matrix OAuth metadata is unavailable. Choose a legacy method advertised by this homeserver.</p>
          {legacyCapabilities.sso && <button type="button" className="secondary full" disabled={working || !userId.trim()} onClick={() => void startSso()}>Continue with Matrix SSO</button>}
          {legacyCapabilities.password && <>
            <button type="button" className="text-button legacy-password-toggle" onClick={() => setShowPassword((value) => !value)}>{showPassword ? "Hide password sign-in" : "Use password instead"}</button>
            {showPassword && <div className="password-fallback">
            <label>Password<input autoComplete="current-password" type="password" value={password} onChange={(event) => setPassword(event.target.value)} /></label>
            <button type="button" className="secondary full" disabled={working || !password} onClick={passwordLogin}>{working ? "Signing in…" : "Sign in with password"}</button>
            </div>}
          </>}
        </div>}
        {legacyCapabilities && !legacyCapabilities.sso && !legacyCapabilities.password && <div className="matrix-unsupported-note" role="status">This homeserver does not advertise Matrix SSO or password login. Ask its administrator which sign-in methods are supported.</div>}
        <button type="button" className="text-button advanced-toggle" onClick={() => { setAdvanced((value) => !value); setAuthCapabilities(null); }}>{advanced ? "Hide homeserver settings" : "Use a custom homeserver"}</button>
        {advanced && <label className="matrix-id-field">Homeserver URL<input disabled={working} value={homeserver} placeholder="https://matrix.example.org" onChange={(event) => { setHomeserver(event.target.value); setAuthCapabilities(null); setError(""); setShowPassword(false); }} /></label>}
      </>}
      {error && <div className="transaction-error" role="alert">{error}</div>}
      <p className="modal-note">Locus never stores your Matrix password. Device verification is required before Matrix can authorize an identity.</p>
    </Modal>
  );
}
