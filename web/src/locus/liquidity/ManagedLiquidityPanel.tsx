import { useEffect, useMemo, useState } from "react";
import { CirclePlus, Droplets, Minus, Plus, RefreshCw, X } from "lucide-react";
import {
  formatBasisPoints,
  maximumProportionalDeposit,
  parsePercentageBps,
  poolPriceDisplay,
  priceRatioWithinOneBasisPoint,
  proportionalOtherAmount,
  proportionalWithdrawal,
} from "./liquidityMath.js";
import { formatLocusId, formatUnits, MAX_POOL_RESERVE, normalizeLocusError, ownershipKey, parseUnits, SWAP_FEE_BPS, toHex, type AssetId, type LocusClient, type Ownership, type Pool } from "@archelabs/locus";
import type { AssetView, CuratedCatalogEntry } from "../assets.js";
import type { ManagedLiquidityConfig, ManagedLiquidityPair } from "./liquidityConfig.js";
import { ActionButton } from "../../components/ActionButton.js";
import { Modal } from "../../components/Modal.js";
import { CopyableValue } from "../../components/CopyableValue.js";
import { normalizeActionError } from "../../errors/normalizeError.js";
import "./liquidity.css";

type PairRow = {
  key: string;
  config: ManagedLiquidityPair;
  catalogA: CuratedCatalogEntry | null;
  catalogB: CuratedCatalogEntry | null;
  assetA: AssetView | null;
  assetB: AssetView | null;
  pool: Pool | null;
  reserveA: bigint;
  reserveB: bigint;
  managerMatches: boolean;
};

type EditKind = "create" | "add" | "remove";
type SubmissionStatus = "idle" | "awaiting-signature" | "submitted" | "applied" | "failed";
export type ManagedLiquidityScope = { networkId: string; serviceId: number | null; connectionId: string | null; ownerKey: string | null };

function sameBytes(a: AssetId, b: AssetId): boolean {
  return a.length === b.length && a.every((byte, index) => byte === b[index]);
}

function ownerKey(owner: Ownership): string {
  return toHex(ownershipKey(owner)).toLowerCase();
}

function reservePair(pool: Pool | null, assetA: AssetView, assetB: AssetView): [bigint, bigint] {
  if (!pool) return [0n, 0n];
  if (sameBytes(pool.asset0, assetA.assetId)) return [pool.reserve0, pool.reserve1];
  if (sameBytes(pool.asset0, assetB.assetId)) return [pool.reserve1, pool.reserve0];
  return [0n, 0n];
}

function findPool(pools: Pool[], assetA: AssetView, assetB: AssetView): Pool | null {
  return pools.find((pool) =>
    (sameBytes(pool.asset0, assetA.assetId) && sameBytes(pool.asset1, assetB.assetId))
    || (sameBytes(pool.asset0, assetB.assetId) && sameBytes(pool.asset1, assetA.assetId))) ?? null;
}

function friendlyLiquidityError(error: unknown): string {
  const locusError = normalizeLocusError(error);
  const code = locusError?.code;
  if (code === 3002) return "The manager Ownership does not have enough balance for these amounts.";
  return normalizeActionError(error, "The liquidity action failed.");
}

