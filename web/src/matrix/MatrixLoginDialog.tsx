import { useEffect, useRef, useState } from "react";
import { Modal } from "../components/Modal.js";
import { IdentityIcon } from "../components/IdentityIcon.js";
import type { LocusWebSession } from "../session/types.js";
import { connectMatrixPasswordSession, readStoredMatrixSession, restoreMatrixSession, signOutMatrixSession, type MatrixConnected, type MatrixConnectionState } from "./MatrixConnector.js";
import { beginMatrixOAuth, beginMatrixSso, discoverMatrixAuthCapabilities, type MatrixAuthCapabilities } from "./MatrixOAuth.js";
import { DEFAULT_MATRIX_PROVIDER, resolveMatrixServer } from "./MatrixProvider.js";
import type { LocusClient } from "@archelabs/locus";
import { ArrowLeft, ArrowRight, Check, ClipboardCopy, LogIn, RefreshCw, ShieldCheck, X } from "lucide-react";
import { ActionButton } from "../components/ActionButton.js";

type MatrixLoginStage = "saved-account" | "provider" | "custom-server" | "discovering" | "legacy-options" | "password" | "verification";

function verificationTitle(state: MatrixConnectionState): string {
  switch (state) {
    case "AUTHENTICATED": return "Signed in to Matrix";
    case "DEVICE_KEYS_READY": return "Locus device is ready";
    case "VERIFICATION_REQUIRED": return "Verification required";
    case "VERIFICATION_REQUESTED": return "Verification requested";
    case "VERIFICATION_SAS_READY": return "Compare these emoji";
    case "VERIFICATION_CONFIRMING": return "Verification confirmed";
    case "VERIFIED": return "Device verified";
    case "CONTROLLER_AUTHORIZING": return "Authorizing device";
    case "CONTROLLER_AUTHORIZATION_QUEUED": return "Authorization pending";
    case "CONTROLLER_AUTHORIZATION_FINALIZING": return "Authorizing device";
    case "CONTROLLER_AUTHORIZATION_UNKNOWN": return "Status unavailable";
    case "CONTROLLER_REVOKED": return "Device revoked";
    case "CONTROLLER_AUTHORIZATION_FAILED": return "Authorization failed";
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
  const [stage, setStage] = useState<MatrixLoginStage>(initialConnection ? "verification" : readStoredMatrixSession() ? "saved-account" : "provider");
  const [returnStage, setReturnStage] = useState<"provider" | "custom-server">("provider");
  const [selectedServer, setSelectedServer] = useState("");
  const [customServer, setCustomServer] = useState("");
  const [passwordUser, setPasswordUser] = useState("");
  const [password, setPassword] = useState("");
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
    if (!open) return;
    if (initialConnection) {
      setPendingConnection(initialConnection);
      setConnectionState(initialConnection.state);
      setSelectedServer(initialConnection.stored.homeserver);
      setStage("verification");
      setError(initialConnection.error);
      return;
    }
    setPendingConnection(null);
    setConnectionState("AUTHENTICATED");
    setStage(readStoredMatrixSession() ? "saved-account" : "provider");
    setError("");
  }, [initialConnection, open]);

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

  async function startMatrixAuthentication(serverInput: string, origin: "provider" | "custom-server") {
    const attempt = ++authAttempt.current;
    setWorking(true);
    setError("");
    setStage("discovering");
    try {
      const discovered = await resolveMatrixServer(serverInput);
      if (attempt !== authAttempt.current) return;
      setSelectedServer(discovered);
      setReturnStage(origin);
      const capabilities = await discoverMatrixAuthCapabilities(discovered);
      if (attempt !== authAttempt.current) return;
      setAuthCapabilities(capabilities);
      if (capabilities.mode === "oauth") {
        await beginMatrixOAuth(discovered, capabilities);
      } else if (capabilities.sso) {
        setStage("legacy-options");
      } else if (capabilities.password) {
        setStage("password");
      } else {
        setStage("legacy-options");
      }
    } catch (cause) {
      if (attempt === authAttempt.current) {
        setStage(origin);
        setError(cause instanceof Error ? cause.message : "Matrix sign-in could not start.");
      }
    } finally { if (attempt === authAttempt.current) setWorking(false); }
  }

  async function startSso() {
    setWorking(true);
    setError("");
    try {
      if (!selectedServer || !authCapabilities) throw new Error("Choose a Matrix server and discover its supported login methods first.");
      await beginMatrixSso(selectedServer, authCapabilities);
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
      const connected = await connectMatrixPasswordSession(
        selectedServer,
        passwordUser.trim(),
        password,
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
      setStage("verification");
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

  async function reconnectSavedMatrixDevice() {
    const stored = readStoredMatrixSession();
    if (!stored) {
      setStage("provider");
      setError("The saved Matrix session is no longer available. Sign in to Matrix to create a device.");
      return;
    }
    const attempt = ++authAttempt.current;
    setWorking(true);
    setError("");
    try {
      const connected = await restoreMatrixSession(stored, { locus, onState: setConnectionState });
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
      setSelectedServer(stored.homeserver);
      setStage("verification");
      setError(connected.error);
    } catch (cause) {
      if (attempt === authAttempt.current) {
        setStage(readStoredMatrixSession() ? "saved-account" : "provider");
        setError(cause instanceof Error ? cause.message : "Could not restore the saved Matrix device.");
      }
    } finally {
      if (attempt === authAttempt.current) setWorking(false);
    }
  }

  async function useDifferentMatrixAccount() {
    const stored = readStoredMatrixSession();
    if (!stored) {
      setStage("provider");
      return;
    }
    setWorking(true);
    setError("");
    try {
      await signOutMatrixSession(stored);
      setPendingConnection(null);
      setStage("provider");
    } catch (cause) {
      setStage(readStoredMatrixSession() ? "saved-account" : "provider");
      setError(cause instanceof Error ? cause.message : "Could not sign out of the saved Matrix device.");
    } finally {
      setWorking(false);
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
    setStage("provider");
    setReturnStage("provider");
    setSelectedServer("");
    setCustomServer("");
    setPasswordUser("");
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
      <ActionButton variant="secondary" icon={X} onClick={cancel}>Cancel</ActionButton>
      {connectionState === "CONTROLLER_AUTHORIZATION_FAILED" && <ActionButton variant="primary" icon={RefreshCw} loading={working} disabled={working} onClick={() => void performVerification(() => pendingConnection!.retryControllerAuthorization())}>Retry</ActionButton>}
      {(connectionState === "CONTROLLER_AUTHORIZATION_QUEUED" || connectionState === "CONTROLLER_AUTHORIZATION_FINALIZING" || connectionState === "CONTROLLER_AUTHORIZATION_UNKNOWN") && <ActionButton variant="primary" icon={RefreshCw} loading={working} disabled={working} onClick={() => void performVerification(() => pendingConnection!.retryControllerAuthorization())}>Check status</ActionButton>}
      {showingVerification && verification?.phase === "requested" && !verification.startedByLocus && <ActionButton variant="primary" icon={ShieldCheck} loading={working} disabled={working} onClick={() => void performVerification(() => pendingConnection!.startVerification())}>Accept</ActionButton>}
      {canCompare && <>
        <ActionButton variant="secondary" icon={X} loading={working} disabled={working} onClick={() => void performVerification(() => pendingConnection!.confirmVerification(false))}>They don’t match</ActionButton>
        <ActionButton variant="primary" icon={Check} loading={working} disabled={working} onClick={() => void performVerification(() => pendingConnection!.confirmVerification(true))}>They match</ActionButton>
      </>}
    </>}>
      {!showingVerification && <p className="modal-lead">Sign in with your Matrix account.</p>}
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
            {(connectionState === "VERIFICATION_REQUIRED" || (connectionState === "VERIFICATION_REQUESTED" && verification?.startedByLocus)) && <ActionButton variant="secondary" icon={RefreshCw} fullWidth loading={working} disabled={working} onClick={() => void performVerification(() => pendingConnection!.requestOwnUserVerification())}>{verification?.startedByLocus ? "Retry request delivery" : "Request verification again"}</ActionButton>}
            <details className="matrix-device-id matrix-device-id--troubleshooting">
              <summary>Troubleshooting: device ID</summary>
              <span>Your Locus Matrix device ID</span>
              <code>{pendingConnection!.stored.deviceId}</code>
              <ActionButton size="small" variant="secondary" icon={ClipboardCopy} onClick={() => void copyDeviceId()}>{deviceIdCopied ? "Copied" : "Copy device ID"}</ActionButton>
            </details>
          </>}
          {connectionState === "VERIFICATION_REQUESTED" && !verification?.startedByLocus && (verification?.phase === "sas-waiting"
            ? <p>Locus accepted the request from Element device <code>{verification.otherDeviceId}</code>. Waiting for Element to accept SAS verification…</p>
            : <p>A verification request arrived from Element device <code>{verification?.otherDeviceId ?? "Unknown device"}</code>. Accept it here to continue.</p>)}
          {verification?.startedByLocus && verification.phase === "sas-waiting" && <p>Verification request sent to your other Matrix devices. Accept it in Element; Locus will continue when Element responds.</p>}
          {connectionState === "VERIFICATION_SAS_READY" && <p>Compare these emoji with the other device in Element. Confirm only when all seven match.</p>}
          {connectionState === "VERIFICATION_CONFIRMING" && <p>Verification complete. Waiting for Matrix proof…</p>}
          {connectionState === "VERIFIED" && <p>Device verified. Authorizing…</p>}
          {connectionState === "CONTROLLER_AUTHORIZING" && <p>Waiting for MiniJAM confirmation…</p>}
          {connectionState === "CONTROLLER_AUTHORIZATION_QUEUED" && <p>Checking in the background…</p>}
          {connectionState === "CONTROLLER_AUTHORIZATION_FINALIZING" && <p>Waiting for MiniJAM confirmation…</p>}
          {connectionState === "CONTROLLER_AUTHORIZATION_UNKNOWN" && <p>Authorization is still pending. Check again here.</p>}
          {connectionState === "CONTROLLER_AUTHORIZATION_FAILED" && <p>Could not authorize this device. Check the error and retry.</p>}
          {connectionState === "CONTROLLER_REVOKED" && <p>This device was revoked. Sign in again on a new Matrix device.</p>}
          {connectionState === "AUTHENTICATED" || connectionState === "DEVICE_KEYS_READY" ? <p>Preparing Matrix device…</p> : null}
          {canCompare && <div className="matrix-sas-emojis" aria-label="Short authentication string emojis">
            {verification.emojis.map((emoji, index) => <span className="matrix-sas-emoji" key={`${index}-${emoji.symbol}`} title={emoji.description}><span aria-hidden="true">{emoji.symbol}</span><small>{emoji.description}</small></span>)}
          </div>}
          {verification?.phase === "sas-waiting" && !verification.startedByLocus && <p>Waiting for Element to accept SAS verification…</p>}
          {verification?.phase === "confirming" && <p>Waiting for Element to confirm and publish the cross-signing proof…</p>}
          {verification?.phase === "cancelled" && <p>The verification was cancelled. You can send a fresh request when ready.</p>}
          {verification && verification.phase !== "done" && <ActionButton size="small" variant="tertiary" icon={X} disabled={working} onClick={() => void performVerification(() => pendingConnection!.cancelVerification())}>Cancel verification</ActionButton>}
        </section>
      </div> : <>
        {stage === "saved-account" && (() => {
          const stored = readStoredMatrixSession();
          return stored ? <div className="matrix-login-options">
            <div className="matrix-provider-choice">
              <span className="identity-icon-slot"><IdentityIcon kind="matrix" size={24} /></span>
              <span className="matrix-provider-copy"><strong>{stored.userId}</strong><small>Reconnect this Matrix account with its saved Locus device</small></span>
              <ActionButton className="matrix-auth-button" variant="primary" icon={LogIn} fullWidth loading={working} disabled={working} onClick={() => void reconnectSavedMatrixDevice()}>Reconnect Matrix</ActionButton>
            </div>
            <ActionButton variant="secondary" icon={ArrowRight} fullWidth disabled={working} onClick={() => void useDifferentMatrixAccount()}>Sign in with another Matrix account</ActionButton>
            <p className="auth-caption">Using another account removes this saved Locus device. The new device will need verification.</p>
          </div> : <div className="matrix-discovery-status" role="status">The saved Matrix session is unavailable. Choose a Matrix sign-in method.</div>;
        })()}
        {stage === "provider" && <div className="matrix-login-options">
          <div className="matrix-provider-choice">
            <span className="identity-icon-slot"><IdentityIcon kind="matrix" size={24} /></span>
            <span className="matrix-provider-copy"><strong>{DEFAULT_MATRIX_PROVIDER.label}</strong><small>Sign in with your Matrix account</small></span>
            <ActionButton className="matrix-auth-button" variant="primary" icon={LogIn} fullWidth loading={working} disabled={working} onClick={() => void startMatrixAuthentication(DEFAULT_MATRIX_PROVIDER.server, "provider")}>Continue with Matrix.org</ActionButton>
          </div>
          <ActionButton variant="secondary" icon={ArrowRight} fullWidth disabled={working} onClick={() => { setError(""); setStage("custom-server"); }}>Use another Matrix server</ActionButton>
        </div>}

        {stage === "custom-server" && <div className="matrix-login-step">
          <label className="matrix-id-field">Matrix server<input autoComplete="url" disabled={working} value={customServer} placeholder="example.org or https://matrix.example.org" onChange={(event) => { setCustomServer(event.target.value); setError(""); }} /></label>
          <p className="auth-caption">Choose the Matrix server that hosts your account. You will sign in with that server next.</p>
          <ActionButton className="matrix-auth-button" variant="primary" icon={LogIn} fullWidth loading={working} disabled={working || !customServer.trim()} onClick={() => void startMatrixAuthentication(customServer, "custom-server")}>Continue</ActionButton>
          <ActionButton variant="tertiary" icon={ArrowLeft} disabled={working} onClick={() => { setStage("provider"); setError(""); }}>Back</ActionButton>
        </div>}

        {stage === "discovering" && <div className="matrix-discovery-status" role="status" aria-live="polite">
          <RefreshCw size={20} aria-hidden="true" />
          <span>Checking sign-in options for {returnStage === "provider" ? DEFAULT_MATRIX_PROVIDER.label : customServer.trim()}…</span>
        </div>}

        {stage === "legacy-options" && legacyCapabilities && <div className="legacy-auth-options">
          <strong>Sign in to {new URL(selectedServer).host}</strong>
          <p>This server does not advertise Matrix OAuth. Choose one of its supported sign-in methods.</p>
          {legacyCapabilities.sso && <ActionButton variant="primary" icon={LogIn} fullWidth loading={working} disabled={working} onClick={() => void startSso()}>Continue with Matrix SSO</ActionButton>}
          {legacyCapabilities.password && <ActionButton variant={legacyCapabilities.sso ? "secondary" : "primary"} icon={LogIn} fullWidth disabled={working} onClick={() => setStage("password")}>Use password instead</ActionButton>}
          {!legacyCapabilities.sso && !legacyCapabilities.password && <div className="matrix-unsupported-note" role="status">This Matrix server does not advertise a supported sign-in method. Ask its administrator which methods are available.</div>}
          <ActionButton size="small" variant="tertiary" icon={ArrowLeft} disabled={working} onClick={() => { setStage(returnStage); setAuthCapabilities(null); setError(""); }}>Back</ActionButton>
        </div>}

        {stage === "password" && legacyCapabilities?.password && <div className="password-fallback">
          <p>This server supports password sign-in. Your password is sent to the selected Matrix server and is never saved by Locus.</p>
          <label className="matrix-id-field">Matrix ID or username<input autoComplete="username" disabled={working} value={passwordUser} onChange={(event) => setPasswordUser(event.target.value)} /></label>
          <label>Password<input autoComplete="current-password" type="password" disabled={working} value={password} onChange={(event) => setPassword(event.target.value)} /></label>
          <ActionButton variant="primary" icon={LogIn} fullWidth loading={working} disabled={working || !passwordUser.trim() || !password} onClick={() => void passwordLogin()}>Sign in</ActionButton>
          <ActionButton variant="tertiary" icon={ArrowLeft} disabled={working} onClick={() => { setStage(legacyCapabilities.sso ? "legacy-options" : returnStage); setPassword(""); setError(""); }}>Back</ActionButton>
        </div>}
      </>}
      {error && !(stage === "custom-server" && !customServer.trim()) && !(stage === "password" && (!passwordUser.trim() || !password)) && <div className="transaction-error" role="alert">{error}</div>}
    </Modal>
  );
}
