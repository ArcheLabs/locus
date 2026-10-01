import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { ArrowLeft, Droplets, Plus, RefreshCw } from "lucide-react";
import { formatUnits, minimumLiquidityAmount, ownershipKey, parseUnits, quoteAddLiquidity as calculateAddLiquidity, quoteInitialLiquidity, toHex, type LocusClient, type LiquidityPosition, type Ownership, type Pool, type PreparedOwnershipAction, type SignedOwnershipAction } from "@archelabs/locus";
import type { AssetView } from "../assets.js";
import { AssetIdentity, AssetSelector } from "../../components/AssetSelector.js";
import { AssetAmountInput } from "../../components/AssetAmountInput.js";
import { ConfirmationAssetList } from "../../components/ConfirmationAssetList.js";
import { ActionButton } from "../../components/ActionButton.js";
import { Modal } from "../../components/Modal.js";
import type { GlobalTransactionNotice } from "../../components/GlobalNotifications.js";
import { knownActionErrorMessage, normalizeActionError } from "../../errors/normalizeError.js";
import { waitForWalletSignature, withPreparationTimeout } from "../createAssetWorkflow.js";
import { poolPriceDisplay, proportionalAmount } from "./liquidityMath.js";
import type { LiquidityScope } from "./liquidityTypes.js";
import { useI18n } from "../../i18n/I18nProvider.js";
import { AssetBalanceStatus } from "../../components/AssetBalanceStatus.js";
import "./permissionlessLiquidity.css";

type Operation = "create" | "initialize" | "add" | "remove";
type PendingAction = { transactionId: string; action: string; networkId: string; serviceId: number; ownerKey: string; createdAt: number };
type PairPoolState = { key: string; pool: Pool | null; loading: boolean; error: string };
type LiquidityReview =
  | { operation: Exclude<Operation, "remove">; scope: LiquidityScope; assetA: AssetView; assetB: AssetView; amountA: string; amountB: string }
  | { operation: "remove"; scope: LiquidityScope; position: LiquidityPosition };
const SLIPPAGE_BPS = 50;
const OWNERSHIP_PREPARATION_TIMEOUT_MS = 45_000;
const WALLET_SIGNATURE_TIMEOUT_MS = 120_000;

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
  return knownActionErrorMessage(cause) ?? "The liquidity action could not be completed.";
}

function preReceiptFailure(cause: unknown, transactionId: string): string | null {
  if (!cause || typeof cause !== "object") return null;
  const rpcError = cause as { code?: unknown; data?: unknown };
  if (rpcError.code !== -32040 || !rpcError.data || typeof rpcError.data !== "object") return null;
  const transaction = rpcError.data as { transactionId?: unknown; status?: unknown; error?: unknown };
  if (transaction.status !== "failed" || typeof transaction.transactionId !== "string"
    || transaction.transactionId.toLowerCase() !== transactionId.toLowerCase()) return null;
  return typeof transaction.error === "string" && transaction.error.length > 0
    ? transaction.error
    : "The service rejected the transaction before producing an action receipt.";
}

