import { useEffect, useMemo, useState } from "react";
import { ArrowDown, ArrowLeftRight, Settings2, X } from "lucide-react";
import { formatUnits, minimumAmountOut, ownershipKey, parseUnits, quoteExactIn, toHex, type LocusClient, type Ownership, type Pool } from "@archelabs/locus";
import type { AssetView } from "../assets.js";
import { AssetIcon } from "../../components/AssetIcon.js";
import { ActionButton } from "../../components/ActionButton.js";
import { Modal } from "../../components/Modal.js";
import { SelectField } from "../../components/SelectField.js";
import { FieldMessage } from "../../forms/FieldMessage.js";
import { FormField } from "../../forms/FormField.js";
import { normalizeActionError } from "../../errors/normalizeError.js";
import { validatePositiveAmount } from "../../forms/validation.js";
import { parseSlippageBps } from "./swapValidation.js";
import type { ManagedLiquidityScope } from "../liquidity/ManagedLiquidityPanel.js";
import { directPoolForPair } from "../pools/poolQueries.js";

type Submission = "idle" | "awaiting-signature" | "submitted" | "applied" | "failed";
type Quote = { amountIn: bigint; amountOut: bigint; minimumAmountOut: bigint; feeAmount: bigint };

export { parseSlippageBps } from "./swapValidation.js";

function friendlySwapError(cause: unknown): string {
  const normalized = normalizeActionError(cause, "The swap could not be completed.");
  if (normalized.includes("balance is too low")) return "Your balance is too low for this swap.";
  if (normalized.includes("There is not enough liquidity")) return "There is not enough liquidity for this swap.";
  return normalized;
}

function sameScope(current: ((scope: ManagedLiquidityScope) => boolean) | undefined, scope: ManagedLiquidityScope): boolean {
  return current ? current(scope) : true;
}

