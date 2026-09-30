import { useEffect, useMemo, useRef, useState } from "react";
import { useAppKit } from "@reown/appkit/react";
import { Modal } from "../components/Modal.js";
import { IdentityOption } from "../components/IdentityOption.js";
import { connectBrowserSession, connectorInfo, hasSolanaWallet, listBrowserAccounts, type BrowserAccountOption } from "./connectors.js";
import type { LocusWebSession, SessionKind } from "./types.js";
import { MatrixLoginDialog } from "../matrix/MatrixLoginDialog.js";
import { readStoredMatrixSession, restoreMatrixSession, type MatrixConnected } from "../matrix/MatrixConnector.js";
import { Wallet, X } from "lucide-react";
import { ActionButton } from "../components/ActionButton.js";
import { SelectField } from "../components/SelectField.js";

type Props = {
  open: boolean;
  onClose: () => void;
  onCancelMatrix: (connection: MatrixConnected | null) => void;
  onMatrixSelected: () => void;
  onConnected: (session: LocusWebSession) => void;
  onConnectionPendingChange?: (kind: SessionKind | null) => void;
  onEvmConnectRequested: () => Promise<boolean>;
  onEvmConnectCancelled: () => void;
  evmAccountAvailable?: boolean;
  evmError?: string;
  locus: import("@archelabs/locus").LocusClient | null;
  initialMatrixConnection?: MatrixConnected | null;
};

const WALLET_RESPONSE_TIMEOUT_MS = 120_000;

function waitForWalletResponse<T>(task: Promise<T>): Promise<T> {
  let timeout: number | undefined;
  return Promise.race([
    task,
    new Promise<T>((_, reject) => {
      timeout = window.setTimeout(() => reject(new Error("The wallet did not finish connecting. Return to Locus and try again.")), WALLET_RESPONSE_TIMEOUT_MS);
    }),
  ]).finally(() => { if (timeout !== undefined) window.clearTimeout(timeout); });
}

function available(kind: SessionKind): boolean {
  if (kind === "solana") return hasSolanaWallet();
  return true;
}

