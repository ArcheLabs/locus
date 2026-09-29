import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { ArrowDown, ArrowDownUp, ArrowLeft, Droplets, Plus, RefreshCw, X } from "lucide-react";
import { formatLiquiditySharePercentage, formatLocusId, formatUnits, minimumLiquidityAmount, ownershipKey, parseUnits, quoteAddLiquidity as calculateAddLiquidity, quoteInitialLiquidity, toHex, type LocusClient, type LiquidityPosition, type Ownership, type Pool } from "@archelabs/locus";
import type { AssetView } from "../assets.js";
import { AssetIdentity, AssetSelector } from "../../components/AssetSelector.js";
import { AssetAmountInput } from "../../components/AssetAmountInput.js";
import { ActionButton } from "../../components/ActionButton.js";
import { Modal } from "../../components/Modal.js";
import { normalizeActionError } from "../../errors/normalizeError.js";
import { poolPriceDisplay, proportionalAmount } from "./liquidityMath.js";
import type { PermissionlessLiquidityConfig } from "./liquidityConfig.js";
import type { LiquidityScope } from "./liquidityTypes.js";
import "./permissionlessLiquidity.css";

type Operation = "create" | "initialize" | "add" | "remove";
type PendingAction = { transactionId: string; action: string; networkId: string; serviceId: number; ownerKey: string; createdAt: number };
type PairPoolState = { key: string; pool: Pool | null; loading: boolean; error: string };
const SLIPPAGE_BPS = 50;

function pendingStorageKey(scope: LiquidityScope): string {
  return `locus.liquidity.pending.v2.${scope.networkId}.${scope.serviceId ?? 0}.${scope.ownerKey ?? "disconnected"}`;
}

function readPending(key: string): PendingAction | null {
  try {
    const value: unknown = JSON.parse(window.localStorage.getItem(key) ?? "null");
    if (!value || typeof value !== "object") return null;
    const row = value as Record<string, unknown>;
    if (typeof row.transactionId !== "string" || typeof row.action !== "string" || typeof row.networkId !== "string"
      || typeof row.serviceId !== "number" || typeof row.ownerKey !== "string" || typeof row.createdAt !== "number") return null;
    return row as PendingAction;
  } catch { return null; }
}

function operationLabel(operation: Operation): string {
  if (operation === "create") return "Create pool";
  if (operation === "initialize") return "Initialize liquidity";
  if (operation === "remove") return "Remove liquidity";
  return "Add liquidity";
}

function friendlyError(cause: unknown): string {
  const normalized = normalizeActionError(cause, "The liquidity action could not be completed.");
  if (/error 6002|POOL_ALREADY_EXISTS/i.test(normalized)) return "This pool was created while you were reviewing it. The latest pool state is being loaded.";
  if (/error 3002|INSUFFICIENT_BALANCE/i.test(normalized)) return "Your balance is too low for these amounts.";
  if (/error 6011|LIQUIDITY_SLIPPAGE_EXCEEDED/i.test(normalized)) return "Pool state changed beyond your slippage tolerance. Review the updated quote.";
  if (/error 6010|INSUFFICIENT_LIQUIDITY_SHARES/i.test(normalized)) return "You do not have enough liquidity shares for this withdrawal.";
  if (/error 6008|POOL_RESERVE_LIMIT/i.test(normalized)) return "This deposit exceeds the pool reserve limit.";
  return normalized;
}

