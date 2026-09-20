import { useEffect, useMemo, useState } from "react";
import { ArrowRight } from "lucide-react";
import { Modal } from "../components/Modal.js";
import { connectBrowserSession, connectorInfo, hasEvmWallet, hasSolanaWallet, listBrowserAccounts, type BrowserAccountOption } from "./connectors.js";
import type { LocusWebSession, SessionKind } from "./types.js";
import { MatrixLoginDialog } from "../matrix/MatrixLoginDialog.js";
import { SiEthereum, SiMatrix, SiPolkadot, SiSolana } from "react-icons/si";
import type { IconType } from "react-icons";

type Props = {
  open: boolean;
  onClose: () => void;
  onConnected: (session: LocusWebSession) => void;
};

function available(kind: SessionKind): boolean {
  if (kind === "evm") return hasEvmWallet();
  if (kind === "solana") return hasSolanaWallet();
  return true;
}

export function ConnectDialog({ open, onClose, onConnected }: Props) {
  const [connecting, setConnecting] = useState<SessionKind | null>(null);
  const [error, setError] = useState("");
  const [accountOptions, setAccountOptions] = useState<BrowserAccountOption[]>([]);
  const [selectedKind, setSelectedKind] = useState<SessionKind | null>(null);
  const [selectedAccount, setSelectedAccount] = useState("");
  const [matrixOpen, setMatrixOpen] = useState(false);
  const options = useMemo(() => connectorInfo.map((entry) => ({ ...entry, available: available(entry.kind) })), []);

  useEffect(() => {
    if (!open) {
      setSelectedKind(null);
      setAccountOptions([]);
      setSelectedAccount("");
      setError("");
    }
  }, [open]);

  async function chooseConnector(kind: SessionKind) {
    if (kind === "matrix") {
      onClose();
      setMatrixOpen(true);
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
            <span className={`wallet-mark ${entry.kind}`} aria-hidden="true"><ConnectorIcon kind={entry.kind} /></span>
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
      {error && <div className="transaction-error">{error}</div>}
      <p className="modal-note">Locus keeps assets attached to Ownership. Wallets only authorize actions.</p>
    </Modal>
    <MatrixLoginDialog open={matrixOpen} onClose={() => setMatrixOpen(false)} onConnected={onConnected} />
    </>
  );
}

function ConnectorIcon({ kind }: { kind: SessionKind }) {
  const icons: Record<SessionKind, IconType> = { matrix: SiMatrix, evm: SiEthereum, polkadot: SiPolkadot, solana: SiSolana };
  const Icon = icons[kind];
  return <Icon size={18} aria-hidden="true" />;
}