export function ManagedLiquidityPanel({
  config,
  curatedAssets,
  assets,
  pools,
  locus,
  networkId,
  serviceId,
  sessionOwner,
  connectionId,
  networkReady,
  isScopeCurrent,
  onPoolsRefreshed,
  onRefreshAssets,
}: {
  config: ManagedLiquidityConfig;
  curatedAssets: CuratedCatalogEntry[];
  assets: AssetView[];
  pools: Pool[];
  locus: LocusClient | null;
  networkId: string;
  serviceId: number | null;
  sessionOwner: Ownership;
  connectionId: string | null;
  networkReady: boolean;
  isScopeCurrent: (scope: ManagedLiquidityScope) => boolean;
  onPoolsRefreshed: (pools: Pool[]) => void;
  onRefreshAssets: () => Promise<unknown> | void;
}) {
  const [editKind, setEditKind] = useState<EditKind | null>(null);
  const [editingPairKey, setEditingPairKey] = useState("");
  const [step, setStep] = useState<"edit" | "review" | "confirm-drain">("edit");
  const [amountA, setAmountA] = useState("");
  const [amountB, setAmountB] = useState("");
  const [percentageBps, setPercentageBps] = useState(5_000);
  const [customPercentage, setCustomPercentage] = useState("50");
  const [submission, setSubmission] = useState<SubmissionStatus>("idle");
  const [transactionId, setTransactionId] = useState("");
  const [transactionUnknown, setTransactionUnknown] = useState(false);
  const [error, setError] = useState("");
  const [lastAction, setLastAction] = useState("");
  const currentOwnerKey = ownerKey(sessionOwner);
  const scope: ManagedLiquidityScope = { networkId, serviceId, connectionId, ownerKey: currentOwnerKey };

  const pairRows = useMemo(() => {
    const catalogByKey = new Map(curatedAssets.map((entry) => [entry.key, entry]));
    const assetById = new Map(assets.filter((asset) => asset.presentation.curated).map((asset) => [asset.assetIdHex.toLowerCase(), asset]));
    return config.pairs.filter((pair) => pair.enabled).map((pair): PairRow => {
      const catalogA = catalogByKey.get(pair.assetA) ?? null;
      const catalogB = catalogByKey.get(pair.assetB) ?? null;
      const assetA = catalogA ? assetById.get(catalogA.assetId.toLowerCase()) ?? null : null;
      const assetB = catalogB ? assetById.get(catalogB.assetId.toLowerCase()) ?? null : null;
      const pool = assetA && assetB ? findPool(pools, assetA, assetB) : null;
      const [reserveA, reserveB] = assetA && assetB ? reservePair(pool, assetA, assetB) : [0n, 0n];
      return {
        key: `${pair.assetA}:${pair.assetB}`,
        config: pair,
        catalogA,
        catalogB,
        assetA,
        assetB,
        pool,
        reserveA,
        reserveB,
        managerMatches: pool ? ownerKey(pool.manager) === config.managerKey : true,
      };
    });
  }, [assets, config.managerKey, config.pairs, curatedAssets, pools]);

  const editingPair = pairRows.find((pair) => pair.key === editingPairKey) ?? null;
  const busy = submission === "awaiting-signature" || submission === "submitted";
  const needsReseed = editKind === "add" && !!editingPair && (editingPair.reserveA === 0n || editingPair.reserveB === 0n);
  const scopeMatches = isScopeCurrent;

  useEffect(() => {
    setEditKind(null);
    setEditingPairKey("");
    setStep("edit");
    setSubmission("idle");
    setTransactionId("");
    setTransactionUnknown(false);
    setError("");
    setLastAction("");
    setAmountA("");
    setAmountB("");
  }, [networkId, serviceId, connectionId, currentOwnerKey]);

  function beginAction(kind: EditKind, pair: PairRow) {
    setEditingPairKey(pair.key);
    setEditKind(kind);
    setStep("edit");
    setAmountA("");
    setAmountB("");
    setPercentageBps(5_000);
    setCustomPercentage("50");
    setSubmission("idle");
    setTransactionId("");
    setTransactionUnknown(false);
    setError("");
  }

  function editAmountA(value: string) {
    setAmountA(value);
    if (editKind !== "add" || needsReseed || !editingPair?.assetA || !editingPair.assetB) return;
    try {
      const raw = parseUnits(value, editingPair.assetA.decimals);
      const other = proportionalOtherAmount(raw, editingPair.reserveA, editingPair.reserveB);
      setAmountB(formatUnits(other, editingPair.assetB.decimals));
    } catch {
      setAmountB("");
    }
  }

  function editAmountB(value: string) {
    setAmountB(value);
    if (editKind !== "add" || needsReseed || !editingPair?.assetA || !editingPair.assetB) return;
    try {
      const raw = parseUnits(value, editingPair.assetB.decimals);
      const other = proportionalOtherAmount(raw, editingPair.reserveB, editingPair.reserveA);
      setAmountA(formatUnits(other, editingPair.assetA.decimals));
    } catch {
      setAmountA("");
    }
  }

  function setMaxProportionalAmounts() {
    if (!editingPair?.assetA || !editingPair.assetB || needsReseed) return;
    const reserveCapA = MAX_POOL_RESERVE > editingPair.reserveA ? MAX_POOL_RESERVE - editingPair.reserveA : 0n;
    const reserveCapB = MAX_POOL_RESERVE > editingPair.reserveB ? MAX_POOL_RESERVE - editingPair.reserveB : 0n;
    try {
      const maximum = maximumProportionalDeposit(
        editingPair.assetA.balance ?? 0n,
        editingPair.assetB.balance ?? 0n,
        editingPair.reserveA,
        editingPair.reserveB,
        reserveCapA,
        reserveCapB,
      );
      setAmountA(formatUnits(maximum.amountA, editingPair.assetA.decimals));
      setAmountB(formatUnits(maximum.amountB, editingPair.assetB.decimals));
    } catch (cause) {
      setError(friendlyLiquidityError(cause));
    }
  }

  function calculateAmounts(): { amountA: bigint; amountB: bigint } | null {
    if (!editingPair?.assetA || !editingPair.assetB || !editKind) return null;
    if (editKind === "remove") {
      return proportionalWithdrawal(editingPair.reserveA, editingPair.reserveB, percentageBps);
    }
    try {
      const parsedA = parseUnits(amountA, editingPair.assetA.decimals);
      const parsedB = parseUnits(amountB, editingPair.assetB.decimals);
      if (parsedA <= 0n || parsedB <= 0n) return null;
      return { amountA: parsedA, amountB: parsedB };
    } catch {
      return null;
    }
  }

  function validateDraft(): string | null {
    if (!networkReady || !locus || serviceId === null) return "The selected network is not ready.";
    if (!editingPair?.assetA || !editingPair.assetB) return "The configured curated assets are not available on this Service.";
    if (currentOwnerKey !== config.managerKey) return "Connect the configured manager Ownership to manage this pool.";
    const amounts = calculateAmounts();
    if (!amounts || (editKind === "remove"
      ? amounts.amountA === 0n && amounts.amountB === 0n
      : amounts.amountA <= 0n || amounts.amountB <= 0n)) return "Enter amounts that produce a non-zero deposit or withdrawal.";
    if (editKind === "create") {
      if (editingPair.pool) return "This pair already exists on-chain. Refresh the list before continuing.";
      if (amounts.amountA > MAX_POOL_RESERVE || amounts.amountB > MAX_POOL_RESERVE) return "Each initial reserve must be at or below the pool reserve limit.";
    } else if (editKind === "add") {
      if (!editingPair.pool) return "This pool is not initialized. Create it first.";
      if (!editingPair.managerMatches) return "This pair exists, but its on-chain manager does not match the configured owner.";
      if (editingPair.reserveA + amounts.amountA > MAX_POOL_RESERVE || editingPair.reserveB + amounts.amountB > MAX_POOL_RESERVE) return "The added reserves would exceed the pool reserve limit.";
      if (!needsReseed && !priceRatioWithinOneBasisPoint(editingPair.reserveA, editingPair.reserveB, amounts.amountA, amounts.amountB)) {
        return "The deposit ratio would change the pool price by more than 0.01%. Adjust the amounts and review again.";
      }
    } else if (editKind === "remove") {
      if (!editingPair.pool) return "This pool is not initialized.";
      if (!editingPair.managerMatches) return "This pair exists, but its on-chain manager does not match the configured owner.";
      if (amounts.amountA > editingPair.reserveA || amounts.amountB > editingPair.reserveB) return "The withdrawal exceeds the current pool reserves.";
    }
    if (editKind !== "remove") {
      const balanceA = editingPair.assetA.balance;
      const balanceB = editingPair.assetB.balance;
      if (balanceA === null || balanceB === null) return "Manager balances are still loading.";
      if (amounts.amountA > balanceA || amounts.amountB > balanceB) return "The manager Ownership balance is not sufficient for both assets.";
    }
    return null;
  }

  function reviewAction() {
    const validationError = validateDraft();
    if (validationError) {
      setError(validationError);
      return;
    }
    setError("");
    setStep("review");
  }

  async function refreshAfterApplied(expectedScope: ManagedLiquidityScope) {
    if (!locus) return;
    const freshPools = await locus.listPools();
    if (!scopeMatches(expectedScope)) return;
    onPoolsRefreshed(freshPools);
    await onRefreshAssets();
  }

  async function submitAction() {
    if (!locus || !editingPair?.assetA || !editingPair.assetB || !editKind || busy) return;
    const validationError = validateDraft();
    if (validationError) {
      setError(validationError);
      setStep("edit");
      return;
    }
    const amounts = calculateAmounts();
    if (!amounts) return;
    const expectedScope = scope;
    setSubmission("awaiting-signature");
    setError("");
    setTransactionUnknown(false);
    const actionName = editKind === "create" ? "Create managed pool" : editKind === "add" ? (needsReseed ? "Reseed managed pool" : "Add managed liquidity") : "Remove managed liquidity";
    setLastAction(actionName);
    let submitStarted = false;
    let actionTransactionId = "";
    let actionFinalized = false;
    try {
      const currentPool = await locus.getPool(editingPair.assetA.assetId, editingPair.assetB.assetId);
      if (!scopeMatches(expectedScope)) return;
      if (editKind === "create" && currentPool) throw new Error("This pair was created after the review. Refresh the pool list and review again.");
      if (editKind !== "create" && !currentPool) throw new Error("This pool is no longer available. Refresh the pool list and review again.");
      if (currentPool && ownerKey(currentPool.manager) !== config.managerKey) throw Object.assign(new Error("This Ownership is not the manager of this pool."), { code: 6007 });
      const balanceA = await locus.balanceOf(editingPair.assetA.assetId, sessionOwner);
      const balanceB = await locus.balanceOf(editingPair.assetB.assetId, sessionOwner);
      if (!scopeMatches(expectedScope)) return;
      if (editKind !== "remove" && (amounts.amountA > balanceA || amounts.amountB > balanceB)) throw Object.assign(new Error("The manager Ownership balance is not sufficient for both assets."), { code: 3002 });
      if (editKind === "add" && currentPool) {
        const [latestA, latestB] = reservePair(currentPool, editingPair.assetA, editingPair.assetB);
        if (latestA !== editingPair.reserveA || latestB !== editingPair.reserveB) throw new Error("Pool reserves changed since review. Refresh and review the proportional deposit again.");
        if (needsReseed && latestA > 0n && latestB > 0n) throw new Error("This pool now has usable reserves. Refresh and review a proportional deposit.");
        if (!needsReseed && !priceRatioWithinOneBasisPoint(latestA, latestB, amounts.amountA, amounts.amountB)) throw new Error("The deposit ratio would change the pool price by more than 0.01%.");
      }
      if (editKind === "remove" && currentPool) {
        const [latestA, latestB] = reservePair(currentPool, editingPair.assetA, editingPair.assetB);
        if (latestA !== editingPair.reserveA || latestB !== editingPair.reserveB) throw new Error("Pool reserves changed since review. Refresh and review the withdrawal again.");
      }
      if (!scopeMatches(expectedScope)) return;
      submitStarted = true;
      const submitted = editKind === "create"
        ? await locus.createPool(editingPair.assetA.assetId, editingPair.assetB.assetId, amounts.amountA, amounts.amountB)
        : editKind === "add"
          ? await locus.addPoolLiquidity(editingPair.assetA.assetId, editingPair.assetB.assetId, amounts.amountA, amounts.amountB)
          : await locus.removePoolLiquidity(editingPair.assetA.assetId, editingPair.assetB.assetId, amounts.amountA, amounts.amountB);
      if (!scopeMatches(expectedScope)) return;
      actionTransactionId = submitted.transactionId;
      setTransactionId(submitted.transactionId);
      setTransactionUnknown(false);
      setSubmission("submitted");
      setStep("edit");
      setEditKind(null);
      let receipt;
      try {
        receipt = await locus.waitForAction(submitted.transactionId, { intervalMs: 500, timeoutMs: 180_000 });
      } catch (cause) {
        if (scopeMatches(expectedScope)) setTransactionUnknown(true);
        throw cause;
      }
      if (!scopeMatches(expectedScope)) return;
      actionFinalized = true;
      setTransactionUnknown(false);
      if (receipt.actionReceipt.status !== "applied") {
        const rejection = Object.assign(new Error(`Liquidity action failed${receipt.actionReceipt.errorCode === null ? "" : ` (error ${receipt.actionReceipt.errorCode})`}`), { code: receipt.actionReceipt.errorCode ?? undefined });
        throw rejection;
      }
      setSubmission("applied");
      setAmountA("");
      setAmountB("");
      try {
        await refreshAfterApplied(expectedScope);
      } catch {
        if (scopeMatches(expectedScope)) setError("The action is finalized, but pools or balances could not be refreshed. Refresh the network data before another action.");
      }
    } catch (cause) {
      if (!scopeMatches(expectedScope)) return;
      const rejectedByWallet = cause instanceof Error && /user rejected|request rejected|denied|cancelled|canceled/i.test(cause.message);
      const submissionUncertain = submitStarted && !actionFinalized && !rejectedByWallet;
      if (submissionUncertain) setTransactionUnknown(true);
      setSubmission("failed");
      setError(submissionUncertain
        ? `${friendlyLiquidityError(cause)} ${actionTransactionId ? `Transaction ${actionTransactionId} may still be pending.` : "No transaction ID was returned."} Do not repeat this action until its status is checked.`
        : friendlyLiquidityError(cause));
    }
  }

  async function checkPendingTransaction() {
    if (!locus || !transactionId || !transactionUnknown || busy) return;
    const expectedScope = scope;
    setSubmission("submitted");
    setError("");
    try {
      const receipt = await locus.waitForAction(transactionId, { intervalMs: 500, timeoutMs: 180_000 });
      if (!scopeMatches(expectedScope)) return;
      setTransactionUnknown(false);
      if (receipt.actionReceipt.status !== "applied") {
        const rejection = Object.assign(new Error(`Liquidity action failed${receipt.actionReceipt.errorCode === null ? "" : ` (error ${receipt.actionReceipt.errorCode})`}`), { code: receipt.actionReceipt.errorCode ?? undefined });
        throw rejection;
      }
      setSubmission("applied");
      try {
        await refreshAfterApplied(expectedScope);
      } catch {
        if (scopeMatches(expectedScope)) setError("The action is finalized, but pools or balances could not be refreshed. Refresh the network data before another action.");
      }
    } catch (cause) {
      if (!scopeMatches(expectedScope)) return;
      setSubmission("failed");
      setError(friendlyLiquidityError(cause));
    }
  }

  function checkDrainConfirmation() {
    setStep("confirm-drain");
  }

  function startRemoveReview() {
    try {
      setPercentageBps(parsePercentageBps(customPercentage));
      setError("");
      const nextBps = parsePercentageBps(customPercentage);
      if (!editingPair || !editingPair.pool || !editingPair.managerMatches) throw new Error("This pool is unavailable to the configured manager.");
      const amounts = proportionalWithdrawal(editingPair.reserveA, editingPair.reserveB, nextBps);
      if (amounts.amountA === 0n && amounts.amountB === 0n) throw new Error("This percentage rounds both withdrawal amounts to zero. Choose a larger percentage.");
      setStep("review");
    } catch (cause) {
      setError(friendlyLiquidityError(cause));
    }
  }

  const reviewAmounts = (() => {
    if (!editingPair || !editKind) return null;
    try {
      return calculateAmounts();
    } catch {
      return null;
    }
  })();
  const removal = editKind === "remove" && editingPair
    ? proportionalWithdrawal(editingPair.reserveA, editingPair.reserveB, percentageBps)
    : null;
  const priceBefore = editingPair
    ? poolPriceDisplay(editingPair.reserveA, editingPair.reserveB, editingPair.assetA?.decimals ?? 0, editingPair.assetB?.decimals ?? 0)
    : "—";
  const priceAfter = editingPair && reviewAmounts && editKind === "add"
    ? poolPriceDisplay(editingPair.reserveA + reviewAmounts.amountA, editingPair.reserveB + reviewAmounts.amountB, editingPair.assetA?.decimals ?? 0, editingPair.assetB?.decimals ?? 0)
    : "—";

  return <section className="managed-liquidity">
    <div className="managed-liquidity-heading">
      <div><h2>Managed liquidity</h2><p>Locus v1 has one manager Ownership per pool. It does not issue LP tokens or track individual liquidity shares.</p></div>
      <span className="managed-liquidity-manager">Manager · <CopyableValue value={formatLocusId(sessionOwner)} /></span>
    </div>
    <div className="managed-pool-list">
      {pairRows.length === 0 && <div className="empty-state">No managed pairs are configured for this network.</div>}
      {pairRows.map((pair) => {
        const ready = !!pair.assetA && !!pair.assetB;
        const statusLabel = !ready ? "Assets unavailable" : !pair.pool ? "Not initialized" : !pair.managerMatches ? "Manager conflict" : "Managed";
        const canManage = networkReady && ready && (!pair.pool || pair.managerMatches);
        const poolHasRatio = pair.reserveA > 0n && pair.reserveB > 0n;
        return <article className="managed-pool-card card" key={pair.key}>
          <div className="managed-pool-card__heading">
            <div><strong>{pair.assetA?.symbol ?? pair.config.assetA.toUpperCase()} / {pair.assetB?.symbol ?? pair.config.assetB.toUpperCase()}</strong><span className={`managed-pool-status${!pair.managerMatches ? " managed-pool-status--conflict" : ""}`}>{statusLabel}</span></div>
            <Droplets size={19} aria-hidden="true" />
          </div>
          {!ready && <p className="muted">The curated assets for this pair are not available from the selected Service.</p>}
          {pair.pool && ready && <>
            <dl className="managed-pool-details">
              <div><dt>Reserves</dt><dd>{formatUnits(pair.reserveA, pair.assetA!.decimals)} {pair.assetA!.symbol}<br />{formatUnits(pair.reserveB, pair.assetB!.decimals)} {pair.assetB!.symbol}</dd></div>
              <div><dt>Pool price</dt><dd>1 {pair.assetA!.symbol} ≈ {poolPriceDisplay(pair.reserveA, pair.reserveB, pair.assetA!.decimals, pair.assetB!.decimals)} {pair.assetB!.symbol}</dd></div>
            </dl>
            {!pair.managerMatches && <p className="managed-pool-conflict" role="alert">This pair already exists, but its on-chain manager does not match the configured managed-liquidity owner.</p>}
            {pair.managerMatches && !poolHasRatio && <p className="managed-pool-reseed">Pool needs reseeding. These amounts establish a new pool price.</p>}
          </>}
          {canManage && !pair.pool && <ActionButton icon={CirclePlus} disabled={busy || transactionUnknown} onClick={() => beginAction("create", pair)}>Create pool</ActionButton>}
          {canManage && pair.pool && <div className="managed-pool-actions">
            <ActionButton icon={Plus} disabled={busy || transactionUnknown} onClick={() => beginAction("add", pair)}>{poolHasRatio ? "Add liquidity" : "Reseed pool"}</ActionButton>
            <ActionButton icon={Minus} disabled={busy || transactionUnknown || (!poolHasRatio && pair.reserveA === 0n && pair.reserveB === 0n)} onClick={() => beginAction("remove", pair)}>Remove liquidity</ActionButton>
          </div>}
        </article>;
      })}
    </div>
    {submission !== "idle" && <div className={`liquidity-submission liquidity-submission--${submission}`} role={submission === "failed" ? "alert" : "status"}>
      <strong>{submission === "awaiting-signature" ? "Approve in your wallet or device…" : submission === "submitted" ? `${lastAction} submitted · waiting for finalization…` : submission === "applied" ? `${lastAction} applied` : error || `${lastAction} failed`}</strong>
      {transactionId && <code>{transactionId}</code>}
      {submission === "failed" && transactionId && transactionUnknown && <p>Do not submit this action again until its transaction status is known.</p>}
      {submission === "failed" && transactionId && transactionUnknown && <ActionButton size="small" variant="secondary" icon={RefreshCw} onClick={() => void checkPendingTransaction()}>Check transaction status</ActionButton>}
      {error && <p>{error}</p>}
    </div>}
    <p className="managed-liquidity-notice">Pool reserves are on-chain state. Fees remain in the pool; v1 does not calculate fees earned, APR, APY, or USD TVL.</p>

    <Modal
      open={editKind !== null && step !== "confirm-drain"}
      title={editKind === "create" ? "Create managed pool" : editKind === "add" ? (needsReseed ? "Reseed pool" : "Add liquidity") : "Remove liquidity"}
      onClose={() => { if (!busy) { setEditKind(null); setStep("edit"); } }}
      footer={editKind && <>
        <ActionButton variant="secondary" icon={X} disabled={busy} onClick={() => { setEditKind(null); setStep("edit"); }}>Cancel</ActionButton>
        {step === "edit" && editKind === "remove"
          ? <ActionButton variant="primary" icon={RefreshCw} disabled={busy} onClick={startRemoveReview}>Review withdrawal</ActionButton>
          : step === "edit"
            ? <ActionButton variant="primary" icon={RefreshCw} disabled={busy || !!validateDraft()} onClick={reviewAction}>Review {editKind === "create" ? "pool" : "deposit"}</ActionButton>
            : editKind === "remove" && percentageBps === 10_000
              ? <ActionButton variant="primary" className="liquidity-danger" disabled={busy || !!validateDraft()} onClick={checkDrainConfirmation}>Continue to drain confirmation</ActionButton>
              : <ActionButton variant="primary" icon={editKind === "create" ? CirclePlus : editKind === "add" ? Plus : Minus} loading={submission === "awaiting-signature"} disabled={busy || !!validateDraft()} onClick={() => void submitAction()}>{editKind === "create" ? "Create pool" : editKind === "add" ? "Add liquidity" : "Remove liquidity"}</ActionButton>}
      </>}
    >
      {editingPair && editKind && <div className="managed-liquidity-form">
        <p className="modal-lead">{editingPair.assetA?.symbol ?? editingPair.config.assetA.toUpperCase()} / {editingPair.assetB?.symbol ?? editingPair.config.assetB.toUpperCase()} · Fee {formatBasisPoints(SWAP_FEE_BPS)}</p>
        {step === "edit" && editKind !== "remove" && editingPair.assetA && editingPair.assetB && <>
          {editKind === "create" && <p className="managed-liquidity-warning">The initial reserve ratio defines the starting pool price. Locus v1 does not use an external price oracle.</p>}
          {needsReseed && <p className="managed-liquidity-warning">The pool has no usable reserve ratio. These amounts establish a new pool price.</p>}
          {editKind === "add" && !needsReseed && <p className="muted">Amounts stay aligned with the current reserve ratio. Editing either side recalculates the other side.</p>}
          <div className="liquidity-input-row"><label htmlFor="liquidity-amount-a">{editingPair.assetA.symbol}<input id="liquidity-amount-a" value={amountA} inputMode="decimal" placeholder="0" disabled={busy} onChange={(event) => editAmountA(event.target.value)} /></label><span>Available {formatUnits(editingPair.assetA.balance ?? 0n, editingPair.assetA.decimals)}</span></div>
          <div className="liquidity-input-row"><label htmlFor="liquidity-amount-b">{editingPair.assetB.symbol}<input id="liquidity-amount-b" value={amountB} inputMode="decimal" placeholder="0" disabled={busy} onChange={(event) => editAmountB(event.target.value)} /></label><span>Available {formatUnits(editingPair.assetB.balance ?? 0n, editingPair.assetB.decimals)}</span></div>
          {editKind === "add" && !needsReseed && <ActionButton variant="tertiary" icon={RefreshCw} disabled={busy} onClick={setMaxProportionalAmounts}>Max proportional deposit</ActionButton>}
          <dl className="managed-pool-details"><div><dt>Initial price</dt><dd>1 {editingPair.assetA.symbol} ≈ {(() => { try { const a = parseUnits(amountA, editingPair.assetA!.decimals); const b = parseUnits(amountB, editingPair.assetB!.decimals); return poolPriceDisplay(a, b, editingPair.assetA!.decimals, editingPair.assetB!.decimals); } catch { return "—"; } })()} {editingPair.assetB.symbol}</dd></div><div><dt>Reverse price</dt><dd>1 {editingPair.assetB.symbol} ≈ {(() => { try { const a = parseUnits(amountA, editingPair.assetA!.decimals); const b = parseUnits(amountB, editingPair.assetB!.decimals); return poolPriceDisplay(b, a, editingPair.assetB!.decimals, editingPair.assetA!.decimals); } catch { return "—"; } })()} {editingPair.assetA.symbol}</dd></div></dl>
        </>}
        {step === "edit" && editKind === "remove" && <>
          <fieldset className="liquidity-percent-options"><legend>Withdrawal amount</legend>{[2_500, 5_000, 7_500, 10_000].map((bps) => <button type="button" key={bps} className={percentageBps === bps ? "active" : ""} disabled={busy} onClick={() => { setPercentageBps(bps); setCustomPercentage(String(bps / 100)); }}>{bps / 100}%</button>)}</fieldset>
          <label className="liquidity-custom-percent">Custom percent<input value={customPercentage} inputMode="decimal" disabled={busy} onChange={(event) => setCustomPercentage(event.target.value)} onBlur={() => { try { setPercentageBps(parsePercentageBps(customPercentage)); } catch { /* Keep the text visible and explain it on review. */ } }} /></label>
          {removal && editingPair.assetA && editingPair.assetB && <dl className="managed-pool-details"><div><dt>Current reserves</dt><dd>{formatUnits(editingPair.reserveA, editingPair.assetA.decimals)} {editingPair.assetA.symbol}<br />{formatUnits(editingPair.reserveB, editingPair.assetB.decimals)} {editingPair.assetB.symbol}</dd></div><div><dt>You receive</dt><dd>{formatUnits(removal.amountA, editingPair.assetA.decimals)} {editingPair.assetA.symbol}<br />{formatUnits(removal.amountB, editingPair.assetB.decimals)} {editingPair.assetB.symbol}</dd></div></dl>}
        </>}
        {step === "review" && reviewAmounts && editingPair.assetA && editingPair.assetB && <>
          <p className="modal-lead">Review the exact amounts and pool state before signing.</p>
          {editKind === "create" && <p className="managed-liquidity-warning">The starting pool price is defined by these reserves. No oracle is used.</p>}
          {editKind === "add" && <p className="muted">Pool price before: 1 {editingPair.assetA.symbol} ≈ {priceBefore} {editingPair.assetB.symbol}<br />Pool price after: 1 {editingPair.assetA.symbol} ≈ {priceAfter} {editingPair.assetB.symbol}</p>}
          {editKind === "remove" && <p className="muted">Removing {formatUnits(reviewAmounts.amountA, editingPair.assetA.decimals)} {editingPair.assetA.symbol} and {formatUnits(reviewAmounts.amountB, editingPair.assetB.decimals)} {editingPair.assetB.symbol}.</p>}
          <dl className="review-list">
            <div><dt>Action</dt><dd>{editKind === "create" ? "Create managed pool" : editKind === "add" ? (needsReseed ? "Reseed pool" : "Add proportional liquidity") : `Remove ${formatBasisPoints(percentageBps)}`}</dd></div>
            {editKind !== "remove" && <><div><dt>Deposit</dt><dd>{formatUnits(reviewAmounts.amountA, editingPair.assetA.decimals)} {editingPair.assetA.symbol}<br />{formatUnits(reviewAmounts.amountB, editingPair.assetB.decimals)} {editingPair.assetB.symbol}</dd></div><div><dt>Available</dt><dd>{formatUnits(editingPair.assetA.balance ?? 0n, editingPair.assetA.decimals)} {editingPair.assetA.symbol}<br />{formatUnits(editingPair.assetB.balance ?? 0n, editingPair.assetB.decimals)} {editingPair.assetB.symbol}</dd></div></>}
            {editKind === "remove" && removal && <><div><dt>You receive</dt><dd>{formatUnits(removal.amountA, editingPair.assetA.decimals)} {editingPair.assetA.symbol}<br />{formatUnits(removal.amountB, editingPair.assetB.decimals)} {editingPair.assetB.symbol}</dd></div><div><dt>Remaining reserves</dt><dd>{formatUnits(removal.remainingA, editingPair.assetA.decimals)} {editingPair.assetA.symbol}<br />{formatUnits(removal.remainingB, editingPair.assetB.decimals)} {editingPair.assetB.symbol}</dd></div></>}
            <div><dt>Manager</dt><dd><CopyableValue label="Manager" value={formatLocusId(sessionOwner)} /></dd></div><div><dt>Fee</dt><dd>{formatBasisPoints(SWAP_FEE_BPS)}</dd></div>
          </dl>
          {editKind === "remove" && percentageBps === 10_000 && <p className="managed-liquidity-warning managed-liquidity-warning--danger">Removing 100% of reserves makes this pool unavailable for swaps until it is reseeded. The Pool record remains on-chain.</p>}
        </>}
        {error && <div className="transaction-error" role="alert">{error}</div>}
      </div>}
    </Modal>
    <Modal open={editKind === "remove" && step === "confirm-drain"} title="Drain managed pool?" onClose={() => { if (!busy) setStep("review"); }} footer={<><ActionButton variant="secondary" icon={X} disabled={busy} onClick={() => setStep("review")}>Back</ActionButton><ActionButton variant="primary" className="liquidity-danger" icon={Minus} loading={submission === "awaiting-signature"} disabled={busy || !!validateDraft()} onClick={() => void submitAction()}>Remove all reserves</ActionButton></>}>
      <p className="managed-liquidity-warning managed-liquidity-warning--danger">This removes all reserves from the pool. Swaps will be unavailable until the manager reseeds it. The Pool record remains on-chain.</p>
      {error && <div className="transaction-error" role="alert">{error}</div>}
    </Modal>
  </section>;
}
