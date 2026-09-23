import { useEffect, useState } from "react";
import { Modal } from "../components/Modal.js";
import type { LocusWebSession } from "../session/types.js";
import { connectMatrixSession, discoverHomeserver, type MatrixConnected } from "./MatrixConnector.js";
import { beginMatrixOAuth, beginMatrixSso } from "./MatrixOAuth.js";
import type { LocusClient } from "@archelabs/locus";

export function MatrixLoginDialog({ open, onClose, onConnected, locus, initialConnection = null }: {
  open: boolean;
  onClose: () => void;
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

  useEffect(() => {
    if (initialConnection) {
      setPendingConnection(initialConnection);
      setUserId(initialConnection.stored.userId);
      setHomeserver(initialConnection.stored.homeserver);
      setError("This device needs Matrix verification before it can control a Locus identity.");
    }
  }, [initialConnection]);

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
    setWorking(true);
    setError("");
    try {
      const connected = pendingConnection
        ? await pendingConnection.checkVerification()
        : await connectMatrixSession(userId.trim(), password, advanced ? homeserver.trim() || undefined : undefined, { locus });
      if (connected.state === "AWAITING_VERIFICATION") {
        setPendingConnection(connected);
        setError("Verify the device named “Locus” in Element, then check again here.");
        return;
      }
      if (connected.state !== "READY") throw new Error("This Matrix device is verified but is not authorized as an active Locus controller.");
      setPendingConnection(null);
      onConnected(connected.session);
      setPassword("");
      onClose();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Matrix sign-in failed."); }
    finally { setPassword(""); setWorking(false); }
  }

  function close() {
    pendingConnection?.session.cleanup?.();
    setPendingConnection(null);
    setPassword("");
    onClose();
  }

  const awaitingVerification = pendingConnection?.state === "AWAITING_VERIFICATION";
  return (
    <Modal open={open} title="Connect Matrix" onClose={close} footer={<>
      <button type="button" className="secondary" onClick={close}>Cancel</button>
      {awaitingVerification ? <button type="button" className="primary modal-primary" disabled={working} onClick={passwordLogin}>{working ? "Checking…" : "Check verification"}</button> : null}
    </>}>
      <p className="modal-lead">Use your Matrix cross-signing master key as the Locus Ownership. A verified Matrix device signs through its device key.</p>
      {awaitingVerification ? <div className="verification-card">
        <strong>Verify this Matrix device</strong>
        <p>Open Element or another trusted Matrix client and verify the device named “Locus”. Locus keeps this device ID stable across sign-in and browser restarts.</p>
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
