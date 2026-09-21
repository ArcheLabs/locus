import { useState } from "react";
import { Modal } from "../components/Modal.js";
import type { LocusWebSession } from "../session/types.js";
import { connectMatrixSession, type MatrixConnected } from "./MatrixConnector.js";
import type { LocusClient } from "@archelabs/locus";

export function MatrixLoginDialog({ open, onClose, onConnected, locus }: { open: boolean; onClose: () => void; onConnected: (session: LocusWebSession) => void; locus: LocusClient | null }) {
  const [userId, setUserId] = useState("");
  const [password, setPassword] = useState("");
  const [homeserver, setHomeserver] = useState("");
  const [advanced, setAdvanced] = useState(false);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState("");
  const [pendingConnection, setPendingConnection] = useState<MatrixConnected | null>(null);

  async function login() {
    setWorking(true);
    setError("");
    try {
      const connected = pendingConnection
        ? await pendingConnection.checkVerification()
        : await connectMatrixSession(userId.trim(), password, advanced ? homeserver.trim() || undefined : undefined, { locus });
      if (connected.state === "AWAITING_VERIFICATION") {
        setPendingConnection(connected);
        setError("DEVICE_AWAITING_VERIFICATION: verify the Locus device in Element, then check again.");
        return;
      }
      if (connected.state !== "READY") throw new Error("CONTROLLER_NOT_AUTHORIZED: the Matrix device is not authorized for this network");
      setPendingConnection(null);
      onConnected(connected.session);
      setPassword("");
      onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Matrix connection failed.");
    } finally {
      setPassword("");
      setWorking(false);
    }
  }

  function close() {
    pendingConnection?.session.cleanup?.();
    setPendingConnection(null);
    setPassword("");
    onClose();
  }

  const awaitingVerification = pendingConnection?.state === "AWAITING_VERIFICATION";
  return (
    <Modal open={open} title="Connect Matrix" onClose={close} footer={<><button type="button" className="secondary" onClick={close}>Cancel</button><button type="button" className="primary modal-primary" disabled={working || (awaitingVerification ? false : !userId.trim() || !password)} onClick={login}>{working ? "Connecting…" : awaitingVerification ? "Check again" : "Connect Matrix"}</button></>}>
      <p className="modal-lead">Locus uses your Matrix cross-signing master key as Ownership and a verified device as its controller.</p>
      {awaitingVerification ? <div className="verification-card">
        <strong>Verify this Matrix device</strong>
        <p>Open Element or another trusted Matrix client and verify the device named “Locus”. The same device and crypto store will be reused when you check again.</p>
      </div> : <>
        <div className="form-grid">
          <label>Matrix ID<input autoComplete="username" value={userId} placeholder="@alice:example.org" onChange={(event) => setUserId(event.target.value)} /></label>
          <label>Password<input type="password" autoComplete="current-password" value={password} placeholder="Your Matrix password" onChange={(event) => setPassword(event.target.value)} /></label>
        </div>
        <button type="button" className="text-button" onClick={() => setAdvanced((value) => !value)}>{advanced ? "Hide advanced" : "Advanced homeserver"}</button>
        {advanced && <label>Homeserver URL<input value={homeserver} placeholder="https://matrix.example.org" onChange={(event) => setHomeserver(event.target.value)} /></label>}
      </>}
      {error && <div className="transaction-error">{error}</div>}
      <p className="modal-note">Your password is used only for login and is never stored. Device verification and local controller authorization are explicit steps.</p>
    </Modal>
  );
}
