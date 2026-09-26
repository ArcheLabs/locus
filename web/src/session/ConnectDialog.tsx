import { useEffect, useMemo, useState } from "react";
import { useAppKit } from "@reown/appkit/react";
import { Modal } from "../components/Modal.js";
import { IdentityOption } from "../components/IdentityOption.js";
import { connectBrowserSession, connectorInfo, hasSolanaWallet, listBrowserAccounts, type BrowserAccountOption } from "./connectors.js";
import type { LocusWebSession, SessionKind } from "./types.js";
import { MatrixLoginDialog } from "../matrix/MatrixLoginDialog.js";
import type { MatrixConnected } from "../matrix/MatrixConnector.js";
import { Wallet, X } from "lucide-react";
import { ActionButton } from "../components/ActionButton.js";

type Props = {
  open: boolean;
  onClose: () => void;
  onCancelMatrix: (connection: MatrixConnected | null) => void;
  onConnected: (session: LocusWebSession) => void;
  onEvmConnectRequested: () => void;
  onEvmConnectCancelled: () => void;
  evmError?: string;
  locus: import("@archelabs/locus").LocusClient | null;
  initialMatrixConnection?: MatrixConnected | null;
};

function available(kind: SessionKind): boolean {
  if (kind === "solana") return hasSolanaWallet();
  return true;
}

export function ConnectDialog({ open, onClose, onCancelMatrix, onConnected, onEvmConnectRequested, onEvmConnectCancelled, evmError = "", locus, initialMatrixConnection = null }: Props) {
  const [connecting, setConnecting] = useState<SessionKind | null>(null);
  const [error, setError] = useState("");
  const [accountOptions, setAccountOptions] = useState<BrowserAccountOption[]>([]);
  const [selectedKind, setSelectedKind] = useState<SessionKind | null>(null);
  const [selectedAccount, setSelectedAccount] = useState("");
  const [matrixOpen, setMatrixOpen] = useState(false);
  const [waitingForEvm, setWaitingForEvm] = useState(false);
  const { open: openAppKit, close: closeAppKit } = useAppKit();
  const options = useMemo(() => connectorInfo.map((entry) => ({ ...entry, available: available(entry.kind) })), []);

  useEffect(() => {
    if (!open) {
      setSelectedKind(null);
      setAccountOptions([]);
      setSelectedAccount("");
      setError("");
      setWaitingForEvm(false);
    }
  }, [open]);

  useEffect(() => {
    if (initialMatrixConnection) setMatrixOpen(true);
  }, [initialMatrixConnection]);

  useEffect(() => { if (evmError) setError(evmError); }, [evmError]);

  async function chooseConnector(kind: SessionKind) {
    if (kind === "matrix") {
      onClose();
      setMatrixOpen(true);
      return;
    }
    if (kind === "evm") {
      setError("");
      setWaitingForEvm(true);
      onEvmConnectRequested();
      try { await openAppKit({ view: "Connect", namespace: "eip155" }); }
      catch (cause) { setWaitingForEvm(false); onEvmConnectCancelled(); setError(cause instanceof Error ? cause.message : "Unable to open the EVM wallet selector."); }
      return;
    }
    setConnecting(kind);
    setSelectedKind(null);
    setAccountOptions([]);
    setError("");
    try {
      const accounts = await listBrowserAccounts(kind);
      if (accounts.length === 1) {
        await connect(kind, accounts[0].id);
        return;
      }
      setSelectedKind(kind);
      setAccountOptions(accounts);
      setSelectedAccount(accounts[0]?.id ?? "");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Wallet discovery failed.");
    } finally {
      setConnecting(null);
    }
  }

  const matrixEntry = { kind: "matrix" as const, label: "Matrix", description: "Use a verified Matrix device controller", available: true };
  const displayOptions = [matrixEntry, ...options];

  async function connect(kind: SessionKind, accountId: string) {
    setConnecting(kind);
    setError("");
    try {
      onConnected(await connectBrowserSession(kind, accountId));
      onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Wallet connection failed.");
    } finally {
      setConnecting(null);
    }
  }

  return (
    <>
    <Modal open={open} title="Connect" onClose={onClose}>
      <p className="modal-lead">Choose an Ownership signer. This does not select an execution network.</p>
      <div className="connect-options">
        {displayOptions.map((entry) => (
          <button
            key={entry.kind}
            type="button"
            className="identity-option-row identity-option-row--comfortable"
            disabled={connecting !== null || !entry.available}
            data-disabled={connecting !== null || !entry.available ? "true" : undefined}
            onClick={() => chooseConnector(entry.kind)}
          >
            <IdentityOption
              kind={entry.kind}
              title={entry.label}
              description={connecting === entry.kind ? "Finding accounts…" : entry.available ? entry.description : "No compatible wallet detected"}
              variant="comfortable"
              disabled={connecting !== null || !entry.available}
              trailing="arrow"
            />
          </button>
        ))}
      </div>
      {selectedKind && <div className="account-picker">
        <label htmlFor="wallet-account">Choose account</label>
        <select id="wallet-account" value={selectedAccount} onChange={(event) => setSelectedAccount(event.target.value)}>
          {accountOptions.map((account) => <option key={account.id} value={account.id}>{account.label} — {account.description}</option>)}
        </select>
        <ActionButton variant="primary" icon={Wallet} fullWidth disabled={!selectedAccount || connecting !== null} onClick={() => connect(selectedKind, selectedAccount)}>Connect selected account</ActionButton>
      </div>}
      {waitingForEvm && <ActionButton className="cancel-wallet-connect" variant="tertiary" size="small" icon={X} onClick={() => { setWaitingForEvm(false); onEvmConnectCancelled(); void closeAppKit(); }}>Cancel wallet connection</ActionButton>}
      {error && <div className="transaction-error">{error}</div>}
      <p className="modal-note">Locus keeps assets attached to Ownership. Wallets only authorize actions.</p>
    </Modal>
    <MatrixLoginDialog open={matrixOpen} onClose={() => setMatrixOpen(false)} onCancel={onCancelMatrix} onConnected={(session) => { onConnected(session); setMatrixOpen(false); onClose(); }} locus={locus} initialConnection={initialMatrixConnection} />
    </>
  );
}
