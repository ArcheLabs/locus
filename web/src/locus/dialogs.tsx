import { useEffect, useRef, useState } from "react";
import { formatLocusId, parseUnits, randomAssetId, type LocusClient, type OwnershipPreparationPhase } from "@archelabs/locus";
import { Modal } from "../components/Modal.js";
import { ActionButton } from "../components/ActionButton.js";
import { Check, CirclePlus, ClipboardCopy, RefreshCw, SearchCheck, X } from "lucide-react";
import type { LocusWebSession } from "../session/types.js";
import type { AssetView } from "./assets.js";
import type { RecipientResolution } from "./recipients.js";
import { IdentityIcon } from "../components/IdentityIcon.js";
import { AssetIcon } from "../components/AssetIcon.js";
import {
  createAssetPendingKey,
  OperationTimeoutError,
  readCreateAssetPendings,
  removeCreateAssetPending,
  resumeCreateAssetFinalization,
  submitCreateAssetOnce,
  waitForWalletSignature,
  withOperationTimeout,
  writeCreateAssetPending,
  type CreateAssetPendingRecord,
  type CreateAssetStage,
} from "./createAssetWorkflow.js";

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
      footer={<><ActionButton variant="secondary" icon={X} onClick={onClose}>Cancel</ActionButton><ActionButton variant="primary" icon={Check} disabled={!resolution.valid} onClick={onConfirm}>Confirm</ActionButton></>}
    >
      <div className="review-summary">
        <AssetIcon asset={asset} />
        <strong>{amount} {asset.presentation.unit === "shares" ? "shares" : asset.symbol}</strong>
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
    try {
      if (!navigator.clipboard?.writeText) throw new Error("Clipboard access is unavailable");
      await navigator.clipboard.writeText(locusId);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch { setCopied(false); }
  }
  return (
    <Modal open={open} title="Receive" onClose={onClose}>
      <p className="modal-lead">Share this Locus ID to receive {asset?.symbol ?? "the asset"}.</p>
      {!session ? <div className="empty-state">Connect an Ownership session before receiving. Demo Mode does not submit receive actions.</div> : <>
        <div className="receive-code"><code>{locusId}</code></div>
        <ActionButton variant="secondary" icon={ClipboardCopy} fullWidth onClick={copy}>{copied ? "Copied" : "Copy Locus ID"}</ActionButton>
        <p className="modal-note">Receiving is an Ownership operation; no destination chain or bridge is involved.</p>
      </>}
    </Modal>
  );
}

const WALLET_SIGNATURE_TIMEOUT_MS = 120_000;
const SUBMISSION_TIMEOUT_MS = 30_000;
const CREATE_ASSET_FINALIZATION_TIMEOUT_MS = 180_000;