export function SwapPage({ networkMode, networkId, status, serviceId, locus, assets, pools, poolLoading, poolError, sessionOwner, connectionId, isScopeCurrent, onConnect, onApplied, onNotify, onRefreshAssets, onRefreshPools }: {
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
  isScopeCurrent?: (scope: ManagedLiquidityScope) => boolean;
  onConnect: () => void;
  onApplied: (item: { assetIn: string; assetOut: string; amountIn: string; amountOut: string; transactionId: string; networkId: string }) => void;
  onNotify: (message: string) => void;
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
  const [transactionId, setTransactionId] = useState("");
  const [actionError, setActionError] = useState("");

  useEffect(() => {
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
  }, [assetInId, assetOutId, assets, pools]);

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
  const busy = submission === "awaiting-signature" || submission === "submitted";
  const feeLabel = "0.30%";

  function updatePair(input: string, output: string) {
    setAssetInId(input);
    setAssetOutId(output);
    setAmount("");
    setAmountTouched(false);
    setSubmission("idle");
    setTransactionId("");
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
    const expectedScope: ManagedLiquidityScope = {
      networkId,
      serviceId,
      connectionId,
      ownerKey: toHex(ownershipKey(sessionOwner)).toLowerCase(),
    };
    setReviewOpen(false);
    setSubmission("awaiting-signature");
    setActionError("");
    try {
      const submitted = await locus.swapExactIn(assetIn.assetId, assetOut.assetId, quote.amountIn, quote.minimumAmountOut);
      if (!sameScope(isScopeCurrent, expectedScope)) return;
      setTransactionId(submitted.transactionId);
      setSubmission("submitted");
      const receipt = await locus.waitForAction(submitted.transactionId, { intervalMs: 500, timeoutMs: 180_000 });
      if (!sameScope(isScopeCurrent, expectedScope)) return;
      if (receipt.actionReceipt.status !== "applied") {
        throw new Error(`Swap failed${receipt.actionReceipt.errorCode === null ? "" : ` (error ${receipt.actionReceipt.errorCode})`}`);
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
      if (!sameScope(isScopeCurrent, expectedScope)) return;
      setSubmission("failed");
      setActionError(friendlySwapError(cause));
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
    <div className="page-heading"><div><h1>Swap</h1><p className="muted">Exchange one asset for another.</p></div><button type="button" className="icon-button swap-settings-button" aria-label="Transaction settings" onClick={() => setDetailsOpen((open) => !open)}><Settings2 size={19} /></button></div>
    <div className="card swap-card">
      {poolLoading && <p className="muted">Checking available pairs…</p>}
      {poolError && <div className="inline-alert" role="alert">Available pairs could not be loaded. Try again from the network controls.</div>}
      <FormField label="You pay" htmlFor="swap-amount" error={visibleValidation} errorId="swap-amount-error" className="swap-amount-field">
        <div className="swap-side-label"><span>Balance: {assetIn?.balance === null || !assetIn ? "Unavailable" : formatUnits(assetIn.balance, assetIn.decimals)} {assetIn?.symbol ?? ""}</span></div>
        <div className="swap-token-card swap-token-input">
          {assetIn && <AssetIcon asset={assetIn} size={34} />}
          <SelectField id="swap-token-in" aria-label="Asset to pay" triggerClassName="swap-token-select" value={assetInId} onValueChange={(value) => updatePair(value, assetOutId)} placeholder="Select asset" options={assets.map((asset) => ({ value: asset.assetIdHex, label: `${asset.symbol} · ${asset.name}`, textValue: `${asset.symbol} ${asset.name}` }))} />
          <input id="swap-amount" value={amount} inputMode="decimal" placeholder="0.00" onBlur={() => setAmountTouched(true)} onChange={(event) => { setAmount(event.target.value); setSubmission("idle"); setActionError(""); }} aria-label="Amount to pay" aria-invalid={Boolean(visibleValidation)} aria-describedby={visibleValidation ? "swap-amount-error" : undefined} />
          <button type="button" className="swap-max-button" onClick={useMax} disabled={!assetIn || assetIn.balance === null}>Max</button>
        </div>
      </FormField>

      <button className="swap-direction" type="button" aria-label="Switch assets" onClick={flipPair}><ArrowDown size={18} aria-hidden="true" /></button>

      <div className="swap-side-label"><label htmlFor="swap-token-out">You receive</label><span>{quote && assetOut ? `≈ ${formatUnits(quote.amountOut, assetOut.decimals)} ${assetOut.symbol}` : "Estimated amount"}</span></div>
      <div className="swap-token-card swap-token-output">
        {assetOut && <AssetIcon asset={assetOut} size={34} />}
        <SelectField id="swap-token-out" aria-label="Asset to receive" triggerClassName="swap-token-select" value={assetOutId} onValueChange={(value) => updatePair(assetInId, value)} placeholder="Select asset" options={assets.map((asset) => ({ value: asset.assetIdHex, label: `${asset.symbol} · ${asset.name}`, textValue: `${asset.symbol} ${asset.name}` }))} />
        <strong>{quote && assetOut ? formatUnits(quote.amountOut, assetOut.decimals) : "—"}</strong>
      </div>
      {assetIn && assetOut && assetIn.assetIdHex === assetOut.assetIdHex && <FieldMessage error="Choose two different assets." />}
      {assetIn && assetOut && assetIn.assetIdHex !== assetOut.assetIdHex && !pool && !poolLoading && <FieldMessage>This pair is not available for swapping yet.</FieldMessage>}
      {pool && (!pool.reserve0 || !pool.reserve1) && <p className="form-message">This pair is not available for swapping yet.</p>}

      {quote && assetIn && assetOut && price !== null && <p className="swap-rate">1 {assetIn.symbol} ≈ {price.toLocaleString(undefined, { maximumFractionDigits: 8 })} {assetOut.symbol}</p>}
      {impact !== null && impact >= 5 && <p className="swap-impact-warning" role="status">High price impact: {impact.toLocaleString(undefined, { maximumFractionDigits: 2 })}%</p>}

      <details className="swap-advanced-details" open={detailsOpen} onToggle={(event) => setDetailsOpen(event.currentTarget.open)}>
        <summary>Transaction details</summary>
        <FormField label="Slippage tolerance" htmlFor="swap-slippage" error={slippageInvalid ? "Enter a slippage value from 0.01% to 50%." : null} errorId="swap-slippage-error" className="swap-settings-field">
          <div className="swap-slippage-input"><input id="swap-slippage" inputMode="decimal" value={slippage} onChange={(event) => setSlippage(event.target.value)} aria-invalid={slippageInvalid} aria-describedby={slippageInvalid ? "swap-slippage-error" : undefined} /><span>%</span></div>
        </FormField>
        {quote && assetOut && <dl className="swap-quote-details">
          {price !== null && assetIn && <div><dt>Rate</dt><dd>1 {assetIn.symbol} ≈ {price.toLocaleString(undefined, { maximumFractionDigits: 8 })} {assetOut.symbol}</dd></div>}
          <div><dt>Minimum received</dt><dd>{formatUnits(quote.minimumAmountOut, assetOut.decimals)} {assetOut.symbol}</dd></div>
          <div><dt>Fee</dt><dd>{feeLabel}</dd></div>
          {impact !== null && <div><dt>Price impact</dt><dd>{impact.toLocaleString(undefined, { maximumFractionDigits: 2 })}%</dd></div>}
        </dl>}
      </details>

      {actionError && <p className="action-status action-status--error" role="alert">{actionError}</p>}
      <ActionButton className="swap-review-action" variant="primary" icon={ArrowLeftRight} fullWidth disabled={busy || status !== "ready" || !quote || !assetIn || !assetOut || Boolean(validation) || submission === "applied"} onClick={openReview}>
        {submission === "awaiting-signature" ? "Approve in wallet…" : submission === "submitted" ? "Waiting for confirmation…" : submission === "applied" ? "Swap completed" : sessionOwner ? "Review swap" : "Connect to swap"}
      </ActionButton>
      {transactionId && <div className="receipt"><strong>{submission === "applied" ? "Swap applied" : "Swap submitted · waiting for confirmation"}</strong><code>{transactionId}</code></div>}
      {submission === "failed" && <p className="action-status action-status--error" role="alert">{actionError || "The swap could not be completed."}</p>}
      <p className="notice">Quotes use on-chain pool reserves and a single direct pair. No market oracle is used.</p>
    </div>

    {reviewOpen && quote && assetIn && assetOut && <Modal open title="Review swap" onClose={() => setReviewOpen(false)} footer={<><ActionButton variant="secondary" icon={X} onClick={() => setReviewOpen(false)}>Cancel</ActionButton><ActionButton variant="primary" icon={ArrowLeftRight} disabled={busy} onClick={() => void confirmSwap()}>Swap</ActionButton></>}>
      <p className="modal-lead">Check the amounts before signing.</p>
      <dl className="review-list">
        <div><dt>You pay</dt><dd>{formatUnits(quote.amountIn, assetIn.decimals)} {assetIn.symbol}</dd></div>
        <div><dt>You receive</dt><dd>≈ {formatUnits(quote.amountOut, assetOut.decimals)} {assetOut.symbol}</dd></div>
        <div><dt>Minimum received</dt><dd>{formatUnits(quote.minimumAmountOut, assetOut.decimals)} {assetOut.symbol}</dd></div>
        <div><dt>Fee</dt><dd>{feeLabel}</dd></div>
        {impact !== null && impact >= 1 && <div><dt>Price impact</dt><dd>{impact.toLocaleString(undefined, { maximumFractionDigits: 2 })}%</dd></div>}
      </dl>
    </Modal>}
  </section>;
}
