import { useEffect, useMemo, useState } from "react";
import { ArrowDownUp, ArrowLeftRight } from "lucide-react";
import { formatUnits, minimumAmountOut, ownershipKey, parseUnits, quoteExactIn, SWAP_FEE_BPS, toHex, type LocusClient, type Ownership, type Pool } from "@archelabs/locus";
import type { AssetView } from "../assets.js";
import { AssetSelector } from "../../components/AssetSelector.js";
import { AssetAmountInput } from "../../components/AssetAmountInput.js";
import { ActionButton } from "../../components/ActionButton.js";
import { Modal } from "../../components/Modal.js";
import { ConfirmationAssetList } from "../../components/ConfirmationAssetList.js";
import { FieldMessage } from "../../forms/FieldMessage.js";
import { FormField } from "../../forms/FormField.js";
import { normalizeActionError } from "../../errors/normalizeError.js";
import { validatePositiveAmount } from "../../forms/validation.js";
import { parseSlippageBps } from "./swapValidation.js";
import type { LiquidityScope } from "../liquidity/liquidityTypes.js";
import { directPoolForPair } from "../pools/poolQueries.js";
import { formatBasisPoints } from "../liquidity/liquidityMath.js";
import type { GlobalTransactionNotice } from "../../components/GlobalNotifications.js";

type Submission = "idle" | "awaiting-signature" | "submitted" | "applied" | "failed";
type Quote = { amountIn: bigint; amountOut: bigint; minimumAmountOut: bigint; feeAmount: bigint };

export { parseSlippageBps } from "./swapValidation.js";

function friendlySwapError(cause: unknown): string {
  const normalized = normalizeActionError(cause, "The swap could not be completed.");
  if (normalized.includes("balance is too low")) return "Your balance is too low for this swap.";
  if (normalized.includes("There is not enough liquidity")) return "There is not enough liquidity for this swap.";
  return normalized;
}

function sameScope(current: ((scope: LiquidityScope) => boolean) | undefined, scope: LiquidityScope): boolean {
  return current ? current(scope) : true;
}