export function LiquidityPage({ view, initialTab, initialPair, assets, pools, poolsError, poolsLoading, locus, networkId, serviceId, sessionOwner, connectionId, networkReady, canPerformAuthorizedAction, authorizationWaitMessage, isScopeCurrent, onPoolsRefreshed, onRefreshAssets, onConnect, onNewPosition, onTabChange, onActionSuccess, onTransactionNotice, onClearTransactionNotice, onRetryPools, getBalanceState }: {
  view: "home" | "new";
  initialTab: "pools" | "positions";
  initialPair: { assetA: string; assetB: string };
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
  canPerformAuthorizedAction: () => boolean;
  authorizationWaitMessage: string;
  isScopeCurrent: (scope: LiquidityScope) => boolean;
  onPoolsRefreshed: (pools: Pool[]) => void;
  onRefreshAssets: () => Promise<unknown>;
  onConnect: () => void;
  onNewPosition: (assetA?: string, assetB?: string) => void;
  onTabChange: (tab: "pools" | "positions") => void;
  onActionSuccess: (message: string) => void;
  onTransactionNotice: (notice: GlobalTransactionNotice) => void;
  onClearTransactionNotice: (id: string) => void;
  onRetryPools: () => void;
  getBalanceState: (asset: AssetView) => "known" | "loading" | "failed" | "signed-out";
}) {
  const { t, text } = useI18n();
  const [assetAId, setAssetAId] = useState("");
  const [assetBId, setAssetBId] = useState("");
  const [tab, setTab] = useState(initialTab);
  const [amountA, setAmountA] = useState("");
  const [amountB, setAmountB] = useState("");
  const [withdrawPercent, setWithdrawPercent] = useState(50);
  const [withdrawPercentText, setWithdrawPercentText] = useState("50");
  const [customWithdraw, setCustomWithdraw] = useState(false);
  const [positions, setPositions] = useState<LiquidityPosition[]>([]);
  const [positionsLoading, setPositionsLoading] = useState(false);
  const [positionsLoaded, setPositionsLoaded] = useState(false);
  const [positionsError, setPositionsError] = useState("");
  const [positionsRefreshRevision, setPositionsRefreshRevision] = useState(0);
  const positionsScopeKey = useRef("");
  const [positionIndexCount, setPositionIndexCount] = useState(0n);
  const [positionCursor, setPositionCursor] = useState(0n);
  const [positionsPageLoading, setPositionsPageLoading] = useState(false);
  const [positionsPageError, setPositionsPageError] = useState("");
  const [review, setReview] = useState<LiquidityReview | null>(null);
  const [busy, setBusy] = useState(false);
  const [preparingAction, setPreparingAction] = useState(false);
  const [preparedAction, setPreparedAction] = useState<PreparedOwnershipAction | null>(null);
  const preparedActionRef = useRef<PreparedOwnershipAction | null>(null);
  const preparationGeneration = useRef(0);
  const preparationTimer = useRef<number | null>(null);
  const routePairHydration = useRef<string | null>(null);
  const [transactionId, setTransactionId] = useState("");
  const [error, setError] = useState("");
  const [pairPoolState, setPairPoolState] = useState<PairPoolState | null>(null);
  const [pairRefreshRevision, setPairRefreshRevision] = useState(0);
  const [additionalPools, setAdditionalPools] = useState<Pool[]>([]);
  const [hasMorePools, setHasMorePools] = useState(false);
  const [poolsPageLoading, setPoolsPageLoading] = useState(false);
  const [poolsPageError, setPoolsPageError] = useState("");

  const ownerKey = sessionOwner ? toHex(ownershipKey(sessionOwner)).toLowerCase() : null;
  const scope = useMemo<LiquidityScope>(() => ({ networkId, serviceId, connectionId, ownerKey }), [connectionId, networkId, ownerKey, serviceId]);
  const storageKey = pendingStorageKey(scope);
  const transactionNoticeId = `liquidity-${storageKey}`;
  const pendingScopeReady = networkReady && sessionOwner !== null && serviceId !== null;
  const [pending, setPending] = useState<PendingAction | null>(() => pendingScopeReady ? readPending(storageKey) : null);
  const pendingMatchesScope = !!pending && pending.networkId === networkId && pending.serviceId === serviceId && pending.ownerKey === ownerKey;
  const previousTransactionNoticeId = useRef(transactionNoticeId);
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
  const operation: Exclude<Operation, "remove"> = !selectedPool ? "create" : poolEmpty ? "initialize" : "add";
  const busyOrPending = busy || !!pending;
  const formLocked = busyOrPending || !!review;
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
    const routePairKey = `${initialPair.assetA.toLowerCase()}:${initialPair.assetB.toLowerCase()}`;
    if (routePairHydration.current === routePairKey) return;
    const assetA = assets.find((asset) => asset.assetIdHex.toLowerCase() === initialPair.assetA.toLowerCase());
    const assetB = assets.find((asset) => asset.assetIdHex.toLowerCase() === initialPair.assetB.toLowerCase());
    if (!assetA || !assetB || assetA.assetIdHex === assetB.assetIdHex) return;
    routePairHydration.current = routePairKey;
    // A route pair is only a starting value. Once the user has made a choice
    // or entered an amount, later catalog updates must not restore the URL pair.
    if (assetAId || assetBId || amountA || amountB) return;
    setPair(assetA.assetIdHex, assetB.assetIdHex);
  }, [amountA, amountB, assetAId, assetBId, assets, initialPair.assetA, initialPair.assetB, view]);

  useEffect(() => () => {
    preparationGeneration.current += 1;
    if (preparationTimer.current !== null) window.clearTimeout(preparationTimer.current);
    const prepared = preparedActionRef.current;
    preparedActionRef.current = null;
    if (prepared) locus?.abandonPreparedOwnershipAction(prepared);
  }, [locus]);

  useEffect(() => {
    if (review && !isScopeCurrentRef.current(review.scope)) closeReview();
  }, [review, scope]);

  useEffect(() => {
    setPending(pendingScopeReady ? readPending(storageKey) : null);
    setTransactionId("");
  }, [pendingScopeReady, storageKey]);

  useEffect(() => {
    if (previousTransactionNoticeId.current !== transactionNoticeId) {
      onClearTransactionNotice(previousTransactionNoticeId.current);
      previousTransactionNoticeId.current = transactionNoticeId;
    }
    if (!pendingScopeReady || !pendingMatchesScope) {
      onClearTransactionNotice(transactionNoticeId);
      return;
    }
    if (pending) {
      showPendingNotice(pending, busy);
      return;
    }
    if (transactionId) {
      showLiquidityFailureNotice(transactionId, error);
      return;
    }
    onClearTransactionNotice(transactionNoticeId);
  }, [busy, error, locus, onClearTransactionNotice, onTransactionNotice, pending, pendingMatchesScope, pendingScopeReady, scope, storageKey, transactionId, transactionNoticeId]);

  useEffect(() => {
    setAdditionalPools([]);
    setHasMorePools(pools.length === 50);
    setPoolsPageError("");
  }, [locus, networkId, pools, serviceId]);

  useEffect(() => {
    if (!locus || !sessionOwner || !networkReady) {
      positionsScopeKey.current = "";
      setPositions([]); setPositionIndexCount(0n); setPositionCursor(0n); setPositionsLoading(false); setPositionsLoaded(false); setPositionsError(""); return;
    }
    let cancelled = false;
    const currentPositionsScopeKey = JSON.stringify(scope);
    if (positionsScopeKey.current !== currentPositionsScopeKey) {
      positionsScopeKey.current = currentPositionsScopeKey;
      setPositions([]); setPositionIndexCount(0n); setPositionCursor(0n);
      setPositionsLoaded(false);
    }
    setPositionsLoading(true);
    setPositionsError("");
    setPositionsPageError("");
    void Promise.all([
      locus.liquidityPositionCount(sessionOwner),
      locus.listLiquidityPositions(sessionOwner, { offset: 0n, limit: 50 }),
    ]).then(([count, next]) => {
      if (!cancelled && isScopeCurrentRef.current(scope)) {
        setPositionIndexCount(count); setPositionCursor(count > 50n ? 50n : count); setPositions(next);
        setPositionsLoaded(true);
      }
    }).catch(() => {
      if (!cancelled && isScopeCurrentRef.current(scope)) {
        setPositionsError("Your positions could not be loaded. Try again when the Service is available.");
        setPositionsLoaded(true);
      }
    }).finally(() => { if (!cancelled && isScopeCurrentRef.current(scope)) setPositionsLoading(false); });
    return () => { cancelled = true; };
  }, [locus, networkReady, scope, sessionOwner, positionsRefreshRevision]);

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

  function setPair(a: string, b: string, changedSide: "a" | "b" | "both" = "both") {
    setAssetAId(a); setAssetBId(b);
    if (changedSide === "a" || changedSide === "both") setAmountA("");
    if (changedSide === "b" || changedSide === "both") setAmountB("");
    setError("");
  }

  function updateAmountA(value: string) {
    setAmountA(value);
    setError("");
    if (!selectedPool || poolEmpty || !selectedA || !selectedB) return;
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
    setError("");
    if (!selectedPool || poolEmpty || !selectedA || !selectedB) return;
    try {
      const rawB = parseUnits(value, selectedB.decimals);
      const aIs0 = toHex(selectedA.assetId).toLowerCase() === toHex(selectedPool.asset0).toLowerCase();
      const reserveA = aIs0 ? selectedPool.reserve0 : selectedPool.reserve1;
      const reserveB = aIs0 ? selectedPool.reserve1 : selectedPool.reserve0;
      setAmountA(value.trim() ? formatUnits(proportionalAmount(rawB, reserveB, reserveA), selectedA.decimals) : "");
    } catch { setAmountA(""); }
  }

  function releasePreparedAction() {
    const prepared = preparedActionRef.current;
    preparedActionRef.current = null;
    setPreparedAction(null);
    if (prepared) locus?.abandonPreparedOwnershipAction(prepared);
  }

  function closeReview() {
    preparationGeneration.current += 1;
    if (preparationTimer.current !== null) {
      window.clearTimeout(preparationTimer.current);
      preparationTimer.current = null;
    }
    releasePreparedAction();
    setPreparingAction(false);
    setReview(null);
  }

  async function prepareReviewAction(request: LiquidityReview, percent: number): Promise<PreparedOwnershipAction> {
    if (!locus || !sessionOwner || !isScopeCurrentRef.current(request.scope)) throw new Error("The active Ownership or network changed. Review this action again.");

    let actionName: "createPool" | "addPoolLiquidity" | "removePoolLiquidity";
    let actionInput: Record<string, Uint8Array | bigint>;

    if (request.operation === "remove") {
      if (!Number.isInteger(percent) || percent < 1 || percent > 100) throw new Error("Choose a whole percentage from 1 to 100.");
      const position = request.position;
      const shares = percent === 100 ? position.shares : position.shares * BigInt(percent) / 100n;
      if (shares === 0n) throw new Error("This share amount is too small to withdraw.");
      const quote = await locus.quoteRemoveLiquidity(position.pool.asset0, position.pool.asset1, sessionOwner, shares);
      if (!isScopeCurrentRef.current(request.scope)) throw new Error("The active Ownership or network changed. Review this action again.");
      actionName = "removePoolLiquidity";
      actionInput = {
        assetA: position.pool.asset0,
        assetB: position.pool.asset1,
        shares,
        amountAOut: quote.amount0,
        amountBOut: quote.amount1,
        minAmountA: minimumLiquidityAmount(quote.amount0, SLIPPAGE_BPS),
        minAmountB: minimumLiquidityAmount(quote.amount1, SLIPPAGE_BPS),
      };
    } else {
      const assetA = request.assetA;
      const assetB = request.assetB;
      const rawA = parseUnits(request.amountA, assetA.decimals);
      const rawB = parseUnits(request.amountB, assetB.decimals);
      if (rawA <= 0n || rawB <= 0n) throw new Error("Both amounts must be greater than zero.");

      const [currentPool, balanceA, balanceB] = await Promise.all([
        locus.getPool(assetA.assetId, assetB.assetId),
        locus.balanceOf(assetA.assetId, sessionOwner),
        locus.balanceOf(assetB.assetId, sessionOwner),
      ]);
      if (!isScopeCurrentRef.current(request.scope)) throw new Error("The active Ownership or network changed. Review this action again.");
      if (rawA > balanceA || rawB > balanceB) throw new Error("Your balance changed and is no longer sufficient for these amounts.");

      const currentOperation: Exclude<Operation, "remove"> = !currentPool
        ? "create"
        : currentPool.totalShares === 0n ? "initialize" : "add";
      if (currentOperation !== request.operation) {
        setPairRefreshRevision((revision) => revision + 1);
        throw new Error("The pool changed while you were reviewing. Check the updated pair and try again.");
      }

      if (request.operation === "create") {
        const quote = quoteInitialLiquidity(rawA, rawB);
        actionName = "createPool";
        actionInput = { assetA: assetA.assetId, assetB: assetB.assetId, amountA: rawA, amountB: rawB, initialShares: quote.sharesMinted };
      } else {
        if (!currentPool) throw new Error("This pool is no longer available. Review the pair again.");
        const aIs0 = toHex(assetA.assetId).toLowerCase() === toHex(currentPool.asset0).toLowerCase();
        const quote = calculateAddLiquidity(
          currentPool.reserve0,
          currentPool.reserve1,
          currentPool.totalShares,
          aIs0 ? rawA : rawB,
          aIs0 ? rawB : rawA,
        );
        const usedA = aIs0 ? quote.amount0Used : quote.amount1Used;
        const usedB = aIs0 ? quote.amount1Used : quote.amount0Used;
        if (usedA > balanceA || usedB > balanceB) throw new Error("Your balance is no longer sufficient for the quoted deposit.");
        actionName = "addPoolLiquidity";
        actionInput = {
          assetA: assetA.assetId,
          assetB: assetB.assetId,
          maxAmountA: rawA,
          maxAmountB: rawB,
          amountAUsed: usedA,
          amountBUsed: usedB,
          sharesMinted: quote.sharesMinted,
          minShares: minimumLiquidityAmount(quote.sharesMinted, SLIPPAGE_BPS),
          initialShares: currentPool.totalShares === 0n ? quote.sharesMinted : 0n,
        };
      }
    }

    if (!isScopeCurrentRef.current(request.scope)) throw new Error("The active Ownership or network changed. Review this action again.");
    return locus.prepareOwnershipAction(actionName, actionInput);
  }

  async function prepareForReview(request: LiquidityReview, percent = withdrawPercent, openWhenReady = false) {
    if (!locus) return;
    preparationGeneration.current += 1;
    const generation = preparationGeneration.current;
    if (preparationTimer.current !== null) {
      window.clearTimeout(preparationTimer.current);
      preparationTimer.current = null;
    }
    releasePreparedAction();
    setPreparingAction(true);
    setError("");

    try {
      const preparation = prepareReviewAction(request, percent);
      const prepared = await withPreparationTimeout(
        preparation,
        OWNERSHIP_PREPARATION_TIMEOUT_MS,
        (latePrepared) => locus.abandonPreparedOwnershipAction(latePrepared),
      );
      if (generation !== preparationGeneration.current || !isScopeCurrentRef.current(request.scope)) {
        locus.abandonPreparedOwnershipAction(prepared);
        return;
      }
      preparedActionRef.current = prepared;
      setPreparedAction(prepared);
      if (openWhenReady) setReview(request);
    } catch (cause) {
      if (generation !== preparationGeneration.current) return;
      setPreparedAction(null);
      setReview(null);
      if (isScopeCurrentRef.current(request.scope)) setError(friendlyError(cause));
    } finally {
      if (generation === preparationGeneration.current) setPreparingAction(false);
    }
  }

  async function submitPreview() {
    if (!canPerformAuthorizedAction()) { setError(authorizationWaitMessage || "正在准备账户，请稍候。"); return; }
    if (!amountA.trim() || !amountB.trim()) return;
    if (!selectedA || !selectedB || selectedA.assetIdHex === selectedB.assetIdHex) { setError("Choose two different assets."); return; }
    if (selectedPoolLoading || selectedPoolError) { setError(selectedPoolError || "Pool state is still loading."); return; }
    try {
      const a = parseUnits(amountA, selectedA.decimals);
      const b = parseUnits(amountB, selectedB.decimals);
      if (a <= 0n || b <= 0n) throw new Error("Both amounts must be greater than zero.");
      if (selectedA.balance === null || selectedB.balance === null) throw new Error("Balances are still loading.");
      if (a > selectedA.balance || b > selectedB.balance) throw new Error("One or both amounts exceed your balance.");
      if (!liquidityQuote) throw new Error("These amounts are too large, too small, or outside the pool reserve limit.");
      const request: LiquidityReview = { operation, scope, assetA: selectedA, assetB: selectedB, amountA, amountB };
      setBusy(true);
      await prepareForReview(request, withdrawPercent, true);
    } catch { setError(t("errors.enterNonZeroAmounts")); }
    finally { setBusy(false); }
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

  async function clearPreReceiptFailure(id: string, cause: unknown, expectedScope: LiquidityScope): Promise<boolean> {
    const reason = preReceiptFailure(cause, id);
    if (!reason || !isScopeCurrent(expectedScope)) return false;
    const saved = readPending(storageKey);
    if (saved?.transactionId.toLowerCase() === id.toLowerCase()) window.localStorage.removeItem(storageKey);
    setPending((current) => current?.transactionId.toLowerCase() === id.toLowerCase() ? null : current);
    setTransactionId(id);
    setPairRefreshRevision((revision) => revision + 1);
    let refreshed = false;
    try { await refreshAfterApplied(expectedScope); refreshed = true; } catch { /* Keep the terminal failure visible if refresh is temporarily unavailable. */ }
    if (!isScopeCurrent(expectedScope)) return true;
    const followUp = reason.includes("jamscript_plan_v1")
      ? "Pool creation on this deployed Service must be upgraded before retrying."
      : "Review the current pool and balance state before another attempt.";
    const message = `The transaction failed before an action receipt was created (${reason}). No liquidity action was applied. ${refreshed ? "Pool state and balances were refreshed." : "The automatic state refresh failed; refresh the page before continuing."} ${followUp}`;
    setError(message);
    showLiquidityFailureNotice(id, message);
    return true;
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
    const saved = readPending(storageKey);
    if (saved?.transactionId.toLowerCase() === id.toLowerCase()) window.localStorage.removeItem(storageKey);
    setPending((current) => current?.transactionId.toLowerCase() === id.toLowerCase() ? null : current);
    setTransactionId(id);
    const message = `Transaction finalized as ${status}${errorCode === null ? "" : ` (error ${errorCode})`}. The liquidity action was not applied; review the current state before trying again.`;
    setError(message);
    showLiquidityFailureNotice(id, message);
    setPairRefreshRevision((revision) => revision + 1);
  }

  function showPendingNotice(current: PendingAction, checking: boolean) {
    onTransactionNotice({
      id: transactionNoticeId,
      title: checking ? "Checking liquidity transaction" : `${current.action} pending`,
      message: checking ? "Waiting for confirmation." : "The transaction is saved. Check its status before signing another liquidity action.",
      transactionId: current.transactionId,
      busy: checking,
      actionLabel: "Check status",
      onAction: () => void waitForPending(current),
      dismissible: true,
    });
  }

  function showLiquidityFailureNotice(id: string, message = error) {
    onTransactionNotice({
      id: transactionNoticeId,
      title: "Liquidity action failed",
      message: message || "The action was not applied. Review the current pool and balances before retrying.",
      transactionId: id,
      tone: "error",
      dismissible: true,
    });
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
    setBusy(true); setError("");
    try {
      const receipt = await locus.waitForAction(current.transactionId, { intervalMs: 750, timeoutMs: 180_000 });
      if (!isScopeCurrent(expectedScope)) return;
      if (receipt.actionReceipt.status !== "applied") {
        clearFinalizedFailure(current.transactionId, receipt.actionReceipt.status, receipt.actionReceipt.errorCode);
        return;
      }
      window.localStorage.removeItem(storageKey); setPending(null); setTransactionId("");
      onClearTransactionNotice(transactionNoticeId);
      await refreshAfterApplied(expectedScope);
      setPairRefreshRevision((revision) => revision + 1);
      if (current.action !== "Remove liquidity") onActionSuccess(current.action === "Create pool" ? t("liquidity.poolCreated") : t("liquidity.liquidityAdded"));
    } catch (cause) {
      if (!isScopeCurrent(expectedScope)) return;
      if (await clearPreReceiptFailure(current.transactionId, cause, expectedScope)) return;
      showPendingNotice(current, false);
    } finally {
      setBusy(false);
      if (isScopeCurrent(expectedScope)) {
        const saved = readPending(storageKey);
        if (saved?.transactionId.toLowerCase() === current.transactionId.toLowerCase()) showPendingNotice(saved, false);
      }
    }
  }

  function confirmAction() {
    if (!canPerformAuthorizedAction()) { setError(authorizationWaitMessage || "正在准备账户，请稍候。"); return; }
    if (!locus || !review || !preparedActionRef.current || busyOrPending || preparingAction
      || !isScopeCurrentRef.current(review.scope)) return;

    const prepared = preparedActionRef.current;
    let signature: Promise<SignedOwnershipAction>;
    try {
      // No RPC or asynchronous state read may run before this call. It must
      // execute in the Confirm button's user gesture for mobile wallets.
      signature = locus.signPreparedOwnershipAction(prepared);
    } catch (cause) {
      locus.abandonPreparedOwnershipAction(prepared);
      closeReview();
      setError(friendlyError(cause));
      return;
    }

    preparedActionRef.current = null;
    setPreparedAction(null);
    setPreparingAction(false);
    setBusy(true);
    setError("");
    void finishConfirmedAction(review, prepared, signature);
  }

  async function finishConfirmedAction(request: LiquidityReview, prepared: PreparedOwnershipAction, signature: Promise<SignedOwnershipAction>) {
    if (!locus) return;
    let signatureReceived = false;
    let submittedId = "";
    try {
      const signed = await waitForWalletSignature(signature, WALLET_SIGNATURE_TIMEOUT_MS);
      signatureReceived = true;
      if (!isScopeCurrentRef.current(request.scope)) throw new Error("The active Ownership or network changed. Check the action before continuing.");
      if (!canPerformAuthorizedAction()) {
        closeReview();
        setError(`${authorizationWaitMessage || "正在准备账户，请稍候。"} No transaction was submitted.`);
        return;
      }
      const submitted = await locus.submitSignedOwnershipAction(signed);
      submittedId = submitted.transactionId;
      const saved: PendingAction = {
        transactionId: submittedId,
        action: operationLabel(request.operation),
        networkId: request.scope.networkId,
        serviceId: request.scope.serviceId!,
        ownerKey: request.scope.ownerKey!,
        createdAt: Date.now(),
      };
      setPending(saved); setTransactionId(submittedId);
      try { window.localStorage.setItem(pendingStorageKey(request.scope), JSON.stringify(saved)); } catch { /* Keep the in-memory pending guard if this browser blocks local storage. */ }
      closeReview();

      const receipt = await locus.waitForAction(submittedId, { intervalMs: 750, timeoutMs: 180_000 });
      if (!isScopeCurrentRef.current(request.scope)) return;
      if (receipt.actionReceipt.status !== "applied") {
        clearFinalizedFailure(submittedId, receipt.actionReceipt.status, receipt.actionReceipt.errorCode);
        return;
      }
      window.localStorage.removeItem(pendingStorageKey(request.scope));
      setPending(null); setTransactionId("");
      onClearTransactionNotice(transactionNoticeId);
      if (request.operation !== "remove") { setAmountA(""); setAmountB(""); }
      await refreshAfterApplied(request.scope);
      setPairRefreshRevision((revision) => revision + 1);
      if (request.operation !== "remove") onActionSuccess(request.operation === "create" ? t("liquidity.poolCreated") : t("liquidity.liquidityAdded"));
    } catch (cause) {
      if (!signatureReceived) locus.abandonPreparedOwnershipAction(prepared);
      if (!isScopeCurrentRef.current(request.scope)) return;
      if (submittedId && await clearPreReceiptFailure(submittedId, cause, request.scope)) return;
      if (!submittedId && /error 6002|POOL_ALREADY_EXISTS/i.test(normalizeActionError(cause, ""))) {
        setPairRefreshRevision((revision) => revision + 1);
      }
      closeReview();
      if (submittedId) showPendingNotice(readPending(pendingStorageKey(request.scope)) ?? {
        transactionId: submittedId,
        action: operationLabel(request.operation),
        networkId: request.scope.networkId,
        serviceId: request.scope.serviceId!,
        ownerKey: request.scope.ownerKey!,
        createdAt: Date.now(),
      }, false);
      else setError(t("errors.submissionOutcomeUnknown", { reason: friendlyError(cause) }));
    } finally {
      setBusy(false);
    }
  }

  async function requestCustomRemoval(position: LiquidityPosition) {
    if (!sessionOwner || !locus || busyOrPending || !isScopeCurrent(scope)) return;
    setWithdrawPercent(50);
    setWithdrawPercentText("50");
    setCustomWithdraw(true);
    setBusy(true);
    try { await prepareForReview({ operation: "remove", position, scope }, 50, true); }
    finally { setBusy(false); }
  }

  function updateCustomWithdrawPercent(value: string) {
    setWithdrawPercentText(value);
    const trimmedValue = value.trim();
    const percent = trimmedValue ? Number(trimmedValue) : 0;
    setWithdrawPercent(percent);
    const currentReview = review;
    if (currentReview?.operation !== "remove") return;
    preparationGeneration.current += 1;
    if (preparationTimer.current !== null) window.clearTimeout(preparationTimer.current);
    preparationTimer.current = null;
    releasePreparedAction();
    setError("");
    if (!trimmedValue) {
      setPreparingAction(false);
      return;
    }
    if (!Number.isInteger(percent) || percent < 1 || percent > 100) {
      setPreparingAction(false);
      setError("Choose a whole percentage from 1 to 100.");
      return;
    }
    setPreparingAction(true);
    preparationTimer.current = window.setTimeout(() => {
      preparationTimer.current = null;
      void prepareForReview(currentReview, percent);
    }, 250);
  }

  const removalQuote = review?.operation === "remove" && review.position && sessionOwner
    && Number.isInteger(withdrawPercent) && withdrawPercent >= 1 && withdrawPercent <= 100
    ? (() => {
      const shares = withdrawPercent === 100 ? review.position.shares : review.position.shares * BigInt(withdrawPercent) / 100n;
      const last = shares === review.position.pool.totalShares;
      return {
        shares,
        amount0: last ? review.position.pool.reserve0 : review.position.pool.reserve0 * shares / review.position.pool.totalShares,
        amount1: last ? review.position.pool.reserve1 : review.position.pool.reserve1 * shares / review.position.pool.totalShares,
      };
    })() : null;
  const removalAssetLines = removalPosition && removalQuote ? [
    { id: toHex(removalPosition.pool.asset0).toLowerCase(), amount: removalQuote.amount0 },
    { id: toHex(removalPosition.pool.asset1).toLowerCase(), amount: removalQuote.amount1 },
  ].flatMap((line) => {
    const asset = assets.find((candidate) => candidate.assetIdHex === line.id);
    return asset ? [{ asset, amount: formatUnits(line.amount, asset.decimals) }] : [];
  }) : [];

  const insufficientAsset = selectedAmounts && selectedA && selectedB
    ? selectedA.balance !== null && selectedAmounts[0] > selectedA.balance ? selectedA
      : selectedB.balance !== null && selectedAmounts[1] > selectedB.balance ? selectedB
        : null
    : null;
  const validAmounts = !!selectedAmounts && selectedAmounts.every((value) => value > 0n);
  const requiredAmountMissing = !amountA.trim() || !amountB.trim();
  const ctaLabel = !sessionOwner ? t("common.connect")
    : !selectedA || !selectedB ? t("ui.selectAssets")
      : selectedA.assetIdHex === selectedB.assetIdHex ? t("swap.chooseDifferent")
        : !networkReady ? t("ui.serviceNotReady")
          : selectedPoolLoading ? t("ui.waitingPool")
            : selectedPoolError ? t("ui.poolStateFailed")
              : pending ? t("ui.transactionPending")
                : busy ? t("ui.preparing")
                  : selectedA.balance === null || selectedB.balance === null ? [selectedA, selectedB].some(asset => getBalanceState(asset) === "loading") ? t("liquidity.loadingBalances") : t("ui.balanceUnavailable")
                    : insufficientAsset ? t("ui.insufficient", { symbol: insufficientAsset.symbol })
                      : !validAmounts ? requiredAmountMissing ? t("liquidity.provide") : t("ui.enterAmount")
                        : !liquidityQuote ? t("ui.outsidePoolLimits")
                          : t("liquidity.provide");
  const ctaDisabled = sessionOwner
    ? !networkReady || !selectedA || !selectedB || selectedA.assetIdHex === selectedB.assetIdHex || selectedPoolLoading || !!selectedPoolError
      || busyOrPending || !!review || selectedA.balance === null || selectedB.balance === null || !validAmounts || !!insufficientAsset || !liquidityQuote || !canPerformAuthorizedAction()
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

  const actionStatus = <>
    {error && !transactionId && <div className="inline-alert permissionless-liquidity-error" role="alert">{text(error)}</div>}
  </>;

  return <section className={`page liquidity-page${view === "new" ? " liquidity-page--new" : ""}`}>
    {view === "home" ? <>
      <div className="liquidity-toolbar">
        <div className="liquidity-tabs" role="tablist" aria-label={t("ui.liquidityViews")} onKeyDown={handleTabKeyDown}>
          <button id="liquidity-tab-pools" type="button" role="tab" aria-selected={tab === "pools"} aria-controls="liquidity-panel-pools" tabIndex={tab === "pools" ? 0 : -1} className={tab === "pools" ? "active" : ""} onClick={() => updateTab("pools")}>{t("liquidity.pools")}</button>
          <button id="liquidity-tab-positions" type="button" role="tab" aria-selected={tab === "positions"} aria-controls="liquidity-panel-positions" tabIndex={tab === "positions" ? 0 : -1} className={tab === "positions" ? "active" : ""} onClick={() => updateTab("positions")}>{t("liquidity.positions")}</button>
        </div>
        <ActionButton variant="primary" icon={Plus} onClick={() => onNewPosition()}>{t("liquidity.newPosition")}</ActionButton>
      </div>
      <div className="liquidity-status-messages">{actionStatus}</div>
      <section id={`liquidity-panel-${tab}`} className="liquidity-tab-panel" role="tabpanel" aria-labelledby={`liquidity-tab-${tab}`}>
        {tab === "pools" ? <>
          <div className="liquidity-pools-list">
            {!networkReady && !poolsLoading && exploredPools.length === 0 && <p className="muted">{t("ui.waitingService")}</p>}
            {poolsLoading && exploredPools.length === 0 && <div className="liquidity-query-skeleton" aria-busy="true" aria-label={t("ui.loadingPools")}><span /><span /></div>}
            {!poolsLoading && poolsError && exploredPools.length === 0 && <div className="liquidity-query-error" role="alert"><p>{t("ui.poolUnavailable")}</p><ActionButton size="small" variant="secondary" icon={RefreshCw} onClick={onRetryPools}>{t("ui.tryAgain")}</ActionButton></div>}
            {networkReady && !poolsLoading && !poolsError && exploredPools.length === 0 && <div className="liquidity-compact-empty"><span className="muted">{t("ui.noPools")}</span><ActionButton size="small" variant="secondary" icon={Plus} onClick={() => onNewPosition()}>{t("ui.newPosition")}</ActionButton></div>}
            {exploredPools.map((pool) => {
              const asset0 = assets.find((asset) => asset.assetIdHex === toHex(pool.asset0).toLowerCase());
              const asset1 = assets.find((asset) => asset.assetIdHex === toHex(pool.asset1).toLowerCase());
              return <article className="liquidity-explore-card" key={`${toHex(pool.asset0)}-${toHex(pool.asset1)}`}>
                <div className="liquidity-explore-pair"><div className="liquidity-asset-pair">{asset0 && <AssetIdentity asset={asset0} size={30} />}<span className="liquidity-pair-divider">/</span>{asset1 && <AssetIdentity asset={asset1} size={30} />}</div></div>
                {asset0 && asset1 && <div className="liquidity-explore-balances" role="group" aria-label={t("ui.poolBalances")}>
                  <span><strong>{formatUnits(pool.reserve0, asset0.decimals)}</strong> {asset0.symbol}</span>
                  <span><strong>{formatUnits(pool.reserve1, asset1.decimals)}</strong> {asset1.symbol}</span>
                </div>}
                <ActionButton size="small" variant="secondary" disabled={busyOrPending || !asset0 || !asset1} onClick={() => { if (asset0 && asset1) onNewPosition(asset0.assetIdHex, asset1.assetIdHex); }}>{t("ui.add")}</ActionButton>
              </article>;
            })}
            {poolsPageError && <div className="inline-alert" role="alert">{poolsPageError}</div>}
            {hasMorePools && <ActionButton variant="secondary" loading={poolsPageLoading} disabled={poolsPageLoading || busyOrPending} onClick={() => void loadMorePools()}>Load more pools</ActionButton>}
          </div>
        </> : <div className="liquidity-positions-list">
          {positionsLoading && !positionsLoaded && <div className="liquidity-query-skeleton" aria-busy="true" aria-label={t("ui.loadingPositions")}><span /><span /></div>}
          {positionsLoading && positionsLoaded && <p className="muted liquidity-refreshing" role="status">{t("ui.refreshingPositions")}</p>}
          {!positionsLoading && positionsError && <div className="liquidity-query-error" role="alert"><p>{text(positionsError)}</p><ActionButton size="small" variant="secondary" icon={RefreshCw} onClick={retryPositions}>{t("ui.tryAgain")}</ActionButton></div>}
          {!positionsLoading && !positionsError && !sessionOwner && <div className="liquidity-compact-empty"><span className="muted">{t("ui.connectPositions")}</span><ActionButton size="small" variant="secondary" onClick={onConnect}>{t("common.connect")}</ActionButton></div>}
          {!positionsLoading && !positionsError && sessionOwner && !networkReady && <p className="muted">{t("ui.waitingService")}</p>}
          {!positionsLoading && !positionsError && sessionOwner && networkReady && positions.length === 0 && positionCursor >= positionIndexCount && <div className="liquidity-compact-empty"><span className="muted">{t("ui.noPositions")}</span><ActionButton size="small" variant="secondary" icon={Plus} onClick={() => onNewPosition()}>{t("ui.newPosition")}</ActionButton></div>}
          {!positionsLoading && !positionsError && sessionOwner && positions.length === 0 && positionCursor < positionIndexCount && <p className="muted">{t("ui.noPositionsPage")}</p>}
          {sessionOwner && positions.map((position) => {
            const asset0 = assets.find((asset) => asset.assetIdHex === toHex(position.pool.asset0).toLowerCase());
            const asset1 = assets.find((asset) => asset.assetIdHex === toHex(position.pool.asset1).toLowerCase());
            return <article className="liquidity-position-card" key={`${position.pool.asset0.toString()}-${position.pool.asset1.toString()}`}>
              <div className="liquidity-position-main">
                <div className="liquidity-asset-pair">{asset0 && <AssetIdentity asset={asset0} size={28} amount={formatUnits(position.amount0, asset0.decimals)} />}<span className="liquidity-pair-divider">/</span>{asset1 && <AssetIdentity asset={asset1} size={28} amount={formatUnits(position.amount1, asset1.decimals)} />}</div>
              </div>
              <div className="liquidity-position-actions"><ActionButton size="small" variant="secondary" disabled={busyOrPending || !asset0 || !asset1} onClick={() => { if (asset0 && asset1) onNewPosition(asset0.assetIdHex, asset1.assetIdHex); }}>Manage</ActionButton><ActionButton size="small" variant="secondary" disabled={busyOrPending} onClick={() => void requestCustomRemoval(position)}>Remove</ActionButton></div>
            </article>;
          })}
          {positionsPageError && <div className="inline-alert" role="alert">{positionsPageError}</div>}
          {sessionOwner && positionCursor < positionIndexCount && <ActionButton variant="secondary" loading={positionsPageLoading} disabled={positionsPageLoading || busyOrPending} onClick={() => void loadMorePositions()}>Load more positions</ActionButton>}
        </div>}
      </section>
    </> : <>
      <header className="liquidity-new-heading">
        <button type="button" className="liquidity-back-link" onClick={() => onTabChange("pools")}><ArrowLeft size={18} aria-hidden="true" /> {t("common.liquidity")}</button>
        <h1>{t("liquidity.newPosition")}</h1>
      </header>
      <div className="liquidity-status-messages">{actionStatus}</div>
      <section className="liquidity-section liquidity-new-card">
        <div className="liquidity-deposit-form">
          <AssetAmountInput
            className="liquidity-amount-field"
            selector={<AssetSelector aria-label={t("ui.tokenA")} value={assetAId} assets={assets} onValueChange={(asset) => { if (asset.assetIdHex !== assetAId && asset.assetIdHex !== assetBId) setPair(asset.assetIdHex, assetBId, "a"); }} variant="compact" showBalance={false} disabled={formLocked} triggerClassName="liquidity-asset-selector" />}
            label={t("ui.tokenA")}
            balance={selectedA ? <AssetBalanceStatus state={getBalanceState(selectedA)} amount={formatUnits(selectedA.balance ?? 0n, selectedA.decimals)} symbol={selectedA.symbol} onRetry={() => void onRefreshAssets()} /> : undefined}
            id="liquidity-amount-a"
            amount={amountA}
            onAmountChange={updateAmountA}
            onMax={() => { if (selectedA) updateAmountA(formatUnits(selectedA.balance ?? 0n, selectedA.decimals)); }}
            maxDisabled={!selectedA || selectedA.balance === null}
            disabled={formLocked}
            ariaLabel={t("ui.amountFor", { token: selectedA?.symbol ?? t("ui.tokenA") })}
          />
          <AssetAmountInput
            className="liquidity-amount-field"
            selector={<AssetSelector aria-label={t("ui.tokenB")} value={assetBId} assets={assets} onValueChange={(asset) => { if (asset.assetIdHex !== assetBId && asset.assetIdHex !== assetAId) setPair(assetAId, asset.assetIdHex, "b"); }} variant="compact" showBalance={false} disabled={formLocked} triggerClassName="liquidity-asset-selector" />}
            label={t("ui.tokenB")}
            balance={selectedB ? <AssetBalanceStatus state={getBalanceState(selectedB)} amount={formatUnits(selectedB.balance ?? 0n, selectedB.decimals)} symbol={selectedB.symbol} onRetry={() => void onRefreshAssets()} /> : undefined}
            id="liquidity-amount-b"
            amount={amountB}
            onAmountChange={updateAmountB}
            onMax={() => { if (selectedB) updateAmountB(formatUnits(selectedB.balance ?? 0n, selectedB.decimals)); }}
            maxDisabled={!selectedB || selectedB.balance === null}
            disabled={formLocked}
            ariaLabel={t("ui.amountFor", { token: selectedB?.symbol ?? t("ui.tokenB") })}
          />
        </div>
        {selectedA && selectedB && <>
          {!selectedPoolLoading && !selectedPoolError && (!selectedPool || poolEmpty) && <p className="liquidity-disclosure">{t("ui.startingPriceDisclosure")}</p>}
          {selectedPool && !poolEmpty && <div className="liquidity-current-rate"><span>{t("ui.poolRate")}</span><strong>1 {selectedA.symbol} = {pairPrice(selectedA, selectedB, selectedPool)} {selectedB.symbol}</strong></div>}
          {!selectedPoolLoading && !selectedPoolError && (!selectedPool || poolEmpty) && selectedAmounts && selectedAmounts[0] > 0n && selectedAmounts[1] > 0n && <div className="liquidity-current-rate"><span>{t("ui.initialPrice")}</span><strong>1 {selectedA.symbol} = {initialPrice} {selectedB.symbol}</strong></div>}
        </>}
        {selectedPoolError && <div className="liquidity-query-error" role="alert"><p>{text(selectedPoolError)}</p><ActionButton size="small" variant="secondary" icon={RefreshCw} onClick={() => setPairRefreshRevision((revision) => revision + 1)}>{t("ui.retryPoolLookup")}</ActionButton></div>}
        {positionsPageError && <div className="inline-alert" role="alert">{positionsPageError}</div>}
        {sessionOwner && !canPerformAuthorizedAction() && <p className="account-access-status" role="status">{t("auth.accountStillAuthorizing")}</p>}
        <ActionButton variant="primary" icon={sessionOwner ? Droplets : undefined} loading={(busy && !pending) || selectedPoolLoading} fullWidth disabled={ctaDisabled} onClick={() => sessionOwner ? void submitPreview() : onConnect()}>{ctaLabel}</ActionButton>
      </section>
    </>}

    <Modal
      open={!!review}
      title={review ? operationLabel(review.operation) : "Review liquidity"}
      onClose={closeReview}
      footer={<><ActionButton variant="secondary" onClick={closeReview}>{t("common.cancel")}</ActionButton><ActionButton variant="primary" loading={busy || preparingAction} disabled={busyOrPending || preparingAction || !preparedAction || !canPerformAuthorizedAction() || (removalPosition !== null && (!removalQuote || removalQuote.shares === 0n))} onClick={confirmAction}>{t("common.confirm")}</ActionButton></>}
    >
      {!canPerformAuthorizedAction() && <p className="account-access-status" role="status">{authorizationWaitMessage || "正在准备账户，请稍候。"}</p>}
      {removalPosition ? <div className="liquidity-review">
        {customWithdraw
          ? <label className="liquidity-withdraw-field"><span>{t("ui.removePercent")}</span><input aria-label={t("ui.customWithdrawal")} type="number" min="1" max="100" step="1" value={withdrawPercentText} onChange={(event) => updateCustomWithdrawPercent(event.target.value)} /></label>
          : <span className="liquidity-review-caption">Remove {withdrawPercent}%</span>}
        {error && <p className="liquidity-review-error" role="alert">{text(error)}</p>}
        {removalQuote && <ConfirmationAssetList items={removalAssetLines} />}
      </div>
        : review?.operation === "create" ? <ConfirmationAssetList items={[
          { asset: review.assetA, amount: review.amountA },
          { asset: review.assetB, amount: review.amountB },
        ]} />
          : selectedA && selectedB && liquidityQuote ? <ConfirmationAssetList items={[
            { asset: selectedA, amount: formatUnits(quoteUsedA, selectedA.decimals) },
            { asset: selectedB, amount: formatUnits(quoteUsedB, selectedB.decimals) },
          ]} /> : null}
    </Modal>
  </section>;
}
