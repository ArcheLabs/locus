import { useMemo, useState } from "react";
import { Modal } from "../components/Modal.js";
import { connectBrowserSession, connectorInfo, hasEvmWallet, hasPolkadotWallet } from "./connectors.js";
import type { LocusWebSession, SessionKind } from "./types.js";

type Props = {
  open: boolean;
  onClose: () => void;
  onConnected: (session: LocusWebSession) => void;
};

function available(kind: SessionKind): boolean {
  if (kind === "evm") return hasEvmWallet();
  if (kind === "polkadot") return hasPolkadotWallet();
  return true;
}

export function ConnectDialog({ open, onClose, onConnected }: Props) {
  const [connecting, setConnecting] = useState<SessionKind | null>(null);
  const [error, setError] = useState("");
  const options = useMemo(() => connectorInfo.map((entry) => ({ ...entry, available: available(entry.kind) })), []);

  async function connect(kind: SessionKind) {
    setConnecting(kind);
    setError("");
    try {
      onConnected(await connectBrowserSession(kind));
      onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Wallet connection failed.");
    } finally {
      setConnecting(null);
    }
  }

  return (
    <Modal open={open} title="Connect" onClose={onClose}>
      <p className="modal-lead">Choose an Ownership signer. This does not select an execution network.</p>
      <div className="connect-options">
        {options.map((entry) => (
          <button key={entry.kind} type="button" className="connect-option" disabled={connecting !== null || !entry.available} onClick={() => connect(entry.kind)}>
            <span className={`wallet-mark ${entry.kind}`}>{entry.kind === "evm" ? "◇" : entry.kind === "polkadot" ? "◎" : "S"}</span>
            <span><strong>{entry.label}</strong><small>{connecting === entry.kind ? "Connecting…" : entry.available ? entry.description : "No compatible wallet detected"}</small></span>
            <span className="connect-arrow">›</span>
          </button>
        ))}
      </div>
      {error && <div className="transaction-error">{error}</div>}
      <p className="modal-note">Locus keeps assets attached to Ownership. Wallets only authorize actions.</p>
    </Modal>
  );
}