export function SwapPage({ networkMode, networkId, status, serviceId, locus, assets, pools, poolLoading, poolError, sessionOwner, connectionId, isScopeCurrent, onConnect, onApplied, onNotify, onTransactionNotice, onClearTransactionNotice, onRefreshAssets, onRefreshPools }: {
  networkMode: boolean;
  networkId: string;
  status: string;
  serviceId: number | null;
  locus: LocusClient | null;
  assets: AssetView[];
  pools: Pool[];
  poolLoading: boolean;
  poolError: string;
  sessionOwner: Ownership | null;
  connectionId: string | null;
  isScopeCurrent?: (scope: LiquidityScope) => boolean;
  onConnect: () => void;
  onApplied: (item: { assetIn: string; assetOut: string; amountIn: string; amountOut: string; transactionId: string; networkId: string }) => void;
  onNotify: (message: string) => void;
  onTransactionNotice: (notice: GlobalTransactionNotice) => void;
  onClearTransactionNotice: (id: string) => void;
  onRefreshAssets: () => Promise<unknown>;
  onRefreshPools: () => Promise<unknown>;
}) {
  const [assetInId, setAssetInId] = useState("");
  const [assetOutId, setAssetOutId] = useState("");
  const [amount, setAmount] = useState("");
  const [slippage, setSlippage] = useState("0.5");
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [amountTouched, setAmountTouched] = useState(false);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [submission, setSubmission] = useState<Submission>("idle");
  const [actionError, setActionError] = useState("");
  const busy = submission === "awaiting-signature" || submission === "submitted";

  useEffect(() => {
    if (busy) return;
    if (assets.length < 2) return;
    const validIds = new Set(assets.map((asset) => asset.assetIdHex.toLowerCase()));
    if (!validIds.has(assetInId.toLowerCase()) || !validIds.has(assetOutId.toLowerCase())) {
      const firstPool = pools.find((pool) => pool.reserve0 > 0n && pool.reserve1 > 0n);
      const firstPoolIds = firstPool ? [toHex(firstPool.asset0).toLowerCase(), toHex(firstPool.asset1).toLowerCase()] : [];
      const defaultIn = validIds.has(firstPoolIds[0] ?? "") ? firstPoolIds[0]! : assets[0]!.assetIdHex;
      const defaultOut = validIds.has(firstPoolIds[1] ?? "") && firstPoolIds[1] !== defaultIn ? firstPoolIds[1]! : assets.find((asset) => asset.assetIdHex.toLowerCase() !== defaultIn.toLowerCase())!.assetIdHex;
      setAssetInId(defaultIn);
      setAssetOutId(defaultOut);
      setAmount("");
      setAmountTouched(false);
      setSubmission("idle");
      setActionError("");
      setReviewOpen(false);
    }
  }, [assetInId, assetOutId, assets, busy, pools]);

  const assetById = useMemo(() => new Map(assets.map((asset) => [asset.assetIdHex.toLowerCase(), asset])), [assets]);
  const assetIn = assetById.get(assetInId.toLowerCase()) ?? null;
  const assetOut = assetById.get(assetOutId.toLowerCase()) ?? null;
  const pool = assetIn && assetOut ? directPoolForPair(pools, assetIn.assetIdHex, assetOut.assetIdHex) : null;
  const slippageBps = parseSlippageBps(slippage);
  const quote: Quote | null = useMemo(() => {
      if (!pool || !assetIn || !assetOut || !amount.trim()) return null;
    try {
      const amountIn = parseUnits(amount, assetIn.decimals);
      if (amountIn <= 0n) return null;
      const asset0In = toHex(pool.asset0).toLowerCase() === assetIn.assetIdHex.toLowerCase();
      const reserveIn = asset0In ? pool.reserve0 : pool.reserve1;
      const reserveOut = asset0In ? pool.reserve1 : pool.reserve0;
      const result = quoteExactIn(reserveIn, reserveOut, amountIn);
      if (result.amountOut <= 0n || result.amountOut >= reserveOut) return null;
      return {
        amountIn: result.amountIn,
        amountOut: result.amountOut,
        feeAmount: result.feeAmount,
        minimumAmountOut: minimumAmountOut(result.amountOut, slippageBps ?? 50),
      };
    } catch {
      return null;
    }
  }, [amount, assetIn, assetOut, pool, slippageBps]);

  const price = useMemo(() => {
    if (!pool || !assetIn || !assetOut || pool.reserve0 === 0n || pool.reserve1 === 0n) return null;
    const asset0In = toHex(pool.asset0).toLowerCase() === assetIn.assetIdHex.toLowerCase();
    const rawIn = asset0In ? pool.reserve0 : pool.reserve1;
    const rawOut = asset0In ? pool.reserve1 : pool.reserve0;
    const humanIn = Number(formatUnits(rawIn, assetIn.decimals));
    const humanOut = Number(formatUnits(rawOut, assetOut.decimals));
    const result = humanOut / humanIn;
    return Number.isFinite(result) ? result : null;
  }, [assetIn, assetOut, pool]);
  const impact = quote && price !== null && assetIn && assetOut
    ? Math.max(0, (1 - Number(formatUnits(quote.amountOut, assetOut.decimals)) / Number(formatUnits(quote.amountIn, assetIn.decimals)) / price) * 100)
    : null;
  const amountValidation = assetIn ? validatePositiveAmount(amount, assetIn.decimals, assetIn.balance) : amount.trim() ? "Choose an input asset." : null;
  const validation = amountValidation;
  const visibleValidation = amountTouched ? validation : null;
  const slippageInvalid = slippageBps === null;
  const feeLabel = formatBasisPoints(SWAP_FEE_BPS);

  function updatePair(input: string, output: string) {
    if (busy) return;
    setAssetInId(input);
    setAssetOutId(output);
    setAmount("");
    setAmountTouched(false);
    setSubmission("idle");
    setActionError("");
    setReviewOpen(false);
  }

  function openReview() {
    setAmountTouched(true);
    setActionError("");
    if (!networkMode || status !== "ready" || !locus) {
      setActionError("The selected network is unavailable. Retry the connection before swapping.");
      return;
    }
    if (!sessionOwner) {
      onConnect();
      return;
    }
    if (slippageInvalid) {
      setDetailsOpen(true);
      return;
    }
    if (validation || !quote || !assetIn || !assetOut) return;
    setReviewOpen(true);
  }

  async function confirmSwap() {
    if (!locus || !assetIn || !assetOut || !quote || !sessionOwner || serviceId === null) return;
    const expectedScope: LiquidityScope = {
      networkId,
      serviceId,
      connectionId,
      ownerKey: toHex(ownershipKey(sessionOwner)).toLowerCase(),
    };
    setReviewOpen(false);
    setSubmission("awaiting-signature");
    setActionError("");
    onClearTransactionNotice("swap-transaction");
    let submittedTransactionId = "";
    let terminalFailure = false;
    try {
      const submitted = await locus.swapExactIn(assetIn.assetId, assetOut.assetId, quote.amountIn, quote.minimumAmountOut);
      submittedTransactionId = submitted.transactionId;
      onTransactionNotice({
        id: "swap-transaction",
        title: "Swap pending",
        message: "Waiting for confirmation.",
        transactionId: submitted.transactionId,
        busy: true,
      });
      if (!sameScope(isScopeCurrent, expectedScope)) {
        const receipt = await locus.waitForAction(submitted.transactionId, { intervalMs: 500, timeoutMs: 180_000 });
        onClearTransactionNotice("swap-transaction");
        if (receipt.actionReceipt.status !== "applied") {
          onTransactionNotice({ id: "swap-transaction", title: "Swap failed", message: "The action was not applied. Review the current balances before retrying.", transactionId: submitted.transactionId, tone: "error", dismissible: true });
        }
        setSubmission("idle");
        return;
      }
      setSubmission("submitted");
      const receipt = await locus.waitForAction(submitted.transactionId, { intervalMs: 500, timeoutMs: 180_000 });
      if (receipt.actionReceipt.status !== "applied") {
        terminalFailure = true;
        throw new Error(`Swap failed${receipt.actionReceipt.errorCode === null ? "" : ` (error ${receipt.actionReceipt.errorCode})`}`);
      }
      onClearTransactionNotice("swap-transaction");
      if (!sameScope(isScopeCurrent, expectedScope)) {
        setSubmission("idle");
        return;
      }
      setSubmission("applied");
      try {
        onApplied({
          assetIn: assetIn.symbol,
          assetOut: assetOut.symbol,
          amountIn: formatUnits(quote.amountIn, assetIn.decimals),
          amountOut: formatUnits(quote.amountOut, assetOut.decimals),
          transactionId: submitted.transactionId,
          networkId,
        });
      } catch {
        // A browser-local activity write must not change the finalized transaction result.
      }
      setAmount("");
      setAmountTouched(false);
      await Promise.allSettled([onRefreshAssets(), onRefreshPools()]);
      onNotify("Swap completed.");
    } catch (cause) {
      const message = friendlySwapError(cause);
      if (submittedTransactionId) {
        onTransactionNotice({
          id: "swap-transaction",
          title: terminalFailure ? "Swap failed" : "Swap status needs attention",
          message: terminalFailure ? `${message} Review the current balances before retrying.` : "The final status is not available yet. Check it before retrying.",
          transactionId: submittedTransactionId,
          tone: "error",
          dismissible: true,
        });
      }
      if (!sameScope(isScopeCurrent, expectedScope)) {
        setSubmission("idle");
        return;
      }
      setSubmission("failed");
      setActionError(submittedTransactionId ? "" : message);
    }
  }

  function flipPair() {
    if (!assetIn || !assetOut) return;
    updatePair(assetOut.assetIdHex, assetIn.assetIdHex);
  }

  function useMax() {
    if (!assetIn || assetIn.balance === null) return;
    setAmount(formatUnits(assetIn.balance, assetIn.decimals));
    setAmountTouched(true);
    setSubmission("idle");
    setActionError("");
  }

  return <section className="page swap-page">
    <div className="card swap-card">
      {poolLoading && <p className="muted">Checking available pairs…</p>}
      {poolError && <div className="inline-alert" role="alert">Available pairs could not be loaded. Try again from the network controls.</div>}
      <div className="swap-amount-field">
        <AssetAmountInput
          selector={<AssetSelector aria-label="Asset to pay" triggerClassName="swap-asset-selector" variant="compact" showBalance={false} disabled={busy} value={assetInId} assets={assets} onValueChange={(asset) => updatePair(asset.assetIdHex, assetOutId)} />}
          label="You pay"
          balance={`Balance: ${assetIn?.balance === null || !assetIn ? "Unavailable" : formatUnits(assetIn.balance, assetIn.decimals)} ${assetIn?.symbol ?? ""}`.trim()}
          id="swap-amount"
          amount={amount}
          disabled={busy}
          onAmountChange={(value) => { setAmount(value); setSubmission("idle"); setActionError(""); }}
          onAmountBlur={() => setAmountTouched(true)}
          onMax={useMax}
          maxDisabled={!assetIn || assetIn.balance === null}
          placeholder="0"
          ariaLabel="Amount to pay"
          ariaInvalid={Boolean(visibleValidation)}
          ariaDescribedBy={visibleValidation ? "swap-amount-error" : undefined}
        />
        <div className={`swap-direction-row${visibleValidation ? " swap-direction-row--invalid" : ""}`}>
          {visibleValidation && <FieldMessage id="swap-amount-error" error={visibleValidation} />}
          <button className="swap-direction" type="button" aria-label="Switch assets" disabled={busy} onClick={flipPair}><ArrowDownUp size={18} aria-hidden="true" /></button>
        </div>
      </div>

      <AssetAmountInput
        className="swap-amount-field"
        selector={<AssetSelector aria-label="Asset to receive" triggerClassName="swap-asset-selector" variant="compact" showBalance={false} disabled={busy} value={assetOutId} assets={assets} onValueChange={(asset) => updatePair(assetInId, asset.assetIdHex)} />}
        label="You receive"
        balance="Estimated amount"
        id="swap-token-out"
        amount={quote && assetOut ? formatUnits(quote.amountOut, assetOut.decimals) : "0"}
        readOnly
        ariaLabel="Estimated amount to receive"
      />
      {assetIn && assetOut && assetIn.assetIdHex === assetOut.assetIdHex && <FieldMessage error="Choose two different assets." />}
      {assetIn && assetOut && assetIn.assetIdHex !== assetOut.assetIdHex && !pool && !poolLoading && <FieldMessage>This pair is not available for swapping yet.</FieldMessage>}
      {pool && (!pool.reserve0 || !pool.reserve1) && <p className="form-message">This pair is not available for swapping yet.</p>}

      {quote && assetIn && assetOut && price !== null && <p className="swap-rate">1 {assetIn.symbol} ≈ {price.toLocaleString(undefined, { maximumFractionDigits: 8 })} {assetOut.symbol}</p>}
      {impact !== null && impact >= 5 && <p className="swap-impact-warning" role="status">High price impact: {impact.toLocaleString(undefined, { maximumFractionDigits: 2 })}%</p>}
      <details className="swap-advanced-details" open={detailsOpen} onToggle={(event) => setDetailsOpen(event.currentTarget.open)}>
        <summary>Transaction details</summary>
        <FormField label="Slippage tolerance" htmlFor="swap-slippage" error={slippageInvalid ? "Enter a slippage value from 0.01% to 50%." : null} errorId="swap-slippage-error" className="swap-settings-field">
          <div className="swap-slippage-input"><input id="swap-slippage" inputMode="decimal" disabled={busy} value={slippage} onChange={(event) => setSlippage(event.target.value)} aria-invalid={slippageInvalid} aria-describedby={slippageInvalid ? "swap-slippage-error" : undefined} /><span>%</span></div>
        </FormField>
        {quote && assetOut && <dl className="swap-quote-details">
          <div><dt>Minimum received</dt><dd>{formatUnits(quote.minimumAmountOut, assetOut.decimals)} {assetOut.symbol}</dd></div>
          <div><dt>Fee</dt><dd>{feeLabel}</dd></div>
          {impact !== null && <div><dt>Price impact</dt><dd>{impact.toLocaleString(undefined, { maximumFractionDigits: 2 })}%</dd></div>}
        </dl>}
      </details>

      {actionError && <p className="action-status action-status--error" role="alert">{actionError}</p>}
      <ActionButton className="swap-review-action" variant="primary" icon={ArrowLeftRight} fullWidth disabled={busy || status !== "ready" || !quote || !assetIn || !assetOut || Boolean(validation) || submission === "applied"} onClick={openReview}>
        {submission === "awaiting-signature" ? "Approve in wallet…" : submission === "submitted" ? "Waiting for confirmation…" : submission === "applied" ? "Swap completed" : sessionOwner ? "Review swap" : "Connect to swap"}
      </ActionButton>
    </div>

    {reviewOpen && quote && assetIn && assetOut && <Modal open title="Confirm swap" onClose={() => setReviewOpen(false)} footer={<><ActionButton variant="secondary" onClick={() => setReviewOpen(false)}>Cancel</ActionButton><ActionButton variant="primary" disabled={busy} onClick={() => void confirmSwap()}>Confirm</ActionButton></>}>
      <ConfirmationAssetList items={[
        { asset: assetIn, amount: formatUnits(quote.amountIn, assetIn.decimals), detail: `Pay · ${assetIn.name}` },
        { asset: assetOut, amount: `≈ ${formatUnits(quote.amountOut, assetOut.decimals)}`, detail: `Receive · ${assetOut.name}` },
      ]} />
      <dl className="review-list confirmation-details">
        <div><dt>Minimum received</dt><dd>{formatUnits(quote.minimumAmountOut, assetOut.decimals)} {assetOut.symbol}</dd></div>
        <div><dt>Fee</dt><dd>{feeLabel}</dd></div>
        {impact !== null && impact >= 1 && <div><dt>Price impact</dt><dd>{impact.toLocaleString(undefined, { maximumFractionDigits: 2 })}%</dd></div>}
      </dl>
    </Modal>}
  </section>;
}