function bytesToHex(bytes: Uint8Array): string {
  return `0x${Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}

function stageLabel(stage: CreateAssetStage): string {
  switch (stage) {
    case "PREPARING": return "Preparing action";
    case "AWAITING_WALLET": return "Approve in wallet";
    case "SIGNED": return "Signature received";
    case "SUBMITTING": return "Submitting action";
    case "SUBMITTED": return "Submitted";
    case "FINALIZING": return "Waiting for finalization";
    case "APPLIED": return "Asset created";
    case "FAILED": return "Action needs attention";
  }
}

function preparationPhaseMessage(phase: OwnershipPreparationPhase): string {
  switch (phase) {
    case "VALIDATING_DEPLOYMENT": return "Validating the selected Locus deployment before the wallet opens.";
    case "READING_FINALIZED_CONTEXT": return "Reading finalized chain context before the wallet opens.";
    case "READING_MANAGED_STATE": return "Reading the Ownership state root before the wallet opens.";
    case "READING_NONCE": return "Reading the Ownership nonce before the wallet opens.";
  }
}

export function CreateAssetDialog({ open, locus, session, networkId, serviceId, onClose, onCreated }: {
  open: boolean;
  locus: LocusClient | null;
  session: LocusWebSession | null;
  networkId: string;
  serviceId: number | null;
  onClose: () => void;
  onCreated: () => void;
}) {
  const [name, setName] = useState("");
  const [symbol, setSymbol] = useState("");
  const [decimals, setDecimals] = useState("0");
  const [supply, setSupply] = useState("");
  const [draftAssetId, setDraftAssetId] = useState(() => randomAssetId());
  const [prepared, setPrepared] = useState<Awaited<ReturnType<LocusClient["prepareCreateAsset"]>> | null>(null);
  const preparedRef = useRef<typeof prepared>(null);
  const appliedRef = useRef(false);
  const prepareGeneration = useRef(0);
  const activeResumeKeys = useRef(new Set<string>());
  const [prepareRetry, setPrepareRetry] = useState(0);
  const [stage, setStage] = useState<CreateAssetStage>("PREPARING");
  const [stageMessage, setStageMessage] = useState("Enter the asset details to prepare the network action.");
  const [error, setError] = useState("");
  const [pending, setPending] = useState<CreateAssetPendingRecord | null>(null);
  const pendingRef = useRef<CreateAssetPendingRecord | null>(null);
  const pendingScope = session && serviceId !== null
    ? `${networkId}:${serviceId}:${formatLocusId(session.owner).toLowerCase()}:`
    : null;
  const pendingKey = pendingScope ? createAssetPendingKey(networkId, serviceId!, formatLocusId(session!.owner), bytesToHex(draftAssetId)) : null;

  function updatePending(record: CreateAssetPendingRecord | null) {
    pendingRef.current = record;
    setPending(record);
  }

  function resetDraft() {
    setName("");
    setSymbol("");
    setDecimals("0");
    setSupply("");
    setDraftAssetId(randomAssetId());
  }

  async function resumePending(record: CreateAssetPendingRecord) {
    if (!locus || record.state !== "submitted" || !record.transactionId || !record.actionHash) return;
    if (activeResumeKeys.current.has(record.key)) return;
    activeResumeKeys.current.add(record.key);
    setStage("FINALIZING");
    setStageMessage(`Transaction ${record.transactionId} is saved. Checking its final receipt; no new signature is needed.`);
    setError("");
    try {
      const result = await resumeCreateAssetFinalization(
        record,
        (transactionId, actionHash) => locus.waitForActionByHash(transactionId, actionHash, { intervalMs: 1_000, timeoutMs: CREATE_ASSET_FINALIZATION_TIMEOUT_MS }),
        CREATE_ASSET_FINALIZATION_TIMEOUT_MS,
      );
      if (result.actionReceipt.status !== "applied") {
        removeCreateAssetPending(window.localStorage, record.key);
        updatePending(null);
        throw new Error(`Create asset was rejected${result.errorCode === null ? "" : ` (error ${result.errorCode})`}`);
      }
      removeCreateAssetPending(window.localStorage, record.key);
      updatePending(null);
      appliedRef.current = true;
      setStage("APPLIED");
      setStageMessage("The asset is finalized and visible on this Locus network.");
      resetDraft();
      onCreated();
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "Unable to check the saved create-asset transaction.";
      setStage("FAILED");
      setStageMessage(record.transactionId
        ? `Transaction ${record.transactionId} is still saved. Resume finalization; do not sign this action again.`
        : "The transaction status could not be confirmed.");
      setError(message);
    } finally {
      activeResumeKeys.current.delete(record.key);
    }
  }

  useEffect(() => {
    if (!pendingScope) { updatePending(null); return; }
    const records = readCreateAssetPendings(window.localStorage)
      .filter((record) => record.key.startsWith(pendingScope))
      .sort((left, right) => right.updatedAt - left.updatedAt);
    const saved = records[0] ?? null;
    updatePending(saved);
    if (!saved) return;
    preparedRef.current = null;
    setPrepared(null);
    if (saved.state === "submitted") void resumePending(saved);
    else {
      setStage("FAILED");
      setStageMessage("No transaction ID was received. The submission outcome is unresolved; Locus will not sign or submit it again automatically.");
      setError("Check the asset on-chain before dismissing this recovery record or trying another create action.");
    }
    // Resume once per selected network, service, and Ownership.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingScope, locus]);

  useEffect(() => {
    const generation = ++prepareGeneration.current;
    if (preparedRef.current) locus?.abandonPreparedOwnershipAction(preparedRef.current);
    preparedRef.current = null;
    setPrepared(null);
    if (!open) {
      appliedRef.current = false;
      return;
    }
    if (appliedRef.current) {
      if (!name.trim() && !symbol.trim() && !supply.trim()) return;
      appliedRef.current = false;
    }
    if (!locus || !session || !pendingScope || pendingRef.current) return;

    const decimalCount = Number(decimals);
    if (!name.trim() || !symbol.trim() || !Number.isInteger(decimalCount) || decimalCount < 0 || decimalCount > 38 || !supply.trim()) {
      setStage("PREPARING");
      setStageMessage("Complete the asset name, symbol, decimals, and initial supply to prepare the action.");
      setError("");
      return;
    }
    let initialSupply: bigint;
    try { initialSupply = parseUnits(supply.trim(), decimalCount); }
    catch (cause) {
      setStage("FAILED");
      setStageMessage("The asset details could not be prepared.");
      setError(cause instanceof Error ? cause.message : "Enter a valid initial supply.");
      return;
    }

    setStage("PREPARING");
    setStageMessage("Checking the deployment, finalized state, and Ownership nonce before opening your wallet.");
    setError("");
    const timer = window.setTimeout(() => {
      void locus.prepareCreateAsset(
        draftAssetId,
        name.trim(),
        symbol.trim(),
        decimalCount,
        initialSupply,
        undefined,
        (phase) => {
          if (generation === prepareGeneration.current) setStageMessage(preparationPhaseMessage(phase));
        },
      )
        .then((preparedAction) => {
          if (generation !== prepareGeneration.current) {
            locus.abandonPreparedOwnershipAction(preparedAction);
            return;
          }
          preparedRef.current = preparedAction;
          setPrepared(preparedAction);
          setStage("AWAITING_WALLET");
          setStageMessage("Preparation is complete. Press Sign & Create to open your wallet; no RPC reads run after that gesture.");
        })
        .catch((cause) => {
          if (generation !== prepareGeneration.current) return;
          preparedRef.current = null;
          setStage("FAILED");
          setStageMessage("The action was not signed or submitted. Retry preparation after checking the network connection.");
          setError(cause instanceof Error ? cause.message : "Unable to prepare the create-asset action.");
        });
    }, 300);
    return () => {
      window.clearTimeout(timer);
      if (preparedRef.current) locus.abandonPreparedOwnershipAction(preparedRef.current);
      preparedRef.current = null;
    };
  }, [open, locus, session, pendingScope, name, symbol, decimals, supply, draftAssetId, prepareRetry]);

  async function checkUnknownSubmission(record: CreateAssetPendingRecord) {
    if (!locus || record.state !== "submission-unknown") return;
    setError("");
    setStageMessage("Checking finalized asset state. A missing asset does not prove that a timed-out request was never queued.");
    try {
      const assetId = Uint8Array.from(record.assetId.slice(2).match(/.{2}/g)?.map((part) => Number.parseInt(part, 16)) ?? []);
      const asset = await locus.getAsset(assetId);
      const expectedSupply = parseUnits(record.initialSupply, record.decimals);
      if (asset && asset.totalSupply === expectedSupply) {
        removeCreateAssetPending(window.localStorage, record.key);
        updatePending(null);
        appliedRef.current = true;
        setStage("APPLIED");
        setStageMessage("The asset is present on-chain. The create action was applied.");
        resetDraft();
        onCreated();
      } else {
        setStage("FAILED");
        setStageMessage("The asset is not visible at the latest state. The timed-out submission remains unresolved; do not repeat it automatically.");
      }
    } catch (cause) {
      setStage("FAILED");
      setError(cause instanceof Error ? cause.message : "Unable to check this asset on-chain.");
    }
  }

  function dismissUnknownSubmission(record: CreateAssetPendingRecord) {
    removeCreateAssetPending(window.localStorage, record.key);
    updatePending(null);
    preparedRef.current = null;
    setPrepared(null);
    setDraftAssetId(randomAssetId());
    setStage("PREPARING");
    setStageMessage("Recovery record dismissed. Prepare the action again only after checking the chain.");
    setError("");
    setPrepareRetry((value) => value + 1);
  }

  async function signAndCreate() {
    if (!locus || !preparedRef.current || pendingRef.current) return;
    const preparedAction = preparedRef.current;
    preparedRef.current = null;
    setPrepared(null);
    setError("");
    setStage("AWAITING_WALLET");
    setStageMessage("Waiting for your wallet. Return to Locus after approving or rejecting the signature.");
    let signatureReceived = false;
    try {
      // This direct call is the first external interaction in the click
      // handler. Preparation and every state read have already completed.
      const signaturePromise = locus.signPreparedOwnershipAction(preparedAction);
      const signed = await waitForWalletSignature(signaturePromise, WALLET_SIGNATURE_TIMEOUT_MS);
      signatureReceived = true;
      setStage("SIGNED");
      setStageMessage("Wallet signature received. Submitting the signed action once.");
      await new Promise<void>((resolve) => window.setTimeout(resolve, 0));

      const assetIdHex = bytesToHex(draftAssetId);
      const recordBase: CreateAssetPendingRecord = {
        version: 1,
        key: pendingKey!,
        assetId: assetIdHex,
        name: name.trim(),
        symbol: symbol.trim(),
        decimals: Number(decimals),
        initialSupply: supply.trim(),
        state: "submission-unknown",
        actionHash: signed.actionHash,
        updatedAt: Date.now(),
      };
      setStage("SUBMITTING");
      setStageMessage("Sending the signed action once. No transaction ID means Locus cannot confirm submission; it will not resubmit automatically.");
      await new Promise<void>((resolve) => window.setTimeout(resolve, 0));

      let submissionTimedOut = false;
      const submissionPromise = submitCreateAssetOnce(
        recordBase,
        window.localStorage,
        () => locus.submitSignedOwnershipAction(signed),
        (unknownRecord) => updatePending(unknownRecord),
        async (submittedRecord, submitted) => {
        updatePending(submittedRecord);
        setStage("SUBMITTED");
        setStageMessage(`Transaction ${submitted.transactionId} was received and saved. Resuming will poll this transaction, not sign again.`);
        if (submissionTimedOut) void resumePending(submittedRecord);
        },
      );
      // The timed response may race this timeout. Keep its rejection handled
      // even after the UI has moved into the recoverable no-ID state.
      void submissionPromise.catch(() => {});

      let submittedRecord: CreateAssetPendingRecord;
      try {
        submittedRecord = await withOperationTimeout(submissionPromise, "submission", SUBMISSION_TIMEOUT_MS);
      } catch (cause) {
        if (cause instanceof OperationTimeoutError && cause.stage === "submission") {
          submissionTimedOut = true;
          setStage("FAILED");
          setStageMessage("No transaction ID was received, so submission is not confirmed. The request may still have reached the backend; do not sign or submit it again automatically.");
          setError("Check the asset state or wait for a delayed submission response before dismissing this recovery record.");
          return;
        }
        if (cause && typeof cause === "object" && (cause as { name?: unknown }).name === "RpcError") {
          removeCreateAssetPending(window.localStorage, recordBase.key);
          updatePending(null);
          throw new Error(`The backend rejected the submission before returning a transaction ID. The action was not submitted. ${cause instanceof Error ? cause.message : ""}`);
        }
        throw cause;
      }

      setStage("SUBMITTED");
      await new Promise<void>((resolve) => window.setTimeout(resolve, 0));
      await resumePending(submittedRecord);
    } catch (cause) {
      if (!signatureReceived) locus?.abandonPreparedOwnershipAction(preparedAction);
      const message = cause instanceof Error ? cause.message : "Unable to create asset.";
      const errorPending = pendingRef.current as CreateAssetPendingRecord | null;
      if (!errorPending) {
        setStage("FAILED");
        setStageMessage("No transaction was submitted. You can retry after reviewing the error.");
        setError(message);
        setPrepareRetry((value) => value + 1);
      } else {
        setStage("FAILED");
        setStageMessage(errorPending.transactionId
          ? `Transaction ${errorPending.transactionId} is saved; resume finalization without signing again.`
          : "The submission outcome is unresolved. Do not sign or submit it again automatically.");
        setError(message);
      }
    }
  }

  const pendingSubmitted = pending?.state === "submitted";
  const signatureReady = stage === "AWAITING_WALLET" && prepared !== null && pending === null;
  const stageBusy = stage === "PREPARING" || stage === "SIGNED" || stage === "SUBMITTING" || stage === "SUBMITTED" || stage === "FINALIZING";
  const canRetryPreparation = stage === "FAILED" && pending === null;

  return (
    <Modal open={open} title="Create asset" onClose={onClose} footer={<>
      <ActionButton variant="secondary" icon={X} onClick={onClose}>Close</ActionButton>
      {pendingSubmitted && <ActionButton variant="secondary" icon={RefreshCw} loading={stage === "FINALIZING"} disabled={stage === "FINALIZING"} onClick={() => void resumePending(pending!)}>Resume finalization</ActionButton>}
      {!pending && <ActionButton variant="primary" icon={stage === "PREPARING" || stage === "SUBMITTING" || stage === "FINALIZING" ? RefreshCw : CirclePlus} loading={stage === "PREPARING" || stage === "SUBMITTING" || stage === "FINALIZING"} disabled={!locus || (!signatureReady && !canRetryPreparation) || stageBusy} onClick={signatureReady ? signAndCreate : () => setPrepareRetry((value) => value + 1)}>{stage === "PREPARING" ? "Preparing…" : stage === "AWAITING_WALLET" ? "Sign & Create" : stage === "SIGNED" ? "Signature received" : stage === "SUBMITTING" ? "Submitting…" : stage === "SUBMITTED" ? "Submitted" : stage === "FINALIZING" ? "Finalizing…" : stage === "APPLIED" ? "Created" : "Retry preparation"}</ActionButton>}
    </>}>
      <p className="modal-lead">The connected Ownership becomes the issuer.</p>
      {session && <div className="issuer-card"><span className="identity-icon-slot"><IdentityIcon kind={session.kind} size={24} /></span><span><small>Owner / Issuer</small><strong>{session.label}</strong><code>{formatLocusId(session.owner)}</code>{session.kind === "matrix" && <small>Controller: device {session.matrix?.deviceId}; subject is the master Ownership</small>}</span></div>}
      <div className="form-grid">
        <label>Name<input disabled={pending !== null || stageBusy} value={name} placeholder="Dot Token" onChange={(event) => setName(event.target.value)} /></label>
        <label>Symbol<input disabled={pending !== null || stageBusy} value={symbol} placeholder="DOT" onChange={(event) => setSymbol(event.target.value.toUpperCase())} /></label>
        <label>Decimals<input disabled={pending !== null || stageBusy} type="number" min="0" max="38" value={decimals} onChange={(event) => setDecimals(event.target.value)} /></label>
        <label>Initial supply<input disabled={pending !== null || stageBusy} inputMode="decimal" value={supply} placeholder="1000" onChange={(event) => setSupply(event.target.value)} /></label>
      </div>
      <section className={`create-asset-stage create-asset-stage--${stage.toLowerCase()}`} aria-live="polite" role="status">
        <strong>{stageLabel(stage)}</strong>
        <p>{stageMessage}</p>
        {pending?.transactionId && <code>Transaction ID: {pending.transactionId}</code>}
      </section>
      {pending?.state === "submission-unknown" && <div className="create-asset-recovery">
        <p>This signed action has no known transaction ID. Locus will not create another signature or automatically submit this payload again.</p>
        <ActionButton variant="secondary" icon={SearchCheck} disabled={!locus} onClick={() => void checkUnknownSubmission(pending)}>Check asset state</ActionButton>
        <ActionButton variant="tertiary" icon={X} onClick={() => dismissUnknownSubmission(pending)}>Dismiss unresolved record</ActionButton>
      </div>}
      {error && <div className="transaction-error">{error}</div>}
    </Modal>
  );
}
