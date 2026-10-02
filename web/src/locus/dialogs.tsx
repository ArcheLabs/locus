import { useEffect, useRef, useState } from "react";
import { formatLocusId, parseUnits, randomAssetId, type LocusClient, type OwnershipPreparationPhase } from "@archelabs/locus";
import { Modal } from "../components/Modal.js";
import { ActionButton } from "../components/ActionButton.js";
import { CopyableValue } from "../components/CopyableValue.js";
import { CirclePlus, ClipboardCopy, RefreshCw, SearchCheck, X } from "lucide-react";
import type { LocusWebSession } from "../session/types.js";
import type { AssetView } from "./assets.js";
import type { RecipientResolution } from "./recipients.js";
import { IdentityIcon } from "../components/IdentityIcon.js";
import { ConfirmationAssetList } from "../components/ConfirmationAssetList.js";
import { useI18n, type TranslationKey } from "../i18n/I18nProvider.js";
import { useGlobalNotify } from "../components/GlobalNotificationContext.js";
import {
  createAssetPendingKey,
  OperationTimeoutError,
  PreparationTimeoutError,
  readCreateAssetPendings,
  removeCreateAssetPending,
  resumeCreateAssetFinalization,
  submitCreateAssetOnce,
  waitForWalletSignature,
  withPreparationTimeout,
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
  const { t } = useI18n();
  return (
    <Modal
      open={open}
      title={t("ui.confirmTransfer")}
      onClose={onClose}
      footer={<><ActionButton variant="secondary" onClick={onClose}>{t("common.cancel")}</ActionButton><ActionButton variant="primary" disabled={!resolution.valid} onClick={onConfirm}>{t("ui.confirm")}</ActionButton></>}
    >
      <ConfirmationAssetList items={[{ asset, amount }]} />
      <dl className="review-list confirmation-details">
        <div><dt>{t("ui.to")}</dt><dd>{recipient}</dd></div>
      </dl>
    </Modal>
  );
}

export function ReceiveDialog({ open, asset, session, onClose }: { open: boolean; asset: Pick<AssetView, "symbol"> | { symbol: string } | null; session: LocusWebSession | null; onClose: () => void }) {
  const { t } = useI18n();
  const notify = useGlobalNotify();
  const locusId = session ? formatLocusId(session.owner) : "";
  async function copy() {
    if (!locusId) return;
    try {
      if (!navigator.clipboard?.writeText) throw new Error("Clipboard access is unavailable");
      await navigator.clipboard.writeText(locusId);
      notify("Copied");
    } catch { /* Clipboard failures stay silent; the ID remains selectable. */ }
  }
  return (
    <Modal open={open} title="Receive" onClose={onClose}>
      <p className="modal-lead">{t("ui.receiveShare", { asset: asset?.symbol ?? "the asset" })}</p>
      {!session ? <div className="empty-state">{t("ui.receiveNeedsSession")}</div> : <>
        <div className="receive-code"><code>{locusId}</code></div>
        <ActionButton variant="secondary" icon={ClipboardCopy} fullWidth onClick={copy}>{t("ui.copyLocusId")}</ActionButton>
        <p className="modal-note">{t("ui.receiveDetails")}</p>
      </>}
    </Modal>
  );
}

const WALLET_SIGNATURE_TIMEOUT_MS = 120_000;
const CREATE_ASSET_PREPARATION_TIMEOUT_MS = 45_000;
const SUBMISSION_TIMEOUT_MS = 30_000;
const CREATE_ASSET_FINALIZATION_TIMEOUT_MS = 180_000;