export function ConnectDialog({ open, onClose, onCancelMatrix, onMatrixSelected, onConnected, onConnectionPendingChange, onEvmConnectRequested, onEvmConnectCancelled, evmError = "", evmAccountAvailable = false, locus, initialMatrixConnection = null }: Props) {
  const [connecting, setConnecting] = useState<SessionKind | null>(null);
  const [error, setError] = useState("");
  const [accountOptions, setAccountOptions] = useState<BrowserAccountOption[]>([]);
  const [selectedKind, setSelectedKind] = useState<SessionKind | null>(null);
  const [selectedAccount, setSelectedAccount] = useState("");
  const [matrixOpen, setMatrixOpen] = useState(false);
  const [savedMatrixConnection, setSavedMatrixConnection] = useState<MatrixConnected | null>(null);
  const [continueWithNewMatrixDevice, setContinueWithNewMatrixDevice] = useState(false);
  const [waitingForEvm, setWaitingForEvm] = useState(false);
  const evmRequestInFlight = useRef(false);
  const evmRequestGeneration = useRef(0);
  const evmRequestTimeout = useRef<number | null>(null);
  const appKitModalOpen = useRef(false);
  const { open: openAppKit, close: closeAppKit } = useAppKit();
  const closeAppKitRef = useRef(closeAppKit);
  closeAppKitRef.current = closeAppKit;
  const options = useMemo(() => connectorInfo.map((entry) => ({ ...entry, available: available(entry.kind) })), []);

  useEffect(() => {
    if (!open) {
      if (evmRequestTimeout.current !== null) window.clearTimeout(evmRequestTimeout.current);
      evmRequestTimeout.current = null;
      onConnectionPendingChange?.(null);
      if (appKitModalOpen.current) {
        appKitModalOpen.current = false;
        void closeAppKitRef.current();
      }
      setSelectedKind(null);
      setAccountOptions([]);
      setSelectedAccount("");
      setError("");
      setWaitingForEvm(false);
      evmRequestInFlight.current = false;
      evmRequestGeneration.current += 1;
    }
  }, [onConnectionPendingChange, open]);

  useEffect(() => {
    if (initialMatrixConnection) setMatrixOpen(true);
  }, [initialMatrixConnection]);

  useEffect(() => {
    if (!evmError) return;
    setError(evmError);
    if (evmRequestInFlight.current) {
      evmRequestInFlight.current = false;
      evmRequestGeneration.current += 1;
      setWaitingForEvm(false);
      onEvmConnectCancelled();
      onConnectionPendingChange?.(null);
      if (appKitModalOpen.current) {
        appKitModalOpen.current = false;
        void closeAppKitRef.current();
      }
    }
  }, [evmError, onConnectionPendingChange, onEvmConnectCancelled]);

  async function chooseConnector(kind: SessionKind) {
    if (connecting !== null || evmRequestInFlight.current) return;
    if (kind === "matrix") {
      onMatrixSelected();
      setError("");
      setContinueWithNewMatrixDevice(false);
      const stored = readStoredMatrixSession();
      if (!stored) {
        setSavedMatrixConnection(null);
        onClose();
        setMatrixOpen(true);
        return;
      }
      setConnecting("matrix");
      onConnectionPendingChange?.("matrix");
      void restoreMatrixSession(stored, { locus }).then((connected) => {
        setSavedMatrixConnection(connected);
        if (connected.state === "READY") {
          onConnected(connected.session);
          onClose();
          return;
        }
        onClose();
        setMatrixOpen(true);
      }).catch((cause: unknown) => {
        const detail = cause instanceof Error ? cause.message : "The saved device could not be restored.";
        setError(`Saved Matrix device could not be restored. ${detail}`);
        setContinueWithNewMatrixDevice(true);
      }).finally(() => {
        setConnecting(null);
        onConnectionPendingChange?.(null);
      });
      return;
    }
    if (kind === "evm") {
      evmRequestInFlight.current = true;
      const requestGeneration = ++evmRequestGeneration.current;
      setError("");
      setWaitingForEvm(true);
      onConnectionPendingChange?.("evm");
      try {
        // A wallet that is already connected to Locus should restore directly.
        // Opening AppKit first leaves mobile wallets on a stale "already linked"
        // screen even though the EIP-1193 account is already usable.
        const reconnected = await onEvmConnectRequested();
        if (requestGeneration !== evmRequestGeneration.current) return;
        if (reconnected) {
          evmRequestInFlight.current = false;
          setWaitingForEvm(false);
          onConnectionPendingChange?.(null);
          onClose();
          return;
        }
        appKitModalOpen.current = true;
        if (evmRequestTimeout.current !== null) window.clearTimeout(evmRequestTimeout.current);
        evmRequestTimeout.current = window.setTimeout(() => {
          if (!evmRequestInFlight.current || requestGeneration !== evmRequestGeneration.current) return;
          evmRequestInFlight.current = false;
          evmRequestGeneration.current += 1;
          evmRequestTimeout.current = null;
          setWaitingForEvm(false);
          onEvmConnectCancelled();
          onConnectionPendingChange?.(null);
          setError("The EVM wallet did not finish connecting. Return to Locus and try again.");
          if (appKitModalOpen.current) {
            appKitModalOpen.current = false;
            void closeAppKitRef.current();
          }
        }, 120_000);
        await openAppKit({ view: "Connect", namespace: "eip155" });
      }
      catch (cause) {
        if (requestGeneration !== evmRequestGeneration.current) return;
        if (evmRequestTimeout.current !== null) window.clearTimeout(evmRequestTimeout.current);
        evmRequestTimeout.current = null;
        evmRequestInFlight.current = false;
        setWaitingForEvm(false);
        onEvmConnectCancelled();
        onConnectionPendingChange?.(null);
        if (appKitModalOpen.current) {
          appKitModalOpen.current = false;
          void closeAppKit();
        }
        setError(cause instanceof Error ? cause.message : "Unable to open the EVM wallet selector.");
      }
      return;
    }
    setConnecting(kind);
    onConnectionPendingChange?.(kind);
    setSelectedKind(null);
    setAccountOptions([]);
    setError("");
    try {
      const accounts = await waitForWalletResponse(listBrowserAccounts(kind));
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
      onConnectionPendingChange?.(null);
    }
  }

  const savedMatrix = readStoredMatrixSession();
  const matrixEntry = {
    kind: "matrix" as const,
    label: savedMatrix ? "Continue with Matrix" : "Matrix",
    description: savedMatrix ? savedMatrix.userId : "Sign in with a verified Matrix device",
    available: true,
  };
  const displayOptions = [matrixEntry, ...options];

  function cancelEvmRequest() {
    if (evmRequestTimeout.current !== null) window.clearTimeout(evmRequestTimeout.current);
    evmRequestTimeout.current = null;
    evmRequestInFlight.current = false;
    evmRequestGeneration.current += 1;
    setWaitingForEvm(false);
    onEvmConnectCancelled();
    onConnectionPendingChange?.(null);
    if (appKitModalOpen.current) {
      appKitModalOpen.current = false;
      void closeAppKit();
    }
  }

  function closeConnectDialog() {
    if (evmRequestInFlight.current) cancelEvmRequest();
    onConnectionPendingChange?.(null);
    onClose();
  }

  async function connect(kind: SessionKind, accountId: string) {
    setConnecting(kind);
    setError("");
    try {
      onConnected(await waitForWalletResponse(connectBrowserSession(kind, accountId)));
      onConnectionPendingChange?.(null);
      onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Wallet connection failed.");
    } finally {
      setConnecting(null);
    }
  }

  return (
    <>
    <Modal open={open} title="Connect" onClose={closeConnectDialog} preventOutsideDismiss={waitingForEvm}>
      <p className="modal-lead">Choose an Ownership signer. This does not select an execution network.</p>
      <div className="connect-options">
        {displayOptions.map((entry) => (
          <button
            key={entry.kind}
            type="button"
            className="identity-option-row identity-option-row--comfortable"
            disabled={connecting !== null || waitingForEvm || !entry.available}
            data-disabled={connecting !== null || waitingForEvm || !entry.available ? "true" : undefined}
            onClick={() => chooseConnector(entry.kind)}
          >
            <IdentityOption
              kind={entry.kind}
              title={entry.label}
              description={waitingForEvm && entry.kind === "evm" ? evmAccountAvailable ? "Wallet approved. Finishing sign-in…" : "Approve in your wallet app, then return here" : connecting === entry.kind ? entry.kind === "solana" ? "Approve in your Solana wallet…" : "Preparing the selected account…" : entry.available ? entry.description : "No compatible wallet detected"}
              variant="comfortable"
              disabled={connecting !== null || waitingForEvm || !entry.available}
              trailing="arrow"
            />
          </button>
        ))}
      </div>
      {selectedKind && <div className="account-picker">
        <label htmlFor="wallet-account">Choose account</label>
        <SelectField
          id="wallet-account"
          value={selectedAccount}
          onValueChange={setSelectedAccount}
          placeholder="Select account"
          options={accountOptions.map((account) => ({ value: account.id, label: `${account.label} — ${account.description}` }))}
        />
        <ActionButton variant="primary" icon={Wallet} fullWidth disabled={!selectedAccount || connecting !== null} onClick={() => connect(selectedKind, selectedAccount)}>Connect selected account</ActionButton>
      </div>}
      {waitingForEvm && <ActionButton className="cancel-wallet-connect" variant="tertiary" size="small" icon={X} onClick={cancelEvmRequest}>Cancel wallet connection</ActionButton>}
      {error && <div className="transaction-error">{error}</div>}
      {continueWithNewMatrixDevice && <ActionButton variant="primary" fullWidth onClick={() => { setSavedMatrixConnection(null); onClose(); setMatrixOpen(true); }}>Continue with a new Matrix device</ActionButton>}
      <p className="modal-note">Locus keeps assets attached to Ownership. Wallets only authorize actions.</p>
    </Modal>
    <MatrixLoginDialog open={matrixOpen} onClose={() => setMatrixOpen(false)} onCancel={onCancelMatrix} onConnected={(session) => { onConnected(session); setMatrixOpen(false); onClose(); }} locus={locus} initialConnection={savedMatrixConnection ?? initialMatrixConnection} />
    </>
  );
}
