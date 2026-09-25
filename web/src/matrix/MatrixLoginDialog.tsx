import { useEffect, useRef, useState } from "react";
import { Modal } from "../components/Modal.js";
import type { LocusWebSession } from "../session/types.js";
import { connectMatrixSession, type MatrixConnected, type MatrixConnectionState } from "./MatrixConnector.js";
import { discoverHomeserver } from "./MatrixConnector.js";
import { beginMatrixOAuth, beginMatrixSso } from "./MatrixOAuth.js";
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
    case "CONTROLLER_BOOTSTRAPPING": return "Authorizing this device for Locus…";
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
  const [showLegacy, setShowLegacy] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
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

  async function startOAuth() {
    setWorking(true);
    setError("");
    try {
      if (!userId.trim()) throw new Error("Enter a Matrix ID first so Locus can discover its homeserver.");
      const discovered = await discoverHomeserver(userId.trim(), advanced ? homeserver.trim() || undefined : undefined);
      await beginMatrixOAuth(discovered, userId.trim());
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Matrix OAuth sign-in could not start.");
      setShowLegacy(true);
    } finally { setWorking(false); }
  }

  async function startSso() {
    setWorking(true);
    setError("");
    try {
      if (!userId.trim()) throw new Error("Enter a Matrix ID first so Locus can discover its homeserver.");
      const discovered = await discoverHomeserver(userId.trim(), advanced ? homeserver.trim() || undefined : undefined);
      await beginMatrixSso(discovered, userId.trim());
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Matrix SSO sign-in could not start."); }
    finally { setWorking(false); }
  }

  async function passwordLogin() {
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
    setShowLegacy(false);
    setShowPassword(false);
    onClose();
  }

  const verification = pendingConnection?.verification ?? null;
  const showingVerification = Boolean(pendingConnection);
  const canCompare = connectionState === "VERIFICATION_SAS_READY" && verification?.phase === "sas-ready";
  return (
    <Modal open={open} title="Connect Matrix" onClose={cancel} footer={<>
      <button type="button" className="secondary" onClick={cancel}>Cancel</button>
      {showingVerification && verification?.phase === "requested" && <button type="button" className="primary modal-primary" disabled={working} onClick={() => void performVerification(() => pendingConnection!.startVerification())}>{working ? "Starting…" : "Start verification"}</button>}
      {canCompare && <>
        <button type="button" className="secondary" disabled={working} onClick={() => void performVerification(() => pendingConnection!.confirmVerification(false))}>They don’t match</button>
        <button type="button" className="primary modal-primary" disabled={working} onClick={() => void performVerification(() => pendingConnection!.confirmVerification(true))}>They match</button>
      </>}
    </>}>
      <p className="modal-lead">Use your Matrix cross-signing master key as the Locus Ownership. A verified Matrix device signs through its device key.</p>
      {showingVerification ? <div className="matrix-verification-flow" aria-live="polite">
        <section className="verification-card">
          <strong>{verificationTitle(connectionState)}</strong>
          {connectionState === "VERIFICATION_REQUIRED" && <p>Open Element and choose Verify for the Locus device. Keep this window open. A verification request will appear here.</p>}
          {connectionState === "VERIFICATION_REQUESTED" && (verification?.phase === "sas-waiting"
            ? <p>Locus accepted the request from Element device <code>{verification.otherDeviceId}</code>. Waiting for Element to accept SAS verification…</p>
            : <p>A verification request arrived from Element device <code>{verification?.otherDeviceId ?? "Unknown device"}</code>. Start the SAS verification here.</p>)}
          {connectionState === "VERIFICATION_SAS_READY" && <p>Compare these emoji with the other device in Element. Confirm only when all seven match.</p>}
          {connectionState === "VERIFICATION_CONFIRMING" && <p>Verification was confirmed. Locus is waiting for the Matrix cross-signing proof before it can authorize this device.</p>}
          {connectionState === "VERIFIED" && <p>The public M → S → D signatures are verified. Authorizing this device for Locus…</p>}
          {connectionState === "CONTROLLER_BOOTSTRAPPING" && <p>Authorizing this device for Locus…</p>}
          {connectionState === "AUTHENTICATED" || connectionState === "DEVICE_KEYS_READY" ? <p>Preparing the Locus Matrix device. Keep this window open.</p> : null}
          {canCompare && <div className="matrix-sas-emojis" aria-label="Short authentication string emojis">
            {verification.emojis.map((emoji, index) => <span className="matrix-sas-emoji" key={`${index}-${emoji.symbol}`} title={emoji.description}><span aria-hidden="true">{emoji.symbol}</span><small>{emoji.description}</small></span>)}
          </div>}
          {verification?.phase === "sas-waiting" && <p>Waiting for Element to accept SAS verification…</p>}
          {verification?.phase === "confirming" && <p>Waiting for Element to confirm and publish the cross-signing proof…</p>}
          {verification?.phase === "cancelled" && <p>The verification was cancelled. Start a new verification from Element when you are ready.</p>}
          {verification && verification.phase !== "done" && <button type="button" className="text-button" disabled={working} onClick={() => void performVerification(() => pendingConnection!.cancelVerification())}>Cancel verification</button>}
        </section>
      </div> : <>
        <label className="matrix-id-field">Matrix ID<input autoComplete="username" value={userId} placeholder="@alice:example.org" onChange={(event) => setUserId(event.target.value)} /></label>
        <button type="button" className="primary matrix-auth-button" disabled={working || !userId.trim()} onClick={startOAuth}>{working ? "Opening Matrix sign-in…" : "Continue with Matrix"}</button>
        <p className="auth-caption">Locus checks the homeserver’s OAuth metadata and uses authorization code with PKCE when supported.</p>
        {showLegacy && <div className="legacy-auth-options">
          <strong>Legacy sign-in options</strong>
          <p>This homeserver may not support Matrix OAuth, or OAuth setup failed.</p>
          <button type="button" className="secondary full" disabled={working || !userId.trim()} onClick={startSso}>Continue with Matrix SSO</button>
          <button type="button" className="text-button legacy-password-toggle" onClick={() => setShowPassword((value) => !value)}>{showPassword ? "Hide password sign-in" : "Use password instead"}</button>
          {showPassword && <div className="password-fallback">
            <label>Password<input autoComplete="current-password" type="password" value={password} onChange={(event) => setPassword(event.target.value)} /></label>
            <button type="button" className="secondary full" disabled={working || !password} onClick={passwordLogin}>{working ? "Signing in…" : "Sign in with password"}</button>
          </div>}
        </div>}
        <button type="button" className="text-button advanced-toggle" onClick={() => setAdvanced((value) => !value)}>{advanced ? "Hide homeserver settings" : "Use a custom homeserver"}</button>
        {advanced && <label className="matrix-id-field">Homeserver URL<input value={homeserver} placeholder="https://matrix.example.org" onChange={(event) => setHomeserver(event.target.value)} /></label>}
      </>}
      {error && <div className="transaction-error" role="alert">{error}</div>}
      <p className="modal-note">Locus never stores your Matrix password. Device verification is required before Matrix can authorize an identity.</p>
    </Modal>
  );
}