function bytesToHex(bytes: Uint8Array): string {
  return `0x${Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}

function stageLabel(stage: CreateAssetStage): string {
  switch (stage) {
    case "EDITING": return "Enter asset details";
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

function preparationPhaseKey(phase: OwnershipPreparationPhase): TranslationKey {
  switch (phase) {
    case "VALIDATING_DEPLOYMENT": return "ui.assetStage.phaseDeployment";
    case "READING_BEST_CONTEXT": return "ui.assetStage.phaseBest";
    case "READING_FINALIZED_CONTEXT": return "ui.assetStage.phaseFinalized";
    case "READING_MANAGED_STATE": return "ui.assetStage.phaseOwnership";
    case "READING_NONCE": return "ui.assetStage.phaseNonce";
  }
}

type CreateAssetPreparationRequest = {
  id: number;
  assetId: Uint8Array;
  name: string;
  symbol: string;
  decimals: number;
  initialSupply: bigint;
};

type LocalizedMessageParameter = string | number | { key: TranslationKey };
type LocalizedMessage = string | { key: TranslationKey; params?: Record<string, LocalizedMessageParameter> };

export function CreateAssetDialog({ open, locus, session, canPerformAuthorizedAction, authorizationWaitMessage, networkId, serviceId, onClose, onCreated }: {
  open: boolean;
  locus: LocusClient | null;
  session: LocusWebSession | null;
  canPerformAuthorizedAction: () => boolean;
  authorizationWaitMessage: string;
  networkId: string;
  serviceId: number | null;
  onClose: () => void;
  onCreated: () => void;
}) {
  const { t, text } = useI18n();
  const [name, setName] = useState("");
  const [symbol, setSymbol] = useState("");
  const [decimals, setDecimals] = useState("0");
  const [supply, setSupply] = useState("");
  const [draftAssetId, setDraftAssetId] = useState(() => randomAssetId());
  const [prepared, setPrepared] = useState<Awaited<ReturnType<LocusClient["prepareCreateAsset"]>> | null>(null);
  const preparedRef = useRef<typeof prepared>(null);
  const appliedRef = useRef(false);
  const prepareGeneration = useRef(0);
  const prepareRequestId = useRef(0);
  const activeResumeKeys = useRef(new Set<string>());
  const [prepareRequest, setPrepareRequest] = useState<CreateAssetPreparationRequest | null>(null);
  const [stage, setStage] = useState<CreateAssetStage>("EDITING");
  const [stageMessage, setStageMessage] = useState<LocalizedMessage>("Enter the asset details to prepare the network action.");
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
    setPrepareRequest(null);
    setName("");
    setSymbol("");
    setDecimals("0");
    setSupply("");
    setDraftAssetId(randomAssetId());
  }

  const decimalCount = Number(decimals);
  let draftSupply: bigint | null = null;
  if (supply.trim() && Number.isInteger(decimalCount) && decimalCount >= 0 && decimalCount <= 38) {
    try { draftSupply = parseUnits(supply.trim(), decimalCount); } catch { draftSupply = null; }
  }
  const assetDetailsComplete = Boolean(
    name.trim() && symbol.trim() && decimals.trim() && supply.trim()
      && Number.isInteger(decimalCount) && decimalCount >= 0 && decimalCount <= 38
      && draftSupply !== null,
  );

  function requestPreparation() {
    if (!locus || !session || !pendingScope || pendingRef.current || !assetDetailsComplete || draftSupply === null) return;
    if (!canPerformAuthorizedAction()) {
      setStageMessage(authorizationWaitMessage || "正在准备账户，请稍候。");
      return;
    }
    setError("");
    setStage("PREPARING");
    setStageMessage("Preparing the create action. No wallet request is open yet.");
    setPrepareRequest({
      id: ++prepareRequestId.current,
      assetId: draftAssetId.slice(),
      name: name.trim(),
      symbol: symbol.trim(),
      decimals: decimalCount,
      initialSupply: draftSupply,
    });
  }

  function editAssetDetails() {
    if (preparedRef.current) locus?.abandonPreparedOwnershipAction(preparedRef.current);
    preparedRef.current = null;
    setPrepared(null);
    setPrepareRequest(null);
    setStage("EDITING");
    setStageMessage("Update the asset details, then prepare the action again.");
    setError("");
  }

  function onAssetDetailChange(update: () => void) {
    update();
    if (stage === "FAILED" && pendingRef.current === null) {
      setStage("EDITING");
      setStageMessage("Asset details changed. Prepare the action again when ready.");
      setError("");
    }
  }

  async function resumePending(record: CreateAssetPendingRecord) {
    if (!locus || record.state !== "submitted" || !record.transactionId || !record.actionHash) return;
    if (activeResumeKeys.current.has(record.key)) return;
    activeResumeKeys.current.add(record.key);
    setStage("FINALIZING");
    setStageMessage({ key: "ui.assetStage.checkingSaved", params: { transactionId: record.transactionId } });
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
        ? { key: "ui.assetStage.resumeSaved", params: { transactionId: record.transactionId } }
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
      setPrepareRequest(null);
      return;
    }
    if (appliedRef.current) {
      if (!name.trim() && !symbol.trim() && !supply.trim()) return;
      appliedRef.current = false;
    }
    if (pendingRef.current) return;
    if (!locus || !session || !pendingScope) {
      setStage("EDITING");
      setStageMessage(!session
        ? "Connect an Ownership before preparing this asset action."
        : !pendingScope
          ? "Wait for the active network and Service to finish loading."
          : "Waiting for the selected MiniJAM network to become ready.");
      setError("");
      return;
    }

    if (!prepareRequest) {
      setStage("EDITING");
      setStageMessage("Complete the asset name, symbol, decimals, and initial supply to prepare the action.");
      setError("");
      return;
    }

    setStage("PREPARING");
    setStageMessage("Checking the deployment, finalized state, and Ownership nonce before opening your wallet.");
    setError("");
    const timer = window.setTimeout(() => {
      let lastPhase: OwnershipPreparationPhase | null = null;
      const preparation = locus.prepareCreateAsset(
        prepareRequest.assetId,
        prepareRequest.name,
        prepareRequest.symbol,
        prepareRequest.decimals,
        prepareRequest.initialSupply,
        undefined,
        (phase) => {
          lastPhase = phase;
          if (generation === prepareGeneration.current) setStageMessage({ key: preparationPhaseKey(phase) });
        },
      );
      void withPreparationTimeout(
        preparation,
        CREATE_ASSET_PREPARATION_TIMEOUT_MS,
        (lateAction) => locus.abandonPreparedOwnershipAction(lateAction),
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
          if (cause instanceof PreparationTimeoutError) {
            const phase = { key: lastPhase ? preparationPhaseKey(lastPhase) : "ui.preparingAction" } as const;
            setStageMessage({ key: "ui.assetStage.preparationTimeout", params: { phase } });
            setError(cause.message);
          } else {
            setStageMessage("The action was not signed or submitted. Retry preparation after checking the network connection.");
            setError(cause instanceof Error ? cause.message : "Unable to prepare the create-asset action.");
          }
        });
    }, 300);
    return () => {
      window.clearTimeout(timer);
      if (preparedRef.current) locus.abandonPreparedOwnershipAction(preparedRef.current);
      preparedRef.current = null;
    };
  }, [open, locus, session, pendingScope, prepareRequest]);

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
    setStage("EDITING");
    setStageMessage("Recovery record dismissed. Prepare the action again only after checking the chain.");
    setError("");
    setPrepareRequest(null);
  }

  async function signAndCreate() {
    if (!locus || !preparedRef.current || pendingRef.current) return;
    if (!canPerformAuthorizedAction()) {
      setStageMessage(authorizationWaitMessage || "正在准备账户，请稍候。");
      return;
    }
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
      if (!canPerformAuthorizedAction()) throw new Error(`${authorizationWaitMessage || "正在准备账户，请稍候。"} No transaction was submitted.`);

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
        setStageMessage({ key: "ui.assetStage.transactionSaved", params: { transactionId: submitted.transactionId } });
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
      } else {
        setStage("FAILED");
        setStageMessage(errorPending.transactionId
          ? { key: "ui.assetStage.resumeTransaction", params: { transactionId: errorPending.transactionId } }
          : "The submission outcome is unresolved. Do not sign or submit it again automatically.");
        setError(message);
      }
    }
  }

  const pendingSubmitted = pending?.state === "submitted";
  const signatureReady = stage === "AWAITING_WALLET" && prepared !== null && pending === null;
  const signatureInProgress = stage === "AWAITING_WALLET" && prepared === null;
  const stageBusy = stage === "PREPARING" || signatureInProgress || stage === "SIGNED" || stage === "SUBMITTING" || stage === "SUBMITTED" || stage === "FINALIZING";
  const canRetryPreparation = stage === "FAILED" && pending === null && assetDetailsComplete;
  const assetFieldsDisabled = pending !== null || stageBusy || signatureReady;
  const issuerType = session?.kind === "matrix" ? t("common.matrix")
    : session?.kind === "evm" ? t("ui.evmWallet")
      : session?.kind === "polkadot" ? t("ui.polkadotExtension")
        : session?.kind === "solana" ? t("ui.solanaWallet") : "";
  const issuerName = session?.kind === "matrix" ? session.matrix?.userId ?? session.label.replace(/^Matrix\s+/, "") : session?.label;
  const primaryButtonLoading = stage === "PREPARING" || signatureInProgress || stage === "SUBMITTING" || stage === "FINALIZING";
  const primaryButtonLabel = signatureReady && !canPerformAuthorizedAction() ? authorizationWaitMessage || "Preparing account…"
    : stage === "EDITING" && (!locus || !pendingScope) ? "Waiting for network…"
      : stage === "EDITING" && !session ? "Connect an Ownership"
        : stage === "EDITING" || canRetryPreparation ? t("common.confirm")
          : stage === "PREPARING" ? "Preparing…"
            : signatureInProgress ? "Waiting for wallet…"
              : stage === "AWAITING_WALLET" ? "Sign & Create"
                : stage === "SIGNED" ? "Signature received"
                  : stage === "SUBMITTING" ? "Submitting…"
                    : stage === "SUBMITTED" ? "Submitted"
                      : stage === "FINALIZING" ? "Finalizing…"
                        : stage === "APPLIED" ? "Created"
                          : "Confirm";

  return (
    <Modal open={open} title={t("assets.create")} onClose={onClose} footer={<>
      {pendingSubmitted && <ActionButton variant="secondary" icon={RefreshCw} loading={stage === "FINALIZING"} disabled={stage === "FINALIZING"} onClick={() => void resumePending(pending!)}>{t("ui.resumeFinalization")}</ActionButton>}
      {signatureReady && <ActionButton variant="tertiary" icon={X} onClick={editAssetDetails}>{t("ui.editDetails")}</ActionButton>}
      {!pending && <ActionButton variant="primary" icon={primaryButtonLoading ? RefreshCw : stage === "EDITING" ? undefined : CirclePlus} loading={primaryButtonLoading} disabled={signatureReady ? !canPerformAuthorizedAction() : !locus || !session || !pendingScope || (!assetDetailsComplete && !signatureReady) || stageBusy} onClick={signatureReady ? signAndCreate : requestPreparation}>{primaryButtonLabel}</ActionButton>}
    </>}>
      {session && <div className="issuer-card"><span className="identity-icon-slot"><IdentityIcon kind={session.kind} size={24} /></span><span><strong>{issuerType} · {issuerName}</strong></span></div>}
      <div className="form-grid">
        <label>{t("ui.assetName")}<input disabled={assetFieldsDisabled} value={name} placeholder={t("ui.assetNamePlaceholder")} onChange={(event) => onAssetDetailChange(() => setName(event.target.value))} /></label>
        <label>{t("ui.assetSymbol")}<input disabled={assetFieldsDisabled} value={symbol} placeholder="DOT" onChange={(event) => onAssetDetailChange(() => setSymbol(event.target.value.toUpperCase()))} /></label>
        <label>{t("ui.assetDecimals")}<input disabled={assetFieldsDisabled} type="number" min="0" max="38" value={decimals} onChange={(event) => onAssetDetailChange(() => setDecimals(event.target.value))} /></label>
        <label>{t("ui.initialSupplyLabel")}<input disabled={assetFieldsDisabled} inputMode="decimal" value={supply} placeholder="1000" onChange={(event) => onAssetDetailChange(() => setSupply(event.target.value))} /></label>
      </div>
      {(stage !== "EDITING" || error || pending) && <section className={`create-asset-stage create-asset-stage--${stage.toLowerCase()}`} aria-live="polite" aria-busy={stageBusy} role="status">
        <strong>{text(stageLabel(stage))}</strong>
        <p>{typeof stageMessage === "string" ? text(stageMessage) : t(stageMessage.key, Object.fromEntries(Object.entries(stageMessage.params ?? {}).map(([key, value]) => [key, typeof value === "object" ? t(value.key) : value])))}</p>
        {pending?.transactionId && <CopyableValue label={t("common.transaction")} value={pending.transactionId} />}
      </section>}
      {session?.kind === "matrix" && !canPerformAuthorizedAction() && <p className="account-access-status" role="status">{authorizationWaitMessage || "正在准备账户，请稍候。"}</p>}
      {pending?.state === "submission-unknown" && <div className="create-asset-recovery">
        <p>{t("ui.unknownCreateSubmission")}</p>
        <ActionButton variant="secondary" icon={SearchCheck} disabled={!locus} onClick={() => void checkUnknownSubmission(pending)}>{t("ui.checkAssetState")}</ActionButton>
        <ActionButton variant="tertiary" icon={X} onClick={() => dismissUnknownSubmission(pending)}>{t("ui.dismissUnresolved")}</ActionButton>
      </div>}
      {error && <><p className="transaction-error" role="alert">{t("ui.actionNeedsAttention")}</p><details className="transaction-error-details"><summary>{t("ui.technicalDetails")}</summary><pre>{error}</pre></details></>}
    </Modal>
  );
}
