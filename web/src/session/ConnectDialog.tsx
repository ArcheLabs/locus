import { useEffect, useMemo, useState } from "react";
import { ArrowRight } from "lucide-react";
import { useAppKit, useAppKitAccount, useAppKitProvider } from "@reown/appkit/react";
import { Modal } from "../components/Modal.js";
import { IdentityIcon } from "../components/IdentityIcon.js";
import { connectBrowserSession, connectEvmProvider, connectorInfo, hasSolanaWallet, listBrowserAccounts, type BrowserAccountOption } from "./connectors.js";
import type { LocusWebSession, SessionKind } from "./types.js";
import { MatrixLoginDialog } from "../matrix/MatrixLoginDialog.js";
import type { MatrixConnected } from "../matrix/MatrixConnector.js";
import type { Eip1193Provider } from "@jamscript/client";

type Props = {
  open: boolean;
  onClose: () => void;
  onConnected: (session: LocusWebSession) => void;
  locus: import("@archelabs/locus").LocusClient | null;
  initialMatrixConnection?: MatrixConnected | null;
};

function available(kind: SessionKind): boolean {
  if (kind === "solana") return hasSolanaWallet();
  return true;
}

export function ConnectDialog({ open, onClose, onConnected, locus, initialMatrixConnection = null }: Props) {
  const [connecting, setConnecting] = useState<SessionKind | null>(null);
  const [error, setError] = useState("");
  const [accountOptions, setAccountOptions] = useState<BrowserAccountOption[]>([]);
  const [selectedKind, setSelectedKind] = useState<SessionKind | null>(null);
  const [selectedAccount, setSelectedAccount] = useState("");
  const [matrixOpen, setMatrixOpen] = useState(false);
  const [waitingForEvm, setWaitingForEvm] = useState(false);
  const { open: openAppKit, close: closeAppKit } = useAppKit();
  const { address: evmAddress, isConnected: evmConnected } = useAppKitAccount({ namespace: "eip155" });
  const { walletProvider } = useAppKitProvider<Eip1193Provider>("eip155");
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

  useEffect(() => {
    if (!waitingForEvm || !evmConnected || !evmAddress || !walletProvider) return;
    let cancelled = false;
    setConnecting("evm");
    setError("");
    void connectEvmProvider(walletProvider, evmAddress).then((session) => {
      if (cancelled) { session.cleanup?.(); return; }
      onConnected(session);
      setWaitingForEvm(false);
      onClose();
    }).catch((cause) => {
      if (!cancelled) setError(cause instanceof Error ? cause.message : "EVM wallet connection failed.");
    }).finally(() => { if (!cancelled) setConnecting(null); });
    return () => { cancelled = true; };
  }, [evmAddress, evmConnected, onClose, onConnected, waitingForEvm, walletProvider]);

  async function chooseConnector(kind: SessionKind) {
    if (kind === "matrix") {
      onClose();
      setMatrixOpen(true);
      return;
    }
    if (kind === "evm") {
      setError("");
      setWaitingForEvm(true);
      try { await openAppKit({ view: "Connect", namespace: "eip155" }); }
      catch (cause) { setWaitingForEvm(false); setError(cause instanceof Error ? cause.message : "Unable to open the EVM wallet selector."); }
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
          <button key={entry.kind} type="button" className="connect-option" disabled={connecting !== null || !entry.available} onClick={() => chooseConnector(entry.kind)}>
            <span className="identity-icon-slot"><IdentityIcon kind={entry.kind} size={24} /></span>
            <span><strong>{entry.label}</strong><small>{connecting === entry.kind ? "Finding accounts…" : entry.available ? entry.description : "No compatible wallet detected"}</small></span>
            <ArrowRight className="connect-arrow" size={18} aria-hidden="true" />
          </button>
        ))}
      </div>
      {selectedKind && <div className="account-picker">
        <label htmlFor="wallet-account">Choose account</label>
        <select id="wallet-account" value={selectedAccount} onChange={(event) => setSelectedAccount(event.target.value)}>
          {accountOptions.map((account) => <option key={account.id} value={account.id}>{account.label} — {account.description}</option>)}
        </select>
        <button type="button" className="primary" disabled={!selectedAccount || connecting !== null} onClick={() => connect(selectedKind, selectedAccount)}>Connect selected account</button>
      </div>}
      {waitingForEvm && <button type="button" className="text-button cancel-wallet-connect" onClick={() => { setWaitingForEvm(false); void closeAppKit(); }}>Cancel wallet connection</button>}
      {error && <div className="transaction-error">{error}</div>}
      <p className="modal-note">Locus keeps assets attached to Ownership. Wallets only authorize actions.</p>
    </Modal>
    <MatrixLoginDialog open={matrixOpen} onClose={() => setMatrixOpen(false)} onConnected={onConnected} locus={locus} initialConnection={initialMatrixConnection} />
    </>
  );
}