export function LiquidityPage({ view, initialTab, initialPair, config, assets, pools, poolsError, poolsLoading, locus, networkId, serviceId, sessionOwner, connectionId, networkReady, isScopeCurrent, onPoolsRefreshed, onRefreshAssets, onConnect, onNewPosition, onTabChange, onActionSuccess, onRetryPools, getBalanceState }: {
  view: "home" | "new";
  initialTab: "pools" | "positions";
  initialPair: { assetA: string; assetB: string };
  config: PermissionlessLiquidityConfig | null;
  assets: AssetView[];
  pools: Pool[];
  poolsError: string;
  poolsLoading: boolean;
  locus: LocusClient | null;
  networkId: string;
  serviceId: number | null;
  sessionOwner: Ownership | null;
  connectionId: string | null;
  networkReady: boolean;
  isScopeCurrent: (scope: LiquidityScope) => boolean;
  onPoolsRefreshed: (pools: Pool[]) => void;
  onRefreshAssets: () => Promise<unknown>;
  onConnect: () => void;
  onNewPosition: (assetA?: string, assetB?: string) => void;
  onTabChange: (tab: "pools" | "positions") => void;
  onActionSuccess: (message: string) => void;
  onRetryPools: () => void;
  getBalanceState: (asset: AssetView) => "known" | "loading" | "unavailable";
}) {
  const [assetAId, setAssetAId] = useState("");
  const [assetBId, setAssetBId] = useState("");
  const [tab, setTab] = useState(initialTab);
  const [amountA, setAmountA] = useState("");
  const [amountB, setAmountB] = useState("");
  const [withdrawPercent, setWithdrawPercent] = useState(50);
  const [customWithdraw, setCustomWithdraw] = useState(false);
  const [positions, setPositions] = useState<LiquidityPosition[]>([]);
  const [positionsLoading, setPositionsLoading] = useState(false);
  const [positionsError, setPositionsError] = useState("");
  const [positionsRefreshRevision, setPositionsRefreshRevision] = useState(0);
  const [positionIndexCount, setPositionIndexCount] = useState(0n);
  const [positionCursor, setPositionCursor] = useState(0n);
  const [positionsPageLoading, setPositionsPageLoading] = useState(false);
  const [positionsPageError, setPositionsPageError] = useState("");
  const [review, setReview] = useState<{ operation: Operation; position?: LiquidityPosition } | null>(null);
  const [busy, setBusy] = useState(false);
  const [transactionId, setTransactionId] = useState("");
  const [transactionOutcome, setTransactionOutcome] = useState<"pending" | "applied" | "failed" | null>(null);
  const [actionMessage, setActionMessage] = useState("");
  const [error, setError] = useState("");
  const [pending, setPending] = useState<PendingAction | null>(null);
  const [pairPoolState, setPairPoolState] = useState<PairPoolState | null>(null);
  const [pairRefreshRevision, setPairRefreshRevision] = useState(0);
  const [additionalPools, setAdditionalPools] = useState<Pool[]>([]);
  const [hasMorePools, setHasMorePools] = useState(false);
  const [poolsPageLoading, setPoolsPageLoading] = useState(false);
  const [poolsPageError, setPoolsPageError] = useState("");

  const ownerKey = sessionOwner ? toHex(ownershipKey(sessionOwner)).toLowerCase() : null;
  const scope = useMemo<LiquidityScope>(() => ({ networkId, serviceId, connectionId, ownerKey }), [connectionId, networkId, ownerKey, serviceId]);
  const storageKey = pendingStorageKey(scope);
  const pendingScopeReady = networkReady && sessionOwner !== null && serviceId !== null;
  const selectedA = assets.find((asset) => asset.assetIdHex === assetAId) ?? null;
  const selectedB = assets.find((asset) => asset.assetIdHex === assetBId) ?? null;
  const pairKey = selectedA && selectedB ? `${selectedA.assetIdHex}:${selectedB.assetIdHex}` : "";
  const selectedPoolLoading = !!pairKey && (pairPoolState?.key !== pairKey || pairPoolState.loading);
  const selectedPoolError = pairPoolState?.key === pairKey ? pairPoolState.error : "";
  const selectedPool = pairPoolState?.key === pairKey ? pairPoolState.pool : null;
  const exploredPools = useMemo(() => {
    const byKey = new Map<string, Pool>();
    for (const pool of [...pools, ...additionalPools]) byKey.set(`${toHex(pool.asset0).toLowerCase()}:${toHex(pool.asset1).toLowerCase()}`, pool);
    return [...byKey.values()];
  }, [additionalPools, pools]);
  const poolEmpty = !!selectedPool && selectedPool.totalShares === 0n;
  const operation: Operation = !selectedPool ? "create" : poolEmpty ? "initialize" : "add";
  const busyOrPending = busy || !!pending;
  const removalPosition = review?.operation === "remove" ? review.position ?? null : null;
  const isScopeCurrentRef = useRef(isScopeCurrent);
  isScopeCurrentRef.current = isScopeCurrent;
  const selectedAmounts = selectedA && selectedB ? (() => {
    try { return [parseUnits(amountA, selectedA.decimals), parseUnits(amountB, selectedB.decimals)] as const; } catch { return null; }
  })() : null;
  const liquidityQuote = selectedAmounts && !selectedPoolLoading && !selectedPoolError ? (() => {
    try {
      const [rawA, rawB] = selectedAmounts;
      if (!selectedPool || selectedPool.totalShares === 0n) return quoteInitialLiquidity(rawA, rawB);
      const aIs0 = toHex(selectedA!.assetId).toLowerCase() === toHex(selectedPool.asset0).toLowerCase();
      return calculateAddLiquidity(selectedPool.reserve0, selectedPool.reserve1, selectedPool.totalShares, aIs0 ? rawA : rawB, aIs0 ? rawB : rawA);
    } catch { return null; }
  })() : null;
  const ownSharesBeforeAdd = selectedPool
    ? positions.find((position) => toHex(position.pool.asset0).toLowerCase() === toHex(selectedPool.asset0).toLowerCase()
      && toHex(position.pool.asset1).toLowerCase() === toHex(selectedPool.asset1).toLowerCase())?.shares ?? 0n
    : 0n;
  const sharesAfterAdd = liquidityQuote ? ownSharesBeforeAdd + liquidityQuote.sharesMinted : 0n;
  const totalSharesAfterAdd = (selectedPool?.totalShares ?? 0n) + (liquidityQuote?.sharesMinted ?? 0n);
  const selectedAIsPoolAsset0 = !!selectedPool && !!selectedA
    && toHex(selectedA.assetId).toLowerCase() === toHex(selectedPool.asset0).toLowerCase();
  const quoteUsedA = liquidityQuote
    ? selectedPool && !poolEmpty ? (selectedAIsPoolAsset0 ? liquidityQuote.amount0Used : liquidityQuote.amount1Used) : liquidityQuote.amount0Used
    : 0n;
  const quoteUsedB = liquidityQuote
    ? selectedPool && !poolEmpty ? (selectedAIsPoolAsset0 ? liquidityQuote.amount1Used : liquidityQuote.amount0Used) : liquidityQuote.amount1Used
    : 0n;
  const initialPrice = selectedAmounts && selectedA && selectedB && selectedAmounts[0] > 0n && selectedAmounts[1] > 0n
    ? poolPriceDisplay(selectedAmounts[0], selectedAmounts[1], selectedA.decimals, selectedB.decimals)
    : "—";

  useEffect(() => {
    setTab(initialTab);
  }, [initialTab]);

  useEffect(() => {
    if (view !== "new" || !initialPair.assetA || !initialPair.assetB || !assets.length) return;
    const assetA = assets.find((asset) => asset.assetIdHex.toLowerCase() === initialPair.assetA.toLowerCase());
    const assetB = assets.find((asset) => asset.assetIdHex.toLowerCase() === initialPair.assetB.toLowerCase());
    if (assetA && assetB && assetA.assetIdHex !== assetB.assetIdHex && (assetAId !== assetA.assetIdHex || assetBId !== assetB.assetIdHex)) {
      setPair(assetA.assetIdHex, assetB.assetIdHex);
    }
  }, [assetAId, assetBId, assets, initialPair.assetA, initialPair.assetB, view]);

  useEffect(() => {
    setPending(pendingScopeReady ? readPending(storageKey) : null);
    setTransactionId("");
    setTransactionOutcome(null);
  }, [pendingScopeReady, storageKey]);

  useEffect(() => {
    setAdditionalPools([]);
    setHasMorePools(pools.length === 50);
    setPoolsPageError("");
  }, [locus, networkId, pools, serviceId]);

  useEffect(() => {
    if (!locus || !sessionOwner || !networkReady) {
      setPositions([]); setPositionIndexCount(0n); setPositionCursor(0n); setPositionsLoading(false); setPositionsError(""); return;
    }
    let cancelled = false;
    setPositionsLoading(true);
    setPositionsError("");
    setPositionsPageError("");
    void Promise.all([
      locus.liquidityPositionCount(sessionOwner),
      locus.listLiquidityPositions(sessionOwner, { offset: 0n, limit: 50 }),
    ]).then(([count, next]) => {
      if (!cancelled && isScopeCurrentRef.current(scope)) {
        setPositionIndexCount(count); setPositionCursor(count > 50n ? 50n : count); setPositions(next);
      }
    }).catch(() => {
      if (!cancelled && isScopeCurrentRef.current(scope)) { setPositions([]); setPositionIndexCount(0n); setPositionCursor(0n); setPositionsError("Your positions could not be loaded. Try again when the Service is available."); }
    }).finally(() => { if (!cancelled && isScopeCurrentRef.current(scope)) setPositionsLoading(false); });
    return () => { cancelled = true; };
  }, [locus, networkReady, scope, sessionOwner, pools, positionsRefreshRevision]);

  useEffect(() => {
    if (!selectedA || !selectedB || selectedA.assetIdHex === selectedB.assetIdHex || !locus || !networkReady) {
      setPairPoolState(null);
      return;
    }
    const requestKey = `${selectedA.assetIdHex}:${selectedB.assetIdHex}`;
    let cancelled = false;
    setPairPoolState({ key: requestKey, pool: null, loading: true, error: "" });
    void locus.getPool(selectedA.assetId, selectedB.assetId).then((pool) => {
      if (!cancelled && isScopeCurrentRef.current(scope)) setPairPoolState({ key: requestKey, pool, loading: false, error: "" });
    }).catch(() => {
      if (!cancelled && isScopeCurrentRef.current(scope)) setPairPoolState({ key: requestKey, pool: null, loading: false, error: "This pair's pool state could not be loaded. Retry before submitting." });
    });
    return () => { cancelled = true; };
  }, [assetAId, assetBId, locus, networkReady, pairRefreshRevision, scope]);

  function setPair(a: string, b: string) {
    setAssetAId(a); setAssetBId(b); setAmountA(""); setAmountB(""); setError("");
  }

  function chooseFeatured(assetA: string, assetB: string) {
    const a = assets.find((asset) => asset.catalogKey === assetA);
    const b = assets.find((asset) => asset.catalogKey === assetB);
    if (a && b) onNewPosition(a.assetIdHex, b.assetIdHex);
  }

  function updateAmountA(value: string) {
    setAmountA(value);
    if (!selectedPool || poolEmpty || !selectedA || !selectedB) { setAmountB(""); return; }
    try {
      const rawA = parseUnits(value, selectedA.decimals);
      const aIs0 = toHex(selectedA.assetId).toLowerCase() === toHex(selectedPool.asset0).toLowerCase();
      const reserveA = aIs0 ? selectedPool.reserve0 : selectedPool.reserve1;
      const reserveB = aIs0 ? selectedPool.reserve1 : selectedPool.reserve0;
      setAmountB(value.trim() ? formatUnits(proportionalAmount(rawA, reserveA, reserveB), selectedB.decimals) : "");
    } catch { setAmountB(""); }
  }

  function updateAmountB(value: string) {
    setAmountB(value);
    if (!selectedPool || poolEmpty || !selectedA || !selectedB) { setAmountA(""); return; }
    try {
      const rawB = parseUnits(value, selectedB.decimals);
      const aIs0 = toHex(selectedA.assetId).toLowerCase() === toHex(selectedPool.asset0).toLowerCase();
      const reserveA = aIs0 ? selectedPool.reserve0 : selectedPool.reserve1;
      const reserveB = aIs0 ? selectedPool.reserve1 : selectedPool.reserve0;
      setAmountA(value.trim() ? formatUnits(proportionalAmount(rawB, reserveB, reserveA), selectedA.decimals) : "");
    } catch { setAmountA(""); }
  }

  function submitPreview() {
    if (!selectedA || !selectedB || selectedA.assetIdHex === selectedB.assetIdHex) { setError("Choose two different assets."); return; }
    if (selectedPoolLoading || selectedPoolError) { setError(selectedPoolError || "Pool state is still loading."); return; }
    try {
      const a = parseUnits(amountA, selectedA.decimals);
      const b = parseUnits(amountB, selectedB.decimals);
      if (a <= 0n || b <= 0n) throw new Error("Both amounts must be greater than zero.");
      if (selectedA.balance === null || selectedB.balance === null) throw new Error("Balances are still loading.");
      if (a > selectedA.balance || b > selectedB.balance) throw new Error("One or both amounts exceed your balance.");
      if (!liquidityQuote) throw new Error("These amounts are too large, too small, or outside the pool reserve limit.");
      setError(""); setReview({ operation });
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Enter valid amounts."); }
  }

  async function refreshAfterApplied(expectedScope: LiquidityScope) {
    if (!locus || !isScopeCurrent(expectedScope)) return;
    const [nextPools, nextPositions, nextPositionCount] = await Promise.all([
      locus.listPools(),
      sessionOwner ? locus.listLiquidityPositions(sessionOwner, { offset: 0n, limit: 50 }) : Promise.resolve([]),
      sessionOwner ? locus.liquidityPositionCount(sessionOwner) : Promise.resolve(0n),
    ]);
    if (!isScopeCurrent(expectedScope)) return;
    onPoolsRefreshed(nextPools); setPositions(nextPositions); setPositionIndexCount(nextPositionCount);
    setPositionCursor(nextPositionCount > 50n ? 50n : nextPositionCount); await onRefreshAssets();
  }

  async function loadMorePositions() {
    if (!locus || !sessionOwner || positionsPageLoading || positionCursor >= positionIndexCount || !isScopeCurrent(scope)) return;
    setPositionsPageLoading(true); setPositionsPageError("");
    const expectedScope = scope;
    const offset = positionCursor;
    try {
      const next = await locus.listLiquidityPositions(sessionOwner, { offset, limit: 50 });
      if (!isScopeCurrent(expectedScope)) return;
      setPositions((current) => {
        const byPair = new Map(current.map((position) => [`${toHex(position.pool.asset0)}:${toHex(position.pool.asset1)}`, position]));
        for (const position of next) byPair.set(`${toHex(position.pool.asset0)}:${toHex(position.pool.asset1)}`, position);
        return [...byPair.values()];
      });
      const nextOffset = offset + 50n;
      setPositionCursor(nextOffset < positionIndexCount ? nextOffset : positionIndexCount);
    } catch {
      if (isScopeCurrent(expectedScope)) setPositionsPageError("More positions could not be loaded. Try again.");
    } finally {
      if (isScopeCurrent(expectedScope)) setPositionsPageLoading(false);
    }
  }

  function clearFinalizedFailure(id: string, status: string, errorCode: number | null) {
    window.localStorage.removeItem(storageKey);
    setPending(null);
    setTransactionId(id);
    setTransactionOutcome("failed");
    setActionMessage("");
    setError(`Transaction finalized as ${status}${errorCode === null ? "" : ` (error ${errorCode})`}. The liquidity action was not applied; review the current state before trying again.`);
    setPairRefreshRevision((revision) => revision + 1);
  }

  async function loadMorePools() {
    if (!locus || poolsPageLoading || !hasMorePools || !isScopeCurrent(scope)) return;
    setPoolsPageLoading(true); setPoolsPageError("");
    const expectedScope = scope;
    try {
      const nextPage = await locus.listPools({ offset: BigInt(pools.length + additionalPools.length), limit: 50 });
      if (!isScopeCurrent(expectedScope)) return;
      setAdditionalPools((current) => [...current, ...nextPage]);
      setHasMorePools(nextPage.length === 50);
    } catch {
      if (isScopeCurrent(expectedScope)) setPoolsPageError("More pools could not be loaded. Try again.");
    } finally {
      if (isScopeCurrent(expectedScope)) setPoolsPageLoading(false);
    }
  }

  async function waitForPending(current: PendingAction, expectedScope = scope) {
    if (!locus || busy || !isScopeCurrent(expectedScope)) return;
    setBusy(true); setError(""); setActionMessage("Checking the saved transaction. No new action will be submitted.");
    try {
      const receipt = await locus.waitForAction(current.transactionId, { intervalMs: 750, timeoutMs: 180_000 });
      if (!isScopeCurrent(expectedScope)) return;
      if (receipt.actionReceipt.status !== "applied") {
        clearFinalizedFailure(current.transactionId, receipt.actionReceipt.status, receipt.actionReceipt.errorCode);
        return;
      }
      window.localStorage.removeItem(storageKey); setPending(null); setTransactionOutcome("applied"); setActionMessage("Liquidity action confirmed.");
      await refreshAfterApplied(expectedScope);
      setPairRefreshRevision((revision) => revision + 1);
      if (current.action !== "Remove liquidity") onActionSuccess(current.action === "Create pool" ? "Pool created" : "Liquidity added");
    } catch (cause) {
      if (!isScopeCurrent(expectedScope)) return;
      setError(`${friendlyError(cause)} The transaction remains saved; check its status before signing anything else.`);
    } finally { if (isScopeCurrent(expectedScope)) setBusy(false); }
  }

  async function confirmAction() {
    if (!locus || !sessionOwner || !selectedA || !selectedB || !review || busyOrPending || !isScopeCurrent(scope)) return;
    setBusy(true); setError(""); setActionMessage("");
    const expectedScope = scope;
    let submittedId = "";
    try {
      const currentPool = await locus.getPool(selectedA.assetId, selectedB.assetId);
      if (!isScopeCurrent(expectedScope)) return;
      if (review.operation === "create" && currentPool) throw new Error("This pool was created while you were reviewing. Refresh and review the pair again.");
      if (review.operation !== "create" && !currentPool) throw new Error("This pool is no longer available. Refresh and review the pair again.");
      const rawA = parseUnits(amountA, selectedA.decimals);
      const rawB = parseUnits(amountB, selectedB.decimals);
      const balanceA = await locus.balanceOf(selectedA.assetId, sessionOwner);
      const balanceB = await locus.balanceOf(selectedB.assetId, sessionOwner);
      if (rawA > balanceA || rawB > balanceB) throw new Error("Your balance changed and is no longer sufficient for these amounts.");
      if (!isScopeCurrent(expectedScope)) return;
      let submitted;
      if (review.operation === "create") {
        submitted = await locus.createPool(selectedA.assetId, selectedB.assetId, rawA, rawB);
      } else {
        // Add is quoted against the just-read finalized pool so the unused maximum remains in the wallet.
        const quote = await locus.quoteAddLiquidity(selectedA.assetId, selectedB.assetId, rawA, rawB);
        const aIs0 = toHex(selectedA.assetId).toLowerCase() === toHex(currentPool!.asset0).toLowerCase();
        const usedA = aIs0 ? quote.amount0Used : quote.amount1Used;
        const usedB = aIs0 ? quote.amount1Used : quote.amount0Used;
        if (usedA > balanceA || usedB > balanceB) throw new Error("Your balance is no longer sufficient for the quoted deposit.");
        submitted = await locus.addPoolLiquidity(selectedA.assetId, selectedB.assetId, rawA, rawB, minimumLiquidityAmount(quote.sharesMinted, SLIPPAGE_BPS));
      }
      submittedId = submitted.transactionId;
      const saved: PendingAction = { transactionId: submittedId, action: operationLabel(review.operation), networkId, serviceId: serviceId!, ownerKey: ownerKey!, createdAt: Date.now() };
      window.localStorage.setItem(storageKey, JSON.stringify(saved)); setPending(saved); setTransactionId(submittedId); setTransactionOutcome("pending"); setReview(null);
      const receipt = await locus.waitForAction(submittedId, { intervalMs: 750, timeoutMs: 180_000 });
      if (!isScopeCurrent(expectedScope)) return;
      if (receipt.actionReceipt.status !== "applied") {
        clearFinalizedFailure(submittedId, receipt.actionReceipt.status, receipt.actionReceipt.errorCode);
        return;
      }
      window.localStorage.removeItem(storageKey); setPending(null); setTransactionOutcome("applied"); setActionMessage("Liquidity action confirmed."); setAmountA(""); setAmountB("");
      await refreshAfterApplied(expectedScope);
      setPairRefreshRevision((revision) => revision + 1);
      onActionSuccess(review.operation === "create" ? "Pool created" : "Liquidity added");
    } catch (cause) {
      if (!isScopeCurrent(expectedScope)) return;
      if (!submittedId && /error 6002|POOL_ALREADY_EXISTS/i.test(normalizeActionError(cause, ""))) {
        setPairRefreshRevision((revision) => revision + 1);
      }
      setError(submittedId
        ? `${friendlyError(cause)} Transaction ${submittedId} is saved. Check its status before signing anything again.`
        : `${friendlyError(cause)} No transaction ID was received; the action was not confirmed as submitted.`);
    } finally { if (isScopeCurrent(expectedScope)) setBusy(false); }
  }

  async function requestRemoval(position: LiquidityPosition, percentage: number) {
    if (!sessionOwner || !locus || busyOrPending || !isScopeCurrent(scope)) return;
    setWithdrawPercent(percentage);
    setCustomWithdraw(false);
    setReview({ operation: "remove", position });
  }

  function requestCustomRemoval(position: LiquidityPosition) {
    if (!sessionOwner || !locus || busyOrPending || !isScopeCurrent(scope)) return;
    setWithdrawPercent(50);
    setCustomWithdraw(true);
    setReview({ operation: "remove", position });
  }

  async function confirmRemoval(position: LiquidityPosition) {
    if (!locus || !sessionOwner || !review || busyOrPending || !isScopeCurrent(scope)) return;
    if (!Number.isInteger(withdrawPercent) || withdrawPercent < 1 || withdrawPercent > 100) { setError("Choose a whole percentage from 1 to 100."); return; }
    const shares = withdrawPercent === 100 ? position.shares : position.shares * BigInt(withdrawPercent) / 100n;
    if (shares === 0n) { setError("This share amount is too small to withdraw."); return; }
    setBusy(true); setError(""); let submittedId = ""; const expectedScope = scope;
    try {
      const quote = await locus.quoteRemoveLiquidity(position.pool.asset0, position.pool.asset1, sessionOwner, shares);
      if (!isScopeCurrent(expectedScope)) return;
      const min0 = minimumLiquidityAmount(quote.amount0, SLIPPAGE_BPS);
      const min1 = minimumLiquidityAmount(quote.amount1, SLIPPAGE_BPS);
      const submitted = await locus.removePoolLiquidity(position.pool.asset0, position.pool.asset1, shares, min0, min1);
      submittedId = submitted.transactionId;
      const saved: PendingAction = { transactionId: submittedId, action: "Remove liquidity", networkId, serviceId: serviceId!, ownerKey: ownerKey!, createdAt: Date.now() };
      window.localStorage.setItem(storageKey, JSON.stringify(saved)); setPending(saved); setTransactionId(submittedId); setTransactionOutcome("pending"); setReview(null);
      const receipt = await locus.waitForAction(submittedId, { intervalMs: 750, timeoutMs: 180_000 });
      if (!isScopeCurrent(expectedScope)) return;
      if (receipt.actionReceipt.status !== "applied") {
        clearFinalizedFailure(submittedId, receipt.actionReceipt.status, receipt.actionReceipt.errorCode);
        return;
      }
      window.localStorage.removeItem(storageKey); setPending(null); setTransactionOutcome("applied"); setActionMessage("Liquidity action confirmed.");
      await refreshAfterApplied(expectedScope);
      setPairRefreshRevision((revision) => revision + 1);
    } catch (cause) {
      if (!isScopeCurrent(expectedScope)) return;
      if (!submittedId && /error 6002|POOL_ALREADY_EXISTS/i.test(normalizeActionError(cause, ""))) {
        setPairRefreshRevision((revision) => revision + 1);
      }
      setError(submittedId ? `${friendlyError(cause)} Transaction ${submittedId} is saved. Check its status before signing anything again.` : friendlyError(cause));
    } finally { if (isScopeCurrent(expectedScope)) setBusy(false); }
  }

  const removalQuote = review?.operation === "remove" && review.position && sessionOwner
    ? (() => {
      const shares = withdrawPercent === 100 ? review.position.shares : review.position.shares * BigInt(withdrawPercent) / 100n;
      const last = shares === review.position.pool.totalShares;
      return {
        shares,
        amount0: last ? review.position.pool.reserve0 : review.position.pool.reserve0 * shares / review.position.pool.totalShares,
        amount1: last ? review.position.pool.reserve1 : review.position.pool.reserve1 * shares / review.position.pool.totalShares,
      };
    })() : null;

  const insufficientAsset = selectedAmounts && selectedA && selectedB
    ? selectedA.balance !== null && selectedAmounts[0] > selectedA.balance ? selectedA
      : selectedB.balance !== null && selectedAmounts[1] > selectedB.balance ? selectedB
        : null
    : null;
  const validAmounts = !!selectedAmounts && selectedAmounts.every((value) => value > 0n);
  const balanceLabel = (asset: AssetView) => getBalanceState(asset) === "loading" ? "Loading…"
    : getBalanceState(asset) === "unavailable" ? "Unavailable"
      : formatUnits(asset.balance ?? 0n, asset.decimals);
  const ctaLabel = !sessionOwner ? "Connect Ownership"
    : !selectedA || !selectedB ? "Select assets"
      : selectedA.assetIdHex === selectedB.assetIdHex ? "Choose different assets"
        : !networkReady ? "Service unavailable"
          : selectedPoolLoading ? "Checking pool…"
            : selectedPoolError ? "Pool state unavailable"
              : busy ? (operation === "create" ? "Creating pool…" : "Adding liquidity…")
                : pending ? "Transaction pending…"
                  : selectedA.balance === null || selectedB.balance === null ? [selectedA, selectedB].some(asset => getBalanceState(asset) === "loading") ? "Loading balances…" : "Balance unavailable"
                    : insufficientAsset ? `Insufficient ${insufficientAsset.symbol}`
                      : !validAmounts ? "Enter an amount"
                        : !liquidityQuote ? "Amount outside pool limits"
                          : "Provide liquidity";
  const ctaDisabled = sessionOwner
    ? !networkReady || !selectedA || !selectedB || selectedA.assetIdHex === selectedB.assetIdHex || selectedPoolLoading || !!selectedPoolError
      || busyOrPending || selectedA.balance === null || selectedB.balance === null || !validAmounts || !!insufficientAsset || !liquidityQuote
    : false;

  function handleTabKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const keys = ["ArrowLeft", "ArrowRight", "Home", "End"];
    if (!keys.includes(event.key)) return;
    event.preventDefault();
    const nextTab = event.key === "Home" ? "pools" : event.key === "End" ? "positions"
      : event.key === "ArrowRight" ? (tab === "pools" ? "positions" : "pools")
        : (tab === "pools" ? "positions" : "pools");
    setTab(nextTab);
    onTabChange(nextTab);
    document.getElementById(`liquidity-tab-${nextTab}`)?.focus();
  }

  function updateTab(next: "pools" | "positions") {
    setTab(next);
    onTabChange(next);
  }

  function retryPositions() {
    setPositionsError("");
    setPositionsRefreshRevision((revision) => revision + 1);
  }

  function pairPrice(assetA: AssetView, assetB: AssetView, pool: Pool): string {
    const aIs0 = assetA.assetIdHex === toHex(pool.asset0).toLowerCase();
    return poolPriceDisplay(aIs0 ? pool.reserve0 : pool.reserve1, aIs0 ? pool.reserve1 : pool.reserve0, assetA.decimals, assetB.decimals);
  }

  return <section className={`page liquidity-page${view === "new" ? " liquidity-page--new" : ""}`}>
    {view === "home" ? <>
      <div className="liquidity-toolbar">
        <div className="liquidity-tabs" role="tablist" aria-label="Liquidity views" onKeyDown={handleTabKeyDown}>
          <button id="liquidity-tab-pools" type="button" role="tab" aria-selected={tab === "pools"} aria-controls="liquidity-panel-pools" tabIndex={tab === "pools" ? 0 : -1} className={tab === "pools" ? "active" : ""} onClick={() => updateTab("pools")}>Pools</button>
          <button id="liquidity-tab-positions" type="button" role="tab" aria-selected={tab === "positions"} aria-controls="liquidity-panel-positions" tabIndex={tab === "positions" ? 0 : -1} className={tab === "positions" ? "active" : ""} onClick={() => updateTab("positions")}>My positions</button>
        </div>
        <ActionButton variant="primary" icon={Plus} onClick={() => onNewPosition()}>New position</ActionButton>
      </div>
      <div className="liquidity-status-messages">
        {error && <div className="inline-alert permissionless-liquidity-error" role="alert">{error}</div>}
        {actionMessage && <div className="inline-alert" role="status">{actionMessage}</div>}
        {transactionId && <div className="liquidity-tx-receipt"><strong>{transactionOutcome === "failed" ? "Liquidity action was not applied" : pending || transactionOutcome === "pending" ? `${pending?.action ?? "Liquidity action"} · transaction pending` : "Liquidity action confirmed"}</strong><code>{transactionId}</code></div>}
        {pending && <div className="inline-alert"><div><strong>{pending.action} is still being checked.</strong><p>Its transaction ID is saved for this network and Ownership. Do not sign another liquidity action until its status is known.</p></div><ActionButton size="small" variant="secondary" icon={RefreshCw} loading={busy} onClick={() => void waitForPending(pending)}>Check transaction status</ActionButton></div>}
      </div>
      <section id={`liquidity-panel-${tab}`} className="liquidity-tab-panel" role="tabpanel" aria-labelledby={`liquidity-tab-${tab}`}>
        {tab === "pools" ? <>
          <section className="liquidity-featured">
            <div className="liquidity-section-heading"><div><h2>Featured pairs</h2><p>Choose a pair to provide liquidity.</p></div></div>
            {config?.featuredPairs.length ? <div className="liquidity-featured-pairs">{config.featuredPairs.map((pair) => <button type="button" key={`${pair.assetA}/${pair.assetB}`} onClick={() => chooseFeatured(pair.assetA, pair.assetB)}>{pair.assetA.toUpperCase()} / {pair.assetB.toUpperCase()}<ArrowDown size={14} aria-hidden="true" /></button>)}</div> : <p className="muted">Featured pairs are unavailable. You can still choose any two assets.</p>}
          </section>
          <section className="liquidity-section liquidity-pools-list">
            <div className="liquidity-section-heading"><div><h2>Pools</h2></div></div>
            {!networkReady && !poolsLoading && exploredPools.length === 0 && <p className="muted">Waiting for the Service connection…</p>}
            {poolsLoading && exploredPools.length === 0 && <div className="liquidity-query-skeleton" aria-busy="true" aria-label="Loading pools"><span /><span /></div>}
            {!poolsLoading && poolsError && exploredPools.length === 0 && <div className="liquidity-query-error" role="alert"><p>Pool information is unavailable right now.</p><ActionButton size="small" variant="secondary" icon={RefreshCw} onClick={onRetryPools}>Try again</ActionButton></div>}
            {networkReady && !poolsLoading && !poolsError && exploredPools.length === 0 && <div className="liquidity-compact-empty"><div><strong>No liquidity pools yet.</strong><p>Provide liquidity to create the first pool.</p></div><ActionButton size="small" variant="secondary" icon={Plus} onClick={() => onNewPosition()}>New position</ActionButton></div>}
            {exploredPools.map((pool) => {
              const asset0 = assets.find((asset) => asset.assetIdHex === toHex(pool.asset0).toLowerCase());
              const asset1 = assets.find((asset) => asset.assetIdHex === toHex(pool.asset1).toLowerCase());
              const active = pool.totalShares > 0n && pool.reserve0 > 0n && pool.reserve1 > 0n;
              return <article className="liquidity-explore-card" key={`${toHex(pool.asset0)}-${toHex(pool.asset1)}`}>
                <div><div className="liquidity-asset-pair">{asset0 && <AssetIdentity asset={asset0} size={30} />}<span className="liquidity-pair-divider">/</span>{asset1 && <AssetIdentity asset={asset1} size={30} />}</div><span>{active ? "Pool available" : "Pool needs liquidity"}</span></div>
                {asset0 && asset1 && active && <span className="liquidity-explore-rate">1 {asset0.symbol} ≈ {poolPriceDisplay(pool.reserve0, pool.reserve1, asset0.decimals, asset1.decimals)} {asset1.symbol}</span>}
                <ActionButton size="small" disabled={busyOrPending || !asset0 || !asset1} onClick={() => { if (asset0 && asset1) onNewPosition(asset0.assetIdHex, asset1.assetIdHex); }}>Provide liquidity</ActionButton>
              </article>;
            })}
            {poolsPageError && <div className="inline-alert" role="alert">{poolsPageError}</div>}
            {hasMorePools && <ActionButton variant="secondary" loading={poolsPageLoading} disabled={poolsPageLoading || busyOrPending} onClick={() => void loadMorePools()}>Load more pools</ActionButton>}
          </section>
        </> : <section className="liquidity-section liquidity-positions-list">
          {positionsLoading && <div className="liquidity-query-skeleton" aria-busy="true" aria-label="Loading positions"><span /><span /></div>}
          {!positionsLoading && positionsError && <div className="liquidity-query-error" role="alert"><p>{positionsError}</p><ActionButton size="small" variant="secondary" icon={RefreshCw} onClick={retryPositions}>Try again</ActionButton></div>}
          {!positionsLoading && !positionsError && !sessionOwner && <div className="liquidity-compact-empty"><div><strong>Connect an Ownership to see positions.</strong><p>Liquidity positions are held by their contributing Ownership.</p></div><ActionButton size="small" variant="secondary" onClick={onConnect}>Connect</ActionButton></div>}
          {!positionsLoading && !positionsError && sessionOwner && !networkReady && <p className="muted">Waiting for the Service connection…</p>}
          {!positionsLoading && !positionsError && sessionOwner && networkReady && positions.length === 0 && positionCursor >= positionIndexCount && <div className="liquidity-compact-empty"><div><strong>No liquidity positions yet.</strong><p>Provide liquidity to create your first position.</p></div><ActionButton size="small" variant="secondary" icon={Plus} onClick={() => onNewPosition()}>New position</ActionButton></div>}
          {!positionsLoading && !positionsError && sessionOwner && positions.length === 0 && positionCursor < positionIndexCount && <p className="muted">No active positions on this page. More positions are available.</p>}
          {sessionOwner && positions.map((position) => {
            const asset0 = assets.find((asset) => asset.assetIdHex === toHex(position.pool.asset0).toLowerCase());
            const asset1 = assets.find((asset) => asset.assetIdHex === toHex(position.pool.asset1).toLowerCase());
            return <article className="liquidity-position-card" key={`${position.pool.asset0.toString()}-${position.pool.asset1.toString()}`}>
              <div className="liquidity-position-main">
                <div className="liquidity-asset-pair">{asset0 && <AssetIdentity asset={asset0} size={30} />}<span className="liquidity-pair-divider">/</span>{asset1 && <AssetIdentity asset={asset1} size={30} />}</div>
                <div className="liquidity-position-underlying">{asset0 ? <AssetIdentity asset={asset0} size={22} amount={`${formatUnits(position.amount0, asset0.decimals)} ${asset0.symbol}`} className="asset-identity--amount-only" /> : position.amount0.toString()} <span>+</span> {asset1 ? <AssetIdentity asset={asset1} size={22} amount={`${formatUnits(position.amount1, asset1.decimals)} ${asset1.symbol}`} className="asset-identity--amount-only" /> : position.amount1.toString()}</div>
                <span className="liquidity-position-share">Pool share · {formatLiquiditySharePercentage(position.shares, position.pool.totalShares)}</span>
                <span className="liquidity-position-ownership"><small>Ownership</small><code>{formatLocusId(sessionOwner)}</code></span>
              </div>
              <div className="liquidity-position-actions"><ActionButton size="small" variant="secondary" disabled={busyOrPending || !asset0 || !asset1} onClick={() => { if (asset0 && asset1) onNewPosition(asset0.assetIdHex, asset1.assetIdHex); }}>Manage</ActionButton><ActionButton size="small" variant="secondary" disabled={busyOrPending} onClick={() => void requestRemoval(position, 50)}>Remove</ActionButton></div>
              <details className="liquidity-position-remove-options"><summary>Remove a specific amount</summary><div className="liquidity-position-actions">{[25, 50, 75, 100].map((pct) => <button key={pct} type="button" disabled={busyOrPending} onClick={() => void requestRemoval(position, pct)}>{pct}%</button>)}<button type="button" disabled={busyOrPending} onClick={() => requestCustomRemoval(position)}>Custom</button></div></details>
            </article>;
          })}
          {positionsPageError && <div className="inline-alert" role="alert">{positionsPageError}</div>}
          {sessionOwner && positionCursor < positionIndexCount && <ActionButton variant="secondary" loading={positionsPageLoading} disabled={positionsPageLoading || busyOrPending} onClick={() => void loadMorePositions()}>Load more positions</ActionButton>}
        </section>}
      </section>
    </> : <>
      <header className="liquidity-new-heading">
        <button type="button" className="liquidity-back-link" onClick={() => onTabChange("pools")}><ArrowLeft size={18} aria-hidden="true" /> Liquidity</button>
        <h1>New position</h1>
      </header>
      {error && <div className="inline-alert permissionless-liquidity-error" role="alert">{error}</div>}
      {actionMessage && <div className="inline-alert" role="status">{actionMessage}</div>}
      {pending && <div className="inline-alert"><div><strong>{pending.action} is still being checked.</strong><p>Its transaction ID is saved for this network and Ownership. Do not sign another liquidity action until its status is known.</p></div><ActionButton size="small" variant="secondary" icon={RefreshCw} loading={busy} onClick={() => void waitForPending(pending)}>Check transaction status</ActionButton></div>}
      {transactionId && <div className="liquidity-tx-receipt"><strong>{transactionOutcome === "failed" ? "Liquidity action was not applied" : pending || transactionOutcome === "pending" ? `${pending?.action ?? "Liquidity action"} · transaction pending` : "Liquidity action confirmed"}</strong><code>{transactionId}</code></div>}
      <section className="liquidity-section liquidity-new-card">
        <div className="liquidity-deposit-form">
          <AssetAmountInput
            className="liquidity-amount-field"
            selector={<AssetSelector aria-label="Token A" value={assetAId} assets={assets} onValueChange={(asset) => { if (asset.assetIdHex !== assetBId) setPair(asset.assetIdHex, assetBId); }} variant="compact" showBalance={false} disabled={busyOrPending} triggerClassName="liquidity-asset-selector" />}
            label="Token A"
            balance={sessionOwner ? selectedA ? `Balance: ${balanceLabel(selectedA)} ${selectedA.symbol}` : "Select an asset" : "Connect to view balance"}
            id="liquidity-amount-a"
            amount={amountA}
            onAmountChange={updateAmountA}
            onMax={() => { if (selectedA) updateAmountA(formatUnits(selectedA.balance ?? 0n, selectedA.decimals)); }}
            maxDisabled={!selectedA || selectedA.balance === null}
            disabled={busyOrPending}
            ariaLabel={`${selectedA?.symbol ?? "Token A"} amount`}
          />
          <button type="button" className="icon-button liquidity-switch-pair" aria-label="Switch token order" disabled={!assetAId || !assetBId || assetAId === assetBId || busyOrPending} onClick={() => setPair(assetBId, assetAId)}><ArrowDownUp size={18} aria-hidden="true" /></button>
          <AssetAmountInput
            className="liquidity-amount-field"
            selector={<AssetSelector aria-label="Token B" value={assetBId} assets={assets} onValueChange={(asset) => { if (asset.assetIdHex !== assetAId) setPair(assetAId, asset.assetIdHex); }} variant="compact" showBalance={false} disabled={busyOrPending} triggerClassName="liquidity-asset-selector" />}
            label="Token B"
            balance={sessionOwner ? selectedB ? `Balance: ${balanceLabel(selectedB)} ${selectedB.symbol}` : "Select an asset" : "Connect to view balance"}
            id="liquidity-amount-b"
            amount={amountB}
            onAmountChange={updateAmountB}
            onMax={() => { if (selectedB) updateAmountB(formatUnits(selectedB.balance ?? 0n, selectedB.decimals)); }}
            maxDisabled={!selectedB || selectedB.balance === null}
            disabled={busyOrPending}
            ariaLabel={`${selectedB?.symbol ?? "Token B"} amount`}
          />
        </div>
        {!selectedA || !selectedB ? <p className="liquidity-select-hint">Choose two different assets to check the current pool.</p> : <>
          <div className={`liquidity-pool-state${selectedPool && !poolEmpty ? " liquidity-pool-state--existing" : ""}`} aria-live="polite">
            {!networkReady ? <>Waiting for the Service connection…</>
              : selectedPoolLoading ? <><span className="status-dot" aria-hidden="true" /> Checking this pair on the Service…</>
              : selectedPoolError ? <>Pool state could not be loaded</>
                : poolEmpty ? <>New pool · this pool needs liquidity</>
                  : selectedPool ? <>Existing pool</>
                    : <>New pool</>}
          </div>
          {networkReady && !selectedPoolLoading && !selectedPoolError && (!selectedPool || poolEmpty) && <p className="liquidity-disclosure">Your initial deposit establishes this pool’s starting rate. Locus does not use a market oracle.</p>}
          {selectedPool && !poolEmpty && <div className="liquidity-current-rate"><span>Current pool rate</span><strong>1 {selectedA.symbol} = {pairPrice(selectedA, selectedB, selectedPool)} {selectedB.symbol}</strong></div>}
          {!selectedPoolLoading && !selectedPoolError && (!selectedPool || poolEmpty) && <div className="liquidity-current-rate"><span>Initial price</span><strong>1 {selectedA.symbol} = {initialPrice} {selectedB.symbol}</strong><small>1 {selectedB.symbol} = {selectedAmounts && selectedAmounts[0] > 0n && selectedAmounts[1] > 0n ? poolPriceDisplay(selectedAmounts[1], selectedAmounts[0], selectedB.decimals, selectedA.decimals) : "—"} {selectedA.symbol}</small></div>}
        </>}
        {selectedPoolError && <div className="liquidity-query-error" role="alert"><p>{selectedPoolError}</p><ActionButton size="small" variant="secondary" icon={RefreshCw} onClick={() => setPairRefreshRevision((revision) => revision + 1)}>Retry pool lookup</ActionButton></div>}
        {sessionOwner && <p className="liquidity-owner-summary"><span>Ownership</span><code>{formatLocusId(sessionOwner)}</code></p>}
        {positionsPageError && <div className="inline-alert" role="alert">{positionsPageError}</div>}
        <ActionButton variant="primary" icon={sessionOwner ? Droplets : undefined} fullWidth disabled={ctaDisabled} onClick={() => sessionOwner ? submitPreview() : onConnect()}>{ctaLabel}</ActionButton>
      </section>
    </>}

    <Modal open={!!review} title={review ? operationLabel(review.operation) : "Review liquidity"} onClose={() => { if (!busy) setReview(null); }} footer={removalPosition
      ? <><ActionButton variant="secondary" icon={X} disabled={busy} onClick={() => setReview(null)}>Cancel</ActionButton><ActionButton variant="primary" loading={busy} disabled={busyOrPending || !removalQuote || removalQuote.shares === 0n} onClick={() => void confirmRemoval(removalPosition)}>Confirm removal</ActionButton></>
      : <><ActionButton variant="secondary" icon={X} disabled={busy} onClick={() => setReview(null)}>Cancel</ActionButton><ActionButton variant="primary" loading={busy} disabled={busyOrPending} onClick={() => void confirmAction()}>Confirm and sign</ActionButton></>}>
      {removalPosition && removalQuote ? <div className="liquidity-review"><p>Remove {withdrawPercent}% of your position ({formatUnits(removalQuote.shares, 0)} shares).</p>{customWithdraw && <label>Custom percentage<input aria-label="Custom withdrawal percentage" type="number" min="1" max="100" step="1" value={withdrawPercent} onChange={(event) => setWithdrawPercent(Number(event.target.value))} /></label>}<p>You receive approximately:</p><div className="liquidity-review-assets">{assets.find((asset) => asset.assetIdHex === toHex(removalPosition.pool.asset0).toLowerCase()) && <AssetIdentity asset={assets.find((asset) => asset.assetIdHex === toHex(removalPosition.pool.asset0).toLowerCase())!} size={30} amount={formatUnits(removalQuote.amount0, assets.find((asset) => asset.assetIdHex === toHex(removalPosition.pool.asset0).toLowerCase())?.decimals ?? 0)} />} {assets.find((asset) => asset.assetIdHex === toHex(removalPosition.pool.asset1).toLowerCase()) && <AssetIdentity asset={assets.find((asset) => asset.assetIdHex === toHex(removalPosition.pool.asset1).toLowerCase())!} size={30} amount={formatUnits(removalQuote.amount1, assets.find((asset) => asset.assetIdHex === toHex(removalPosition.pool.asset1).toLowerCase())?.decimals ?? 0)} />}</div><p>Minimum output includes {SLIPPAGE_BPS / 100}% slippage protection.</p>{withdrawPercent === 100 && <p>Your position will close. {removalQuote.shares === removalPosition.pool.totalShares && "This will empty the pool."}</p>}</div>
        : selectedA && selectedB && selectedAmounts && liquidityQuote ? <div className="liquidity-review"><div className="liquidity-review-assets"><AssetIdentity asset={selectedA} size={30} /><span>/</span><AssetIdentity asset={selectedB} size={30} /></div><p>Estimated deposit:</p><div className="liquidity-review-assets"><AssetIdentity asset={selectedA} size={30} amount={formatUnits(quoteUsedA, selectedA.decimals)} /><AssetIdentity asset={selectedB} size={30} amount={formatUnits(quoteUsedB, selectedB.decimals)} /></div><p>Estimated shares minted: {liquidityQuote.sharesMinted.toString()}. Your estimated pool share after deposit: {formatLiquiditySharePercentage(sharesAfterAdd, totalSharesAfterAdd)}.</p><p>Ownership: {sessionOwner ? formatLocusId(sessionOwner) : "Not connected"}</p>{(!selectedPool || poolEmpty) && <p className="liquidity-warning">The initial deposit establishes the pool’s starting rate.</p>}{selectedPool && !poolEmpty && <p>Unused maximum amounts stay in your Ownership balance. Minimum shares use {SLIPPAGE_BPS / 100}% slippage protection.</p>}<p>No external market price is used.</p></div> : <p>Confirm this liquidity action in your wallet.</p>}
    </Modal>
  </section>;
}
