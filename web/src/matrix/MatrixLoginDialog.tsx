import { useState } from "react";
import { Modal } from "../components/Modal.js";
import type { LocusWebSession } from "../session/types.js";
import { connectMatrixSession } from "./MatrixConnector.js";
import type { ControlClaimDeploymentDescriptor } from "../network/types.js";

export function MatrixLoginDialog({ open, onClose, onConnected, matrixControlClaim }: { open: boolean; onClose: () => void; onConnected: (session: LocusWebSession) => void; matrixControlClaim?: { client: unknown; deployment: ControlClaimDeploymentDescriptor } }) {
  const [userId, setUserId] = useState("");
  const [password, setPassword] = useState("");
  const [homeserver, setHomeserver] = useState("");
  const [advanced, setAdvanced] = useState(false);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState("");

  async function login() {
    setWorking(true);
    setError("");
    try {
      const connected = await connectMatrixSession(userId.trim(), password, advanced ? homeserver.trim() || undefined : undefined, matrixControlClaim);
      // The current JamScript release exposes the proof codec and SignedActionV2
      // actAs field, but does not yet expose a chain ControlClaim bootstrap ingress.
      // Do not present a local session as authorized when the on-chain claim cannot
      // be established.
      if (!connected.bootstrapper) {
        connected.crypto.dispose();
        connected.client.stopClient();
        throw new Error("CONTROL_CLAIM_FAILED: this JamScript release has no Matrix ControlClaim bootstrap endpoint");
      }
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

  return (
    <Modal open={open} title="Connect Matrix" onClose={onClose} footer={<><button type="button" className="secondary" onClick={onClose}>Cancel</button><button type="button" className="primary modal-primary" disabled={working || !userId.trim() || !password} onClick={login}>{working ? "Connecting…" : "Connect Matrix"}</button></>}>
      <p className="modal-lead">Locus uses your Matrix cross-signing master key as Ownership and a verified device as its controller.</p>
      <div className="form-grid">
        <label>Matrix ID<input autoComplete="username" value={userId} placeholder="@alice:example.org" onChange={(event) => setUserId(event.target.value)} /></label>
        <label>Password<input type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} /></label>
      </div>
      <button type="button" className="text-button" onClick={() => setAdvanced((value) => !value)}>{advanced ? "Hide advanced" : "Advanced homeserver"}</button>
      {advanced && <label>Homeserver URL<input value={homeserver} placeholder="https://matrix.example.org" onChange={(event) => setHomeserver(event.target.value)} /></label>}
      {error && <div className="transaction-error">{error}</div>}
      <p className="modal-note">Your password is used only for login and is never stored. Device verification and ControlClaim authorization are explicit steps.</p>
    </Modal>
  );
}
