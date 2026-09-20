import { useState } from "react";
import { formatLocusId, parseUnits, randomAssetId, type LocusClient } from "@archelabs/locus";
import { Modal } from "../components/Modal.js";
import type { LocusWebSession } from "../session/types.js";
import type { AssetView } from "./assets.js";
import type { RecipientResolution } from "./recipients.js";

export function ReviewDialog({
  open,
  asset,
  amount,
  recipient,
  resolution,
  onClose,
  onConfirm,
}: {
  open: boolean;
  asset: AssetView;
  amount: string;
  recipient: string;
  resolution: RecipientResolution;
  onClose: () => void;
  onConfirm: () => void;
}) {
  return (
    <Modal
      open={open}
      title="Review transfer"
      onClose={onClose}
      footer={<><button type="button" className="secondary" onClick={onClose}>Cancel</button><button type="button" className="primary modal-primary" disabled={!resolution.valid} onClick={onConfirm}>Confirm</button></>}
    >
      <div className="review-summary">
        <span className="coin" style={{ background: asset.color }}>{asset.symbol[0]}</span>
        <strong>{amount} {asset.symbol}</strong>
      </div>
      <dl className="review-list">
        <div><dt>To</dt><dd>{recipient}</dd></div>
        <div><dt>Ownership type</dt><dd>{resolution.detectedType ?? "recipient"}</dd></div>
        <div><dt>Destination chain</dt><dd>Not applicable</dd></div>
      </dl>
      <p className="modal-note">The action will be signed by your connected Ownership controller.</p>
    </Modal>
  );
}

export function ReceiveDialog({ open, asset, session, onClose }: { open: boolean; asset: Pick<AssetView, "symbol"> | { symbol: string } | null; session: LocusWebSession | null; onClose: () => void }) {
  const [copied, setCopied] = useState(false);
  const locusId = session ? formatLocusId(session.owner) : "";
  async function copy() {
    if (!locusId) return;
    await navigator.clipboard?.writeText(locusId);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1800);
  }
  return (
    <Modal open={open} title="Receive" onClose={onClose}>
      <p className="modal-lead">Share this Locus ID to receive {asset?.symbol ?? "the asset"}.</p>
      {!session ? <div className="empty-state">Connect an Ownership session before receiving. Demo Mode does not submit receive actions.</div> : <>
        <div className="receive-code"><code>{locusId}</code></div>
        <button type="button" className="secondary full" onClick={copy}>{copied ? "Copied" : "Copy Locus ID"}</button>
        <p className="modal-note">Receiving is an Ownership operation; no destination chain or bridge is involved.</p>
      </>}
    </Modal>
  );
}

export function CreateAssetDialog({ open, locus, onClose, onCreated }: { open: boolean; locus: LocusClient | null; onClose: () => void; onCreated: () => void }) {
  const [name, setName] = useState("");
  const [symbol, setSymbol] = useState("");
  const [decimals, setDecimals] = useState("0");
  const [supply, setSupply] = useState("");
  const [working, setWorking] = useState(false);
  const [error, setError] = useState("");

  async function create() {
    if (!locus) return;
    setWorking(true);
    setError("");
    try {
      const decimalCount = Number(decimals);
      const submitted = await locus.createAsset(randomAssetId(), name.trim(), symbol.trim(), decimalCount, parseUnits(supply.trim(), decimalCount));
      const result = await locus.waitForAction(submitted.transactionId, { intervalMs: 500, timeoutMs: 180_000 });
      if (result.actionReceipt.status !== "applied") throw new Error(`Create asset failed${result.errorCode === null ? "" : ` (error ${result.errorCode})`}`);
      setName(""); setSymbol(""); setDecimals("0"); setSupply("");
      onCreated();
      onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to create asset.");
    } finally {
      setWorking(false);
    }
  }

  return (
    <Modal open={open} title="Create asset" onClose={onClose} footer={<><button type="button" className="secondary" onClick={onClose}>Cancel</button><button type="button" className="primary modal-primary" disabled={working || !locus} onClick={create}>{working ? "Creating…" : "Create asset"}</button></>}>
      <p className="modal-lead">The connected Ownership becomes the issuer.</p>
      <div className="form-grid">
        <label>Name<input value={name} placeholder="Dot Token" onChange={(event) => setName(event.target.value)} /></label>
        <label>Symbol<input value={symbol} placeholder="DOT" onChange={(event) => setSymbol(event.target.value.toUpperCase())} /></label>
        <label>Decimals<input type="number" min="0" max="38" value={decimals} onChange={(event) => setDecimals(event.target.value)} /></label>
        <label>Initial supply<input inputMode="decimal" value={supply} placeholder="1000" onChange={(event) => setSupply(event.target.value)} /></label>
      </div>
      {error && <div className="transaction-error">{error}</div>}
    </Modal>
  );
}
