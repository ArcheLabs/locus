import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import Skeleton from "react-loading-skeleton";
import "react-loading-skeleton/dist/skeleton.css";
import { formatLocusId, formatUnits, ownershipKey, parseUnits, toHex, type LocusClient, type Ownership } from "@archelabs/locus";
import { ArrowDownLeft, ArrowLeftRight, ArrowUpRight, CirclePlus, Coins, Droplets, History, List, ListFilter, RefreshCw, Search, Send, Shapes, TrendingUp, X } from "lucide-react";
import { useNetwork } from "./network/NetworkProvider.js";
import { NetworkSwitcher } from "./network/NetworkSwitcher.js";
import { loadAssetBalance, loadAssetIds, loadAssetMetadataForId, loadCuratedCatalog, displayAmount, displayAssetAmount, formatAssetListAmount, type AssetMetadata, type AssetView, type CuratedCatalog } from "./locus/assets.js";
import { type LiquidityScope } from "./locus/liquidity/liquidityTypes.js";
import { LiquidityPage } from "./locus/liquidity/LiquidityPage.js";
import { SwapPage } from "./locus/swap/SwapPage.js";
import { poolListError, poolListQueryKey } from "./locus/pools/poolQueries.js";
import { assetBalanceQueryKey, assetIdsQueryKey, assetMetadataQueryKey, assetQueryRetry, assetQueryRetryDelay } from "./locus/assetQueries.js";
import { attachAssetBalances, keepAssetRowsForScope } from "./locus/assetCache.js";
import { resolveRecipient, detectRecipientType, type RecipientType } from "./locus/recipients.js";
import { transferAndWait, type SendState } from "./locus/transaction.js";
import { useSession } from "./session/SessionProvider.js";
import { connectBrowserSession, connectEvmProvider, restoreBrowserSession, watchBrowserSession } from "./session/connectors.js";
import { activeSessionKind, markSessionDisconnected, setActiveSessionKind } from "./session/sessionPersistence.js";
import { EvmSessionBridge } from "./session/EvmSessionBridge.js";
import { ConnectDialog } from "./session/ConnectDialog.js";
import { PolkadotAccountSwitchDialog } from "./session/PolkadotAccountSwitchDialog.js";
import { switchPolkadotSession } from "./session/polkadotSession.js";
import { CreateAssetDialog, ReceiveDialog, ReviewDialog } from "./locus/dialogs.js";
import { AssetPicker } from "./locus/AssetPicker.js";
import { Modal } from "./components/Modal.js";
import { AccountMenu } from "./components/AccountMenu.js";
import { MobileNavigation } from "./components/MobileNavigation.js";
import { ActionButton } from "./components/ActionButton.js";
import { GlobalNotifications, type GlobalTransactionNotice } from "./components/GlobalNotifications.js";
import { FieldMessage } from "./forms/FieldMessage.js";
import { ResponsiveSelect } from "./components/ResponsiveSelect.js";
import { SegmentedControl } from "./components/SegmentedControl.js";
import { AssetIcon } from "./components/AssetIcon.js";
import { AssetAmountInput } from "./components/AssetAmountInput.js";
import { CopyableValue } from "./components/CopyableValue.js";
import { pathForRoute, routeFromPath, type AppRoute } from "./navigation/routes.js";
import { readStoredMatrixSession, restoreMatrixSession, connectMatrixTokenSession, signOutMatrixSession, type MatrixConnected } from "./matrix/MatrixConnector.js";
import { matrixStateRequiresUserInteraction } from "./matrix/MatrixInteraction.js";
import { resolveMatrixRecipient } from "./matrix/MatrixRecipientResolver.js";
import { completeMatrixAuthCallback, hasMatrixAuthCallback, revokeMatrixOAuthSession, type MatrixOAuthSession } from "./matrix/MatrixOAuth.js";
import { useAppKit, useAppKitAccount, useAppKitProvider, useDisconnect } from "@reown/appkit/react";
import type { Eip1193Provider } from "@jamscript/client";
import type { SessionKind } from "./session/types.js";
import { OwnershipInput } from "./locus/OwnershipInput.js";
import { ThemeControl } from "./theme/ThemeControl.js";
import { validatePositiveAmount, validateRecipientText } from "./forms/validation.js";
import { normalizeActionError } from "./errors/normalizeError.js";
import { activityFilters, BROWSER_LOCAL_ACTIVITY_CAPABILITIES, includeActivityItem } from "./activity/activityTypes.js";

type Page = AppRoute;
type DemoAsset = { symbol: string; name: string; balance: bigint; decimals: number; value: string; color: string };
type ActivityItem = { transactionId?: string } & (
  | { kind?: "transfer"; direction: "sent" | "received"; asset: string; recipient: string; amount: string }
  | { kind: "swap"; assetIn: string; assetOut: string; amountIn: string; amountOut: string }
);
type MatrixRecipientState =
  | { status: "idle" }
  | { status: "resolving"; userId: string; scope: string }
  | { status: "resolved"; userId: string; scope: string; ownership: import("@archelabs/locus").Ownership }
  | { status: "unavailable" | "key-changed" | "error"; userId: string; scope: string; message: string };
const MATRIX_RECIPIENT_DEBOUNCE_MS = 400;

function isCompleteMatrixUserId(value: string): boolean {
  const match = /^@[^:\s/]+:(?:\[[0-9A-Fa-f:.]+\]|[A-Za-z0-9.-]+)(?::([0-9]{1,5}))?$/.exec(value);
  if (!match) return false;
  if (match[1] !== undefined) {
    const port = Number(match[1]);
    if (port < 1 || port > 65535) return false;
  }
  return true;
}

const demoAssets: DemoAsset[] = [
  { symbol: "DOT", name: "Dot Token", balance: 12450n, decimals: 0, value: "≈ $623.40", color: "#247eaa" },
  { symbol: "MINI", name: "Mini Token", balance: 2400n, decimals: 0, value: "≈ $240.00", color: "#8555df" },
  { symbol: "USDX", name: "Dollar Token", balance: 1250n, decimals: 0, value: "≈ $1,250.00", color: "#18a56b" },
  { symbol: "NOTE", name: "Note Token", balance: 340n, decimals: 0, value: "≈ $29.10", color: "#7c8798" },
];

function sessionActivityKey(networkId: string, owner: string): string {
  return `locus.activity.v1.${networkId}.${owner}`;
}

function activityAmount(amount: string, asset: string): string {
  const value = amount.trim();
  const unit = ` ${asset}`;
  return value.toLowerCase().endsWith(unit.toLowerCase()) ? value.slice(0, -unit.length).trimEnd() : value;
}

function matrixRestoreMessage(connected: MatrixConnected): string {
  if (connected.state === "CONTROLLER_AUTHORIZATION_QUEUED") {
    return "Matrix verification is complete. The controller authorization is queued in MiniJAM; Locus will keep checking it. Do not repeat verification.";
  }
  if (connected.state === "CONTROLLER_AUTHORIZATION_UNKNOWN") {
    return "Matrix verification is complete. The controller authorization status is temporarily unavailable; use Check authorization status in the Matrix dialog. Do not repeat verification.";
  }
  if (connected.state === "CONTROLLER_AUTHORIZING" || connected.state === "CONTROLLER_AUTHORIZATION_FINALIZING") {
    return "Matrix verification is complete. Locus is waiting for the controller authorization transaction to finalize on MiniJAM. Keep the Matrix dialog open.";
  }
  if (connected.state === "CONTROLLER_AUTHORIZATION_FAILED") {
    return `Matrix verification is complete, but controller authorization failed. ${connected.error}`;
  }
  if (connected.state === "CONTROLLER_REVOKED") {
    return "This Locus Matrix controller was previously revoked. Sign in as a new Matrix device or use another active controller.";
  }
  return "Matrix device keys are ready. Locus is requesting SAS verification from your other Matrix devices. Switch to Element, accept the request, then return here to compare emoji. No Locus session is connected yet.";
}

function networkErrorMessage(error: Error | null, endpoint?: string): string {
  if (!error) return "";
  return endpoint ? `${error.message}\n${endpoint}` : error.message;
}

export function App() {
  const network = useNetwork();
  const { session, setSession, clearSession, lifecycle, restoreError, finishRestore } = useSession();
  const networkMode = network.mode === "network";
  const [page, setPage] = useState<Page>(() => routeFromPath(window.location.pathname, import.meta.env.BASE_URL));
  const [liquidityTab, setLiquidityTab] = useState<"pools" | "positions">(() => new URLSearchParams(window.location.search).get("tab") === "positions" ? "positions" : "pools");
  const [demoAssetIndex, setDemoAssetIndex] = useState(0);
  const [selectedAssetId, setSelectedAssetId] = useState<string | null>(null);
  const [detailAsset, setDetailAsset] = useState<AssetView | DemoAsset | null>(null);
  const [search, setSearch] = useState("");
  const [assetSearch, setAssetSearch] = useState("");
  const [recipientType, setRecipientType] = useState<RecipientType>("matrix");
  const [recipient, setRecipient] = useState("");
  const [matrixRecipientState, setMatrixRecipientState] = useState<MatrixRecipientState>({ status: "idle" });
  const [amount, setAmount] = useState("");
  const [typeOpen, setTypeOpen] = useState(false);
  const [assetPickerOpen, setAssetPickerOpen] = useState(false);
  const [filter, setFilter] = useState<"all" | "sent" | "swap">("all");
  const [assetFilter, setAssetFilter] = useState<"all" | "crypto" | "equities" | "custom">("all");
  const [toast, setToast] = useState("");
  const [transactionNotices, setTransactionNotices] = useState<GlobalTransactionNotice[]>([]);
  const publishTransactionNotice = useCallback((notice: GlobalTransactionNotice) => {
    setTransactionNotices((current) => [...current.filter((item) => item.id !== notice.id), notice]);
  }, []);
  const clearTransactionNotice = useCallback((id: string) => {
    setTransactionNotices((current) => current.filter((item) => item.id !== id));
  }, []);
  const [sendState, setSendState] = useState<SendState>({ status: "idle" });
  const [sendAttempted, setSendAttempted] = useState(false);
  const [recipientTouched, setRecipientTouched] = useState(false);
  const [amountTouched, setAmountTouched] = useState(false);
  const [sendFormError, setSendFormError] = useState("");
  const [sessionActivity, setSessionActivity] = useState<ActivityItem[]>([]);
  const [connectOpen, setConnectOpen] = useState(false);
  const [polkadotSwitchOpen, setPolkadotSwitchOpen] = useState(false);
  const [switchingAccount, setSwitchingAccount] = useState(false);
  const [walletConnectPending, setWalletConnectPending] = useState<SessionKind | null>(null);
  const [evmConnectError, setEvmConnectError] = useState("");
  const [reviewOpen, setReviewOpen] = useState(false);
  const [receiveAsset, setReceiveAsset] = useState<AssetView | DemoAsset | null>(null);
  const [createAssetOpen, setCreateAssetOpen] = useState(false);
  const [pendingMatrixConnection, setPendingMatrixConnection] = useState<MatrixConnected | null>(null);
  const networkIdRef = useRef(network.networkId);
  const lastReadyServiceIdByNetwork = useRef(new Map<string, number>());
  const assetMetadataCache = useRef<{ scope: string; rows: AssetMetadata[] }>({ scope: "", rows: [] });
  const sessionRestoreAttempted = useRef(false);
  const sessionRestoreEpoch = useRef(0);
  const sessionRestoreAbort = useRef<AbortController | null>(null);
  const sessionRestoreTimeout = useRef<number | null>(null);
  const oauthCallbackAttempted = useRef(false);
  const provisionalMatrixAuth = useRef<MatrixOAuthSession | null>(null);
  const matrixAuthAbort = useRef<AbortController | null>(null);
  const { address: appKitAddress, isConnected: appKitEvmConnected } = useAppKitAccount({ namespace: "eip155" });
  const { walletProvider } = useAppKitProvider<Eip1193Provider>("eip155");
  const { open: openAppKit } = useAppKit();
  const { disconnect: disconnectAppKit } = useDisconnect();
  const sessionRef = useRef(session);
  const lifecycleRef = useRef(lifecycle);
  const evmBridgeRef = useRef<EvmSessionBridge | null>(null);
  sessionRef.current = session;
  lifecycleRef.current = lifecycle;
  if (!evmBridgeRef.current) {
    evmBridgeRef.current = new EvmSessionBridge({
      getSession: () => sessionRef.current,
      commitSession: (next) => {
        setSession(next);
        setWalletConnectPending(null);
        setEvmConnectError("");
        setConnectOpen(false);
      },
      clearSession,
      createSession: connectEvmProvider,
      onError: (error) => {
        setWalletConnectPending(null);
        setEvmConnectError(error.message);
        if (sessionRef.current?.kind === "evm" && error.message.startsWith("Could not switch account.")) notify(error.message);
        if (lifecycleRef.current === "restoring") {
          evmBridgeRef.current?.cancelConnection();
          finishRestore(`Could not restore the EVM session. It remains saved so you can retry. ${error.message}`);
        }
      },
    });
  }
  const evmBridge = evmBridgeRef.current;
  networkIdRef.current = network.networkId;

  function navigateToPage(next: Page) {
    const url = new URL(window.location.href);
    url.pathname = pathForRoute(next, import.meta.env.BASE_URL);
    url.search = "";
    if (window.location.pathname !== url.pathname || window.location.search !== "") {
      window.history.pushState({ locusRoute: next }, "", url);
    }
    setPage(next);
    if (next === "liquidity") setLiquidityTab("pools");
  }

  function navigateToLiquidityNew(assetA?: string, assetB?: string) {
    const url = new URL(window.location.href);
    url.pathname = pathForRoute("liquidity-new", import.meta.env.BASE_URL);
    url.search = "";
    if (assetA && assetB) {
      url.searchParams.set("assetA", assetA);
      url.searchParams.set("assetB", assetB);
    }
    window.history.pushState({ locusRoute: "liquidity-new" }, "", url);
    setPage("liquidity-new");
  }

  function updateLiquidityTab(next: "pools" | "positions") {
    const url = new URL(window.location.href);
    url.pathname = pathForRoute("liquidity", import.meta.env.BASE_URL);
    if (next === "positions") url.searchParams.set("tab", "positions");
    else url.searchParams.delete("tab");
    if (url.pathname !== window.location.pathname || url.search !== window.location.search) {
      window.history.pushState({ locusRoute: "liquidity", liquidityTab: next }, "", url);
    }
    setPage("liquidity");
    setLiquidityTab(next);
  }

  useEffect(() => {
    const syncRoute = () => {
      const nextPage = routeFromPath(window.location.pathname, import.meta.env.BASE_URL);
      setPage(nextPage);
      setLiquidityTab(new URLSearchParams(window.location.search).get("tab") === "positions" ? "positions" : "pools");
    };
    window.addEventListener("popstate", syncRoute);
    return () => window.removeEventListener("popstate", syncRoute);
  }, []);

  const sessionOwner = session?.owner ?? null;
  const locus = useMemo<LocusClient | null>(() => network.locus?.withSession(session?.ownershipSession ?? null) ?? null, [network.locus, session]);
  const queryClient = useQueryClient();
  if (networkMode && network.status === "ready" && network.deployment) {
    lastReadyServiceIdByNetwork.current.set(network.networkId, network.deployment.serviceId);
  }
  const serviceId = network.deployment?.serviceId ?? lastReadyServiceIdByNetwork.current.get(network.networkId) ?? null;
  const liquidityScopeRef = useRef<LiquidityScope>({
    networkId: network.networkId,
    serviceId,
    connectionId: session?.connectionId ?? null,
    ownerKey: sessionOwner ? toHex(ownershipKey(sessionOwner)).toLowerCase() : null,
  });
  liquidityScopeRef.current = {
    networkId: network.networkId,
    serviceId,
    connectionId: session?.connectionId ?? null,
    ownerKey: sessionOwner ? toHex(ownershipKey(sessionOwner)).toLowerCase() : null,
  };
  const isLiquidityScopeCurrent = (expected: LiquidityScope) => {
    const current = liquidityScopeRef.current;
    return current.networkId === expected.networkId
      && current.serviceId === expected.serviceId
      && current.connectionId === expected.connectionId
      && current.ownerKey === expected.ownerKey;
  };
  const assetQueriesEnabled = networkMode && network.status === "ready" && !!network.locus && serviceId !== null;
  const catalogQuery = useQuery({
    queryKey: ["locus", "asset-catalog", network.networkId],
    queryFn: () => loadCuratedCatalog(network.networkId),
    enabled: networkMode,
    staleTime: 5 * 60_000,
    retry: assetQueryRetry,
    retryDelay: assetQueryRetryDelay,
  });
  const catalogMatchesDeployment = !!catalogQuery.data
    && catalogQuery.data.network === network.networkId
    && catalogQuery.data.serviceId === serviceId
    && network.deployment?.genesisHash !== undefined
    && catalogQuery.data.genesisHash.toLowerCase() === network.deployment.genesisHash.toLowerCase();
  const poolsQuery = useQuery({
    queryKey: poolListQueryKey(network.networkId, serviceId),
    queryFn: () => network.locus!.listPools(),
    enabled: networkMode && network.status === "ready" && !!network.locus && serviceId !== null,
    staleTime: 5_000,
    retry: false,
  });
  const pools = poolsQuery.data ?? [];
  const poolsError = poolsQuery.error ? poolListError(poolsQuery.error) : "";
  const refreshPools = () => queryClient.invalidateQueries({ queryKey: poolListQueryKey(network.networkId, serviceId) });
  const visibleRoutes: Page[] = ["assets", "send", "swap", "liquidity", "activity"];
  const assetIdsQuery = useQuery({
    queryKey: assetIdsQueryKey(network.networkId, serviceId ?? 0),
    queryFn: () => loadAssetIds(network.locus!),
    enabled: assetQueriesEnabled,
    staleTime: 60_000,
    retry: assetQueryRetry,
    retryDelay: assetQueryRetryDelay,
  });
  const listedAssetIds = assetIdsQuery.data ?? [];
  const metadataQueries = useQueries({ queries: listedAssetIds.map((assetId) => {
    const assetIdHex = toHex(assetId).toLowerCase();
    return {
      queryKey: assetMetadataQueryKey(network.networkId, serviceId ?? 0, assetIdHex),
      queryFn: () => loadAssetMetadataForId(network.locus!, assetId, catalogQuery.data ?? null, network.networkId, network.deployment),
      enabled: assetQueriesEnabled,
      staleTime: 60_000,
      retry: assetQueryRetry,
      retryDelay: assetQueryRetryDelay,
    };
  }) });
  const assetScope = serviceId === null ? `${network.networkId}:unresolved` : `${network.networkId}:${serviceId}`;
  const incomingMetadata = metadataQueries.flatMap((query) => query.data ? [query.data] : []);
  assetMetadataCache.current = keepAssetRowsForScope(assetMetadataCache.current, assetScope, incomingMetadata);
  const stableMetadata = assetMetadataCache.current.rows;
  const balanceQueries = useQueries({ queries: sessionOwner ? stableMetadata.map((asset) => {
    const assetId = asset.assetId;
    const assetIdHex = asset.assetIdHex;
    return {
      queryKey: assetBalanceQueryKey(network.networkId, serviceId ?? 0, formatLocusId(sessionOwner), assetIdHex),
      queryFn: () => loadAssetBalance(network.locus!, assetId, sessionOwner),
      enabled: assetQueriesEnabled,
      staleTime: 15_000,
      retry: assetQueryRetry,
      retryDelay: assetQueryRetryDelay,
    };
  }) : [] });
  const balancesByAsset = new Map<string, bigint>();
  const balanceStateByAsset = new Map<string, "known" | "loading" | "unavailable">();
  balanceQueries.forEach((query, index) => {
    const asset = stableMetadata[index];
    if (!asset) return;
    if (query.data !== undefined) {
      balancesByAsset.set(asset.assetIdHex.toLowerCase(), query.data);
      balanceStateByAsset.set(asset.assetIdHex.toLowerCase(), "known");
    } else if (sessionOwner && assetQueriesEnabled && (query.isLoading || query.isFetching)) {
      balanceStateByAsset.set(asset.assetIdHex.toLowerCase(), "loading");
    } else {
      balanceStateByAsset.set(asset.assetIdHex.toLowerCase(), "unavailable");
    }
  });
  const assets = useMemo(() => attachAssetBalances(stableMetadata, balancesByAsset, sessionOwner !== null), [balanceQueries, metadataQueries, sessionOwner, stableMetadata]);
  const assetsLoading = networkMode && assets.length === 0 && (assetIdsQuery.isLoading || (listedAssetIds.length > 0 && metadataQueries.some((query) => query.isLoading)));
  const assetsError = assetIdsQuery.error instanceof Error
    ? assetIdsQuery.error.message
    : listedAssetIds.length > 0 && metadataQueries.every((query) => query.isError) && assets.length === 0
      ? "Unable to load asset details."
      : "";
  function getAssetBalanceState(asset: AssetView): "known" | "loading" | "unavailable" {
    if (asset.balance !== null) return "known";
    return balanceStateByAsset.get(asset.assetIdHex.toLowerCase()) ?? "unavailable";
  }
  const refreshAssets = () => queryClient.invalidateQueries({ queryKey: ["locus", "assets"] });

  useEffect(() => evmBridge.start(window, document), [evmBridge]);
  useEffect(() => { evmBridge.updateAppKit(walletProvider, appKitAddress); }, [appKitAddress, evmBridge, walletProvider]);

  useEffect(() => {
    if (lifecycle !== "restoring") return;
    sessionRestoreTimeout.current = window.setTimeout(() => {
      if (lifecycleRef.current !== "restoring") return;
      sessionRestoreEpoch.current += 1;
      evmBridge.cancelConnection();
      sessionRestoreAbort.current?.abort();
      sessionRestoreAbort.current = null;
      matrixAuthAbort.current?.abort();
      matrixAuthAbort.current = null;
      finishRestore("Sign-in restoration timed out. You are not connected; your saved sign-in is still available. Try connecting again.");
    }, 30_000);
    return () => {
      if (sessionRestoreTimeout.current !== null) window.clearTimeout(sessionRestoreTimeout.current);
      sessionRestoreTimeout.current = null;
    };
  }, [evmBridge, finishRestore, lifecycle]);

  function openConnect() {
    setConnectOpen(true);
  }

  function openAccountSwitch() {
    const current = sessionRef.current;
    if (current?.kind === "evm") {
      void openAppKit({ view: "Account", namespace: "eip155" }).catch((cause: unknown) => {
        notify(cause instanceof Error ? cause.message : "Could not open the wallet account menu.");
      });
    } else if (current?.kind === "polkadot") {
      setPolkadotSwitchOpen(true);
    }
  }

  async function switchPolkadotAccount(address: string) {
    const previous = sessionRef.current;
    if (previous?.kind !== "polkadot") throw new Error("The Polkadot session changed. Reopen Account to switch accounts.");
    setSwitchingAccount(true);
    try {
      await switchPolkadotSession(
        previous,
        address,
        () => sessionRef.current,
        (selectedAddress) => connectBrowserSession("polkadot", selectedAddress),
        setSession,
      );
    } finally {
      setSwitchingAccount(false);
    }
  }

  useEffect(() => {
    if (oauthCallbackAttempted.current || !hasMatrixAuthCallback()) return;
    if (networkMode && (network.status !== "ready" || !network.locus)) return;
    oauthCallbackAttempted.current = true;
    let cancelled = false;
    let authenticationSucceeded = false;
    const abortController = new AbortController();
    matrixAuthAbort.current = abortController;
    void completeMatrixAuthCallback().then(async (stored) => {
      if (!stored) return;
      if (cancelled || abortController.signal.aborted) {
        void revokeMatrixOAuthSession(stored, false).catch(() => undefined);
        return;
      }
      authenticationSucceeded = true;
      provisionalMatrixAuth.current = stored;
      const connected = await connectMatrixTokenSession(stored, { locus: network.locus, signal: abortController.signal });
      if (cancelled || abortController.signal.aborted) { connected.session.cleanup?.(); return; }
      provisionalMatrixAuth.current = null;
      if (connected.state === "READY") setSession(connected.session);
      else {
        setPendingMatrixConnection(connected);
        setConnectOpen(true);
        finishRestore(matrixRestoreMessage(connected));
      }
    }).catch((cause) => {
      if (abortController.signal.aborted) return;
      const detail = cause instanceof Error ? cause.message : "Try signing in again.";
      finishRestore(authenticationSucceeded
        ? `Matrix authentication succeeded, but the local crypto device could not be initialized or registered. No Locus session is connected. ${detail}`
        : `Matrix sign-in could not be completed. No session is connected. ${detail}`);
    });
    return () => {
      cancelled = true;
      abortController.abort();
      if (matrixAuthAbort.current === abortController) matrixAuthAbort.current = null;
    };
  }, [finishRestore, network.locus, network.status, networkMode, setSession]);

  useEffect(() => {
    if (lifecycle !== "restoring" || sessionRestoreAttempted.current || oauthCallbackAttempted.current) return;
    let saved: { kind?: "evm" | "polkadot" | "solana"; address?: string; connectionId?: string } | null = null;
    const preferredKind = activeSessionKind(window.localStorage);
    try {
      if (preferredKind !== "matrix") {
        const stored = window.localStorage.getItem("locus.session.v1");
        if (stored) saved = JSON.parse(stored) as { kind?: "evm" | "polkadot" | "solana"; address?: string; connectionId?: string };
      }
    } catch {
      finishRestore("The saved wallet session could not be read. It has been kept so you can retry.");
      return;
    }
    // Restore the last selected Ownership first. A dormant Matrix login may
    // remain saved for later use, but must never override an EVM session that
    // the user explicitly connected after it.
    if (saved?.kind && saved.address) {
      sessionRestoreAttempted.current = true;
      const restoreId = ++sessionRestoreEpoch.current;
      if (saved.kind === "evm") {
        evmBridge.beginRestore(saved.address);
        return;
      }
      const restore = restoreBrowserSession(saved.kind, saved.connectionId ?? saved.address);
      void restore.then((restored) => {
        if (restoreId !== sessionRestoreEpoch.current) { restored.cleanup?.(); return; }
        if (restored.address.toLowerCase() !== saved!.address!.toLowerCase()) throw new Error("The restored wallet account changed.");
        setSession(restored);
      }).catch((cause) => {
        if (restoreId !== sessionRestoreEpoch.current) return;
        finishRestore(`Could not restore the wallet session. You remain disconnected. ${cause instanceof Error ? cause.message : "Try connecting again."}`);
      });
      return;
    }
    if (preferredKind && preferredKind !== "matrix") {
      sessionRestoreAttempted.current = true;
      finishRestore("The saved wallet session is no longer available. Choose a connection method to sign in again.");
      return;
    }
    const matrixStored = readStoredMatrixSession();
    if (matrixStored) {
      if (networkMode && (network.status === "error" || network.status === "unconfigured")) {
        sessionRestoreAttempted.current = true;
        finishRestore(`The saved Matrix sign-in remains available, but the selected Locus network is unavailable. ${network.error?.message ?? "Reconnect to the network and try again."}`);
        return;
      }
      if (networkMode && (network.status !== "ready" || !network.locus)) return;
      sessionRestoreAttempted.current = true;
      const restoreId = ++sessionRestoreEpoch.current;
      const abortController = new AbortController();
      sessionRestoreAbort.current = abortController;
      void restoreMatrixSession(matrixStored, { locus: network.locus, signal: abortController.signal }).then((connected) => {
        if (abortController.signal.aborted || restoreId !== sessionRestoreEpoch.current) { connected.session.cleanup?.(); return; }
        if (connected.state === "READY") setSession(connected.session);
        else {
          setPendingMatrixConnection(connected);
          if (matrixStateRequiresUserInteraction(connected.state, "restore")) setConnectOpen(true);
        }
      }).catch((cause) => {
        if (abortController.signal.aborted || restoreId !== sessionRestoreEpoch.current) return;
        finishRestore(`Could not restore the Matrix session. You remain disconnected. ${cause instanceof Error ? cause.message : "Try signing in again."}`);
      }).finally(() => {
        if (sessionRestoreAbort.current === abortController) sessionRestoreAbort.current = null;
      });
      return;
    }
    if (window.localStorage.getItem("locus.matrix.session.v1") || window.sessionStorage.getItem("locus.matrix.session.v1")) {
      sessionRestoreAttempted.current = true;
      finishRestore("The saved Matrix sign-in is incomplete and could not be read. No session is connected; sign out to clear it or try signing in again.");
      return;
    }
    sessionRestoreAttempted.current = true;
    finishRestore();
  }, [evmBridge, finishRestore, lifecycle, network.locus, network.status, networkMode, setSession, session]);

  useEffect(() => {
    const pending = pendingMatrixConnection;
    if (!pending || session) return;
    const settleRestore = () => {
      if (pending.state === "READY") {
        setSession(pending.session);
        setPendingMatrixConnection(null);
        setConnectOpen(false);
        finishRestore();
        return;
      }
      if (pending.state === "CONTROLLER_AUTHORIZING"
        || pending.state === "CONTROLLER_AUTHORIZATION_QUEUED"
        || pending.state === "CONTROLLER_AUTHORIZATION_FINALIZING") return;
      finishRestore(matrixRestoreMessage(pending));
    };
    const unsubscribe = pending.subscribe(settleRestore);
    settleRestore();
    return unsubscribe;
  }, [finishRestore, pendingMatrixConnection, session, setSession]);

  useEffect(() => {
    if (!session) return;
    if (session.kind === "matrix" || session.kind === "evm") return () => undefined;
    return watchBrowserSession(session, (address) => {
      if (!address || address.toLowerCase() !== session.address.toLowerCase()) {
        clearSession();
      }
    });
  }, [clearSession, session]);

  function disconnectSession() {
    markSessionDisconnected(window.localStorage);
    evmBridge.explicitDisconnect();
    setEvmConnectError("");
    provisionalMatrixAuth.current = null;
    try { session?.cleanup?.(); } catch { /* Local sign-out must complete even if a wallet cleanup fails. */ }
    if (pendingMatrixConnection && pendingMatrixConnection.session !== session) {
      try { pendingMatrixConnection.session.cleanup?.(); } catch { /* Continue clearing the provisional Matrix sign-in. */ }
    }
    setPendingMatrixConnection(null);
    finishRestore();
  }

  function signOutMatrix(storedOverride?: MatrixOAuthSession | null) {
    const stored = storedOverride ?? pendingMatrixConnection?.stored ?? readStoredMatrixSession() ?? provisionalMatrixAuth.current;
    provisionalMatrixAuth.current = null;
    matrixAuthAbort.current?.abort();
    matrixAuthAbort.current = null;
    try { session?.cleanup?.(); } catch { /* Continue local Matrix sign-out. */ }
    if (pendingMatrixConnection && pendingMatrixConnection.session !== session) {
      try { pendingMatrixConnection.session.cleanup?.(); } catch { /* Continue local Matrix sign-out. */ }
    }
    setPendingMatrixConnection(null);
    clearSession();
    finishRestore();
    void signOutMatrixSession(stored).catch((cause) => notify(cause instanceof Error ? cause.message : "Matrix sign-out cleanup needs attention."));
  }

  function cancelMatrixSignIn(connection: MatrixConnected | null) {
    const authenticated = connection ?? pendingMatrixConnection;
    const stored = authenticated?.stored ?? provisionalMatrixAuth.current ?? readStoredMatrixSession();
    if (authenticated && authenticated.session !== session) {
      try { authenticated.session.cleanup?.(); } catch { /* Retire the dialog's crypto client before changing its stored device state. */ }
    }
    if (authenticated && !authenticated.freshDevice) {
      disconnectSession();
      setConnectOpen(false);
      return;
    }
    if (authenticated || provisionalMatrixAuth.current) signOutMatrix(stored);
    else disconnectSession();
    setConnectOpen(false);
  }

  useEffect(() => {
    setSelectedAssetId(null);
    setAmount("");
    setAmountTouched(false);
    setRecipientTouched(false);
    setSendAttempted(false);
    setSendFormError("");
    setSendState({ status: "idle" });
  }, [network.networkId]);

  useEffect(() => {
    setAmount("");
    setAmountTouched(false);
    setRecipient("");
    setRecipientType("matrix");
    setMatrixRecipientState({ status: "idle" });
    setRecipientTouched(false);
    setSendAttempted(false);
    setSendFormError("");
    setSendState({ status: "idle" });
    setSelectedAssetId(null);
    setAssetSearch("");
    setAssetPickerOpen(false);
    setTypeOpen(false);
    setReviewOpen(false);
    setReceiveAsset(null);
    setCreateAssetOpen(false);
    setDetailAsset(null);
    setPolkadotSwitchOpen(false);
    setToast("");
  }, [session?.connectionId, session?.kind, session?.address]);

  useEffect(() => {
    if (!networkMode || !session) {
      setSessionActivity([]);
      return;
    }
    const key = sessionActivityKey(network.networkId, formatLocusId(session.owner));
    try {
      const stored = window.localStorage.getItem(key);
      setSessionActivity(stored ? JSON.parse(stored) as ActivityItem[] : []);
    } catch {
      setSessionActivity([]);
    }
  }, [network.networkId, networkMode, session]);

  const currentDemoAsset = demoAssets[demoAssetIndex];
  const currentNetworkAsset = assets.find((asset) => asset.assetIdHex === selectedAssetId) ?? assets[0] ?? null;
  const currentAsset = networkMode ? currentNetworkAsset : currentDemoAsset;
  const filteredAssets = useMemo(
    () => networkMode
      ? assets.filter((asset) => {
        const matchesClass = assetFilter === "all"
          || (assetFilter === "crypto" && asset.presentation.class === "crypto")
          || (assetFilter === "equities" && asset.presentation.class === "equity-demo")
          || (assetFilter === "custom" && asset.presentation.class === "custom");
        return matchesClass && (!search || `${asset.name} ${asset.symbol} ${asset.presentation.class} ${asset.assetIdHex}`.toLowerCase().includes(search.toLowerCase()));
      })
      : demoAssets.filter((asset) => !search || `${asset.name} ${asset.symbol}`.toLowerCase().includes(search.toLowerCase())),
    [assetFilter, assets, networkMode, search],
  );
  const currentResolution = useMemo(() => resolveRecipient(recipientType, recipient), [recipient, recipientType]);
  const resolvedRecipient = useMemo(() => {
    if (recipientType !== "matrix") return currentResolution;
    const userId = recipient.trim();
    const resolverUrl = network.network?.matrixResolverUrl;
    const scope = `${network.networkId}:${resolverUrl ?? ""}`;
    const state = "userId" in matrixRecipientState && matrixRecipientState.userId === userId && matrixRecipientState.scope === scope
      ? matrixRecipientState
      : { status: "idle" as const };
    if (state.status === "resolved") {
      return { ...currentResolution, ownership: state.ownership, valid: true, configured: true, detectedType: "matrix" as const, message: "Matrix Ownership verified." };
    }
    if (state.status === "resolving") return { ...currentResolution, valid: false, configured: true, message: "Resolving Matrix Ownership…" };
    if (state.status === "key-changed" || state.status === "unavailable" || state.status === "error") {
      return { ...currentResolution, valid: false, configured: true, message: state.message };
    }
    if (resolverUrl && isCompleteMatrixUserId(userId)) {
      return { ...currentResolution, valid: false, configured: true, message: "Waiting to resolve Matrix Ownership…" };
    }
    return currentResolution;
  }, [currentResolution, matrixRecipientState, network.network?.matrixResolverUrl, network.networkId, recipient, recipientType]);
  const recipientTextError = validateRecipientText(recipient, recipientType);
  const matrixResolutionPending = resolvedRecipient.message.startsWith("Resolving") || resolvedRecipient.message.startsWith("Waiting to resolve");
  const asyncRecipientError = recipientType === "matrix" && recipient.trim() && !resolvedRecipient.valid && !matrixResolutionPending && resolvedRecipient.configured
    ? resolvedRecipient.message
    : null;
  const recipientFieldError = recipientTouched || sendAttempted
    ? recipientTextError ?? asyncRecipientError ?? (!resolvedRecipient.valid && recipient.trim() && !matrixResolutionPending ? resolvedRecipient.message : null)
    : null;
  const amountFieldError = amountTouched || sendAttempted
    ? currentAsset ? validatePositiveAmount(amount, currentAsset.decimals, currentAsset.balance) : amount.trim() ? "Choose an asset first." : "Enter an amount."
    : null;

  useEffect(() => {
    const userId = recipient.trim();
    if (!networkMode || recipientType !== "matrix" || !isCompleteMatrixUserId(userId)) {
      setMatrixRecipientState({ status: "idle" });
      return;
    }
    const resolverUrl = network.network?.matrixResolverUrl;
    const scope = `${network.networkId}:${resolverUrl ?? ""}`;
    if (!resolverUrl) {
      setMatrixRecipientState({ status: "unavailable", userId, scope, message: "Matrix recipient resolver is not configured for this network." });
      return;
    }
    let active = true;
    const controller = new AbortController();
    setMatrixRecipientState({ status: "idle" });
    const timer = window.setTimeout(() => {
      if (!active) return;
      setMatrixRecipientState({ status: "resolving", userId, scope });
      resolveMatrixRecipient(userId, { resolverUrl, signal: controller.signal }).then((ownership) => {
        if (active) setMatrixRecipientState({ status: "resolved", userId, scope, ownership });
      }).catch((error: unknown) => {
        if (!active || controller.signal.aborted) return;
        const code = error && typeof error === "object" && "code" in error ? String((error as { code?: unknown }).code) : "";
        const message = error instanceof Error ? error.message : "Matrix master Ownership could not be resolved.";
        setMatrixRecipientState({
          status: code === "MATRIX_MASTER_KEY_CHANGED" ? "key-changed"
            : code === "CROSS_SIGNING_UNAVAILABLE" || code === "MATRIX_RESOLVER_UNCONFIGURED" ? "unavailable"
              : "error",
          userId,
          scope,
          message,
        });
      });
    }, MATRIX_RECIPIENT_DEBOUNCE_MS);
    return () => {
      active = false;
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [networkMode, network.network?.matrixResolverUrl, network.networkId, recipient, recipientType]);
  const activity = networkMode ? sessionActivity : [];
  const filteredActivity = activity.filter((entry) => includeActivityItem(entry.kind === "swap" ? "swap" : entry.direction, filter, BROWSER_LOCAL_ACTIVITY_CAPABILITIES));

  function notify(message: string) {
    setToast(message);
    window.setTimeout(() => setToast(""), 2600);
  }

  function chooseType(type: RecipientType) {
    setRecipientType(type);
    setTypeOpen(false);
  }

  function changeRecipient(value: string) {
    setRecipient(value);
    const detected = detectRecipientType(value);
    if (detected) setRecipientType(detected);
  }

  function chooseNetworkAsset(asset: AssetView) {
    if (sendState.status === "awaiting-signature" || sendState.status === "submitting" || sendState.status === "submitted") {
      navigateToPage("send");
      return;
    }
    setSelectedAssetId(asset.assetIdHex);
    setAmount("");
    setAmountTouched(false);
    setSendAttempted(false);
    setSendFormError("");
    setSendState({ status: "idle" });
    navigateToPage("send");
  }

  function updateRecipient(value: string) {
    if (sendState.status === "awaiting-signature" || sendState.status === "submitting" || sendState.status === "submitted") return;
    changeRecipient(value);
    setSendState({ status: "idle" });
    setSendFormError("");
  }

  function updateAmount(value: string) {
    if (sendState.status === "awaiting-signature" || sendState.status === "submitting" || sendState.status === "submitted") return;
    setAmount(value);
    setSendState({ status: "idle" });
    setSendFormError("");
  }

  function continueSend() {
    setSendAttempted(true);
    setSendFormError("");
    const assetForSend = networkMode ? currentNetworkAsset : currentDemoAsset;
    if (!assetForSend) { setSendFormError("No asset is available on this network."); return; }
    if (recipientTextError || validatePositiveAmount(amount, assetForSend.decimals, assetForSend.balance)) return;
    if (!networkMode) { notify(`Demo: send ${amount} ${currentDemoAsset.symbol} to ${recipient}`); return; }
    if (!("assetId" in assetForSend)) { setSendFormError("No network asset is selected."); return; }
    if (network.status !== "ready" || !locus) { setSendFormError("The selected network is unavailable. Retry the connection before sending."); return; }
    if (!session) { openConnect(); return; }
    if (!resolvedRecipient.valid || !resolvedRecipient.ownership) return;
    let parsedAmount: bigint;
    try { parsedAmount = parseUnits(amount, assetForSend.decimals); } catch { return; }
    if (assetForSend.balance === null || parsedAmount > assetForSend.balance) return;
    setReviewOpen(true);
  }

  async function confirmSend() {
    const assetForSend = currentNetworkAsset;
    if (!assetForSend || !locus || !session || !resolvedRecipient.ownership) return;
    const destinationOwner = resolvedRecipient.ownership;
    let parsedAmount: bigint;
    try { parsedAmount = parseUnits(amount, assetForSend.decimals); } catch { return; }
    const submittedNetwork = network.networkId;
    const expectedScope: LiquidityScope = {
      networkId: submittedNetwork,
      serviceId,
      connectionId: session.connectionId ?? null,
      ownerKey: toHex(ownershipKey(session.owner)).toLowerCase(),
    };
    setReviewOpen(false);
    let submittedTransactionId = "";
    try {
      setSendState({ status: "awaiting-signature" });
      const applied = await transferAndWait(locus, assetForSend.assetId, destinationOwner, parsedAmount, submittedNetwork, (submitted) => {
        submittedTransactionId = submitted.transactionId;
        publishTransactionNotice({
          id: "send-transaction",
          title: "Transfer pending",
          message: "Waiting for confirmation.",
          transactionId: submitted.transactionId,
          busy: true,
        });
        if (isLiquidityScopeCurrent(expectedScope)) setSendState({ status: "submitted", transactionId: submitted.transactionId, actionHash: submitted.actionHash, networkId: submittedNetwork });
      });
      clearTransactionNotice("send-transaction");
      if (!isLiquidityScopeCurrent(expectedScope)) return;
      setSendState(applied);
      const nextActivity = [{ direction: "sent" as const, asset: assetForSend.symbol, recipient, amount: formatUnits(parsedAmount, assetForSend.decimals), transactionId: applied.transactionId }, ...sessionActivity];
      setSessionActivity(nextActivity);
      try { window.localStorage.setItem(sessionActivityKey(submittedNetwork, formatLocusId(session.owner)), JSON.stringify(nextActivity)); } catch { /* A local activity write cannot change transaction finality. */ }
      void refreshAssets();
      notify("Sent");
    } catch (error) {
      if (submittedTransactionId) {
        publishTransactionNotice({
          id: "send-transaction",
          title: "Transfer failed",
          message: normalizeActionError(error, "The transfer could not be completed."),
          transactionId: submittedTransactionId,
          tone: "error",
          dismissible: true,
        });
      } else clearTransactionNotice("send-transaction");
      if (isLiquidityScopeCurrent(expectedScope)) {
        setSendState({ status: "failed", error: normalizeActionError(error, "Transaction failed."), networkId: submittedNetwork, ...(submittedTransactionId ? { transactionId: submittedTransactionId } : {}) });
      }
    }
  }

  function recordSwap(item: { assetIn: string; assetOut: string; amountIn: string; amountOut: string; transactionId: string; networkId: string }) {
    if (!session || networkIdRef.current !== item.networkId) return;
    const nextActivity: ActivityItem[] = [{
      kind: "swap",
      assetIn: item.assetIn,
      assetOut: item.assetOut,
      amountIn: item.amountIn,
      amountOut: item.amountOut,
      transactionId: item.transactionId,
    }, ...sessionActivity];
    setSessionActivity(nextActivity);
    try { window.localStorage.setItem(sessionActivityKey(item.networkId, formatLocusId(session.owner)), JSON.stringify(nextActivity)); } catch { /* A local activity write cannot change transaction finality. */ }
    void refreshAssets();
  }

  return (
    <div className="app-shell" data-locus-mode={network.mode}>
      <aside className="sidebar">
        <div className="brand">locus</div>
        <nav aria-label="Primary">
          {visibleRoutes.map((entry) => (
            <button type="button" className={page === entry || (entry === "liquidity" && page === "liquidity-new") ? "nav-item active" : "nav-item"} key={entry} aria-current={page === entry || (entry === "liquidity" && page === "liquidity-new") ? "page" : undefined} onClick={() => navigateToPage(entry)}>
              <span className="nav-icon" aria-hidden="true">{entry === "send" ? <Send size={17} /> : entry === "assets" ? <Coins size={17} /> : entry === "swap" ? <ArrowLeftRight size={17} /> : entry === "liquidity" ? <Droplets size={17} /> : <History size={17} />}</span><span className="nav-label">{entry[0].toUpperCase() + entry.slice(1)}</span>
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          {networkMode ? <NetworkSwitcher /> : <div className="demo-footer"><span className="status-dot ready" />Demo Mode</div>}
        </div>
      </aside>

      <MobileNavigation route={page} onNavigate={navigateToPage}>
            <ThemeControl />
            {networkMode
              ? <NetworkSwitcher compact />
              : <span className="mobile-demo-indicator"><span className="status-dot ready" aria-hidden="true" />Demo</span>}
            <AccountMenu session={session} lifecycle={lifecycle} restoreError={restoreError} pendingKind={walletConnectPending} onConnect={openConnect} onSwitchAccount={openAccountSwitch} switchingAccount={switchingAccount} onDisconnect={disconnectSession} onRemoveMatrixDevice={() => signOutMatrix()} />
      </MobileNavigation>

      <main className="main">
        <header className="topbar">
          <ThemeControl />
          <AccountMenu session={session} lifecycle={lifecycle} restoreError={restoreError} pendingKind={walletConnectPending} onConnect={openConnect} onSwitchAccount={openAccountSwitch} switchingAccount={switchingAccount} onDisconnect={disconnectSession} onRemoveMatrixDevice={() => signOutMatrix()} />
        </header>

        {networkMode && network.status !== "ready" && (
          <section className="connection-card card">
            <div><strong>{network.error?.category === "DEPLOYMENT_UNAVAILABLE" ? `${network.network?.label ?? "Network"} is not configured` : `Unable to connect to ${network.network?.label ?? "network"}`}</strong><p>{networkErrorMessage(network.error, network.error?.endpoint)}</p></div>
            {network.status === "error" && <ActionButton variant="secondary" icon={RefreshCw} onClick={network.reconnect}>Retry</ActionButton>}
          </section>
        )}

        {page === "send" && <SendPage networkMode={networkMode} status={network.status} asset={currentAsset} assets={assets} assetSearch={assetSearch} assetPickerOpen={assetPickerOpen} recipientType={recipientType} recipient={recipient} recipientError={recipientFieldError} recipientMessage={recipient.trim() && (resolvedRecipient.valid || matrixResolutionPending) ? resolvedRecipient.message : ""} amount={amount} amountError={amountFieldError} formError={sendFormError} typeOpen={typeOpen} resolution={resolvedRecipient} sendState={sendState} onSearchAssets={setAssetSearch} onToggleAssets={setAssetPickerOpen} onSelectAsset={(asset) => { chooseNetworkAsset(asset); setAssetSearch(""); }} onChooseType={chooseType} onToggleTypes={setTypeOpen} onRecipient={(value) => { updateRecipient(value); setRecipientTouched(false); }} onRecipientBlur={() => setRecipientTouched(true)} onAmount={updateAmount} onAmountBlur={() => setAmountTouched(true)} onMax={() => { updateAmount(currentAsset ? displayAmount(networkMode ? currentNetworkAsset?.balance ?? null : currentDemoAsset.balance, currentAsset.decimals) : ""); setAmountTouched(true); }} onContinue={continueSend} onCycleDemo={() => setDemoAssetIndex((value) => (value + 1) % demoAssets.length)} onClear={() => updateRecipient("")} />}
        {page === "assets" && <AssetsPage networkMode={networkMode} loading={assetsLoading} error={assetsError} assets={filteredAssets} featuredAssets={assets.filter((asset) => asset.presentation.curated).slice(0, 6)} search={search} setSearch={setSearch} filter={assetFilter} setFilter={setAssetFilter} getBalanceState={getAssetBalanceState} onRetry={() => void refreshAssets()} onCreate={() => { if (!session) { openConnect(); return; } setCreateAssetOpen(true); }} onOpenDetail={setDetailAsset} />}
        {page === "swap" && <>
          <SwapPage networkMode={networkMode} networkId={network.networkId} status={network.status} serviceId={serviceId} locus={locus} assets={assets} pools={pools} poolLoading={poolsQuery.isLoading} poolError={poolsError} sessionOwner={sessionOwner} connectionId={session?.connectionId ?? null} isScopeCurrent={isLiquidityScopeCurrent} onConnect={openConnect} onApplied={recordSwap} onNotify={notify} onTransactionNotice={publishTransactionNotice} onClearTransactionNotice={clearTransactionNotice} onRefreshAssets={refreshAssets} onRefreshPools={refreshPools} />
        </>}
        {(page === "liquidity" || page === "liquidity-new") && <LiquidityPage key={page} view={page === "liquidity-new" ? "new" : "home"} initialTab={liquidityTab} initialPair={{ assetA: new URLSearchParams(window.location.search).get("assetA") ?? "", assetB: new URLSearchParams(window.location.search).get("assetB") ?? "" }} assets={assets} pools={pools} poolsError={poolsError} poolsLoading={poolsQuery.isLoading} locus={locus} networkId={network.networkId} serviceId={serviceId} sessionOwner={sessionOwner} connectionId={session?.connectionId ?? null} networkReady={networkMode && network.status === "ready"} isScopeCurrent={isLiquidityScopeCurrent} onPoolsRefreshed={(next) => queryClient.setQueryData(poolListQueryKey(network.networkId, serviceId), next)} onRefreshAssets={refreshAssets} onConnect={openConnect} onNewPosition={navigateToLiquidityNew} onTabChange={updateLiquidityTab} onActionSuccess={(message) => notify(message)} onTransactionNotice={publishTransactionNotice} onClearTransactionNotice={clearTransactionNotice} onRetryPools={() => void refreshPools()} getBalanceState={getAssetBalanceState} />}
        {page === "activity" && <ActivityPage networkMode={networkMode} filter={filter} setFilter={setFilter} rows={filteredActivity} />}
      </main>
      <GlobalNotifications toast={toast} notices={transactionNotices} onDismiss={clearTransactionNotice} />
      <ConnectDialog open={connectOpen} onClose={() => { evmBridge.cancelConnection(); setWalletConnectPending(null); setConnectOpen(false); }} onCancelMatrix={cancelMatrixSignIn} onMatrixSelected={() => setActiveSessionKind(window.localStorage, "matrix")} onConnected={(next) => { setWalletConnectPending(null); setSession(next); if (next.kind === "matrix") setPendingMatrixConnection(null); }} onConnectionPendingChange={setWalletConnectPending} onEvmConnectRequested={async () => {
        setActiveSessionKind(window.localStorage, "evm");
        setWalletConnectPending("evm");
        setEvmConnectError("");
        const reconnected = await evmBridge.beginConnection();
        // AppKit can restore a connection marker from browser storage before
        // its EIP-1193 provider is usable. Its modal then refuses to open as
        // "already connected". Clear only that stale EVM adapter connection
        // so the user can select MetaMask and authorize it again.
        if (!reconnected && appKitEvmConnected) {
          evmBridge.cancelConnection();
          await disconnectAppKit({ namespace: "eip155" });
        }
        return reconnected;
      }} onEvmConnectCancelled={() => { evmBridge.cancelConnection(); setWalletConnectPending(null); }} evmError={evmConnectError} evmAccountAvailable={Boolean(walletProvider && appKitAddress)} locus={network.locus} initialMatrixConnection={connectOpen ? pendingMatrixConnection : null} />
      <PolkadotAccountSwitchDialog open={polkadotSwitchOpen} currentAccount={session?.kind === "polkadot" ? session.address : ""} onClose={() => setPolkadotSwitchOpen(false)} onSelect={switchPolkadotAccount} />
      {networkMode && currentNetworkAsset && <ReviewDialog open={reviewOpen} asset={currentNetworkAsset} amount={amount} recipient={recipient} resolution={resolvedRecipient} onClose={() => setReviewOpen(false)} onConfirm={confirmSend} />}
      <ReceiveDialog open={receiveAsset !== null} asset={receiveAsset} session={session} onClose={() => setReceiveAsset(null)} />
      <CreateAssetDialog open={createAssetOpen} locus={networkMode ? locus : null} session={session} networkId={network.networkId} serviceId={network.deployment?.serviceId ?? null} onClose={() => setCreateAssetOpen(false)} onCreated={() => void refreshAssets()} />
      <AssetDetailModal asset={detailAsset} networkMode={networkMode} getBalanceState={getAssetBalanceState} onClose={() => setDetailAsset(null)} onReceive={(asset) => { setDetailAsset(null); setReceiveAsset(asset); }} onSend={(asset) => { setDetailAsset(null); if (networkMode && "assetId" in asset) chooseNetworkAsset(asset); else { setDemoAssetIndex(demoAssets.indexOf(asset as DemoAsset)); navigateToPage("send"); } }} />
    </div>
  );
}

function SendPage({ networkMode, status, asset, assets, assetSearch, assetPickerOpen, recipientType, recipient, recipientError, recipientMessage, amount, amountError, formError, typeOpen, resolution, sendState, onSearchAssets, onToggleAssets, onSelectAsset, onChooseType, onToggleTypes, onRecipient, onRecipientBlur, onAmount, onAmountBlur, onMax, onContinue, onCycleDemo, onClear }: {
  networkMode: boolean;
  status: string;
  asset: AssetView | DemoAsset | null;
  assets: AssetView[];
  assetSearch: string;
  assetPickerOpen: boolean;
  recipientType: RecipientType;
  recipient: string;
  recipientError: string | null;
  recipientMessage: string;
  amount: string;
  amountError: string | null;
  formError: string;
  typeOpen: boolean;
  resolution: ReturnType<typeof resolveRecipient>;
  sendState: SendState;
  onSearchAssets: (value: string) => void;
  onToggleAssets: (open: boolean) => void;
  onSelectAsset: (asset: AssetView) => void;
  onChooseType: (type: RecipientType) => void;
  onToggleTypes: (open: boolean) => void;
  onRecipient: (value: string) => void;
  onRecipientBlur: () => void;
  onAmount: (value: string) => void;
  onAmountBlur: () => void;
  onMax: () => void;
  onContinue: () => void;
  onCycleDemo: () => void;
  onClear: () => void;
}) {
  const decimals = asset?.decimals ?? 0;
  const balance = asset?.balance ?? null;
  const busy = sendState.status === "awaiting-signature" || sendState.status === "submitting" || sendState.status === "submitted";
  const sendLabel = sendState.status === "awaiting-signature" ? "Approve in wallet…"
    : sendState.status === "submitting" ? "Submitting…"
      : sendState.status === "submitted" ? "Waiting for confirmation…"
        : sendState.status === "applied" ? "Sent" : "Review transfer";
  return <section className="page send-page">
    <div className="card send-card">
      <div className="send-amount-field">
        <AssetAmountInput
          className="send-asset-amount"
          selector={<AssetPicker networkMode={networkMode} asset={asset} assets={assets} search={assetSearch} open={assetPickerOpen} onOpenChange={onToggleAssets} onSearch={onSearchAssets} onSelect={onSelectAsset} onCycleDemo={onCycleDemo} variant="compact" />}
          label="Amount to send"
          balance={balance === null ? "Balance unavailable" : `Balance: ${displayAmount(balance, decimals)} ${asset?.symbol ?? ""}`.trim()}
          id="send-amount"
          amount={amount}
          disabled={busy}
          onAmountChange={onAmount}
          onAmountBlur={onAmountBlur}
          onMax={onMax}
          maxDisabled={!asset || asset.balance === null}
          placeholder="0"
          ariaLabel="Amount to send"
          ariaInvalid={Boolean(amountError)}
          ariaDescribedBy={amountError ? "send-amount-error" : undefined}
        />
        <FieldMessage id="send-amount-error" error={amountError} />
      </div>
      <OwnershipInput type={recipientType} value={recipient} open={typeOpen} networkMode={networkMode} message={recipientMessage} valid={resolution.valid} error={recipientError} onBlur={onRecipientBlur} onType={onChooseType} onToggle={onToggleTypes} onChange={onRecipient} onClear={onClear} disabled={busy} />
      {formError && <p className="action-status action-status--error" role="alert">{formError}</p>}
      <ActionButton variant="primary" icon={ArrowUpRight} fullWidth disabled={!asset || busy || sendState.status === "applied" || (networkMode && status !== "ready")} onClick={onContinue}>{sendLabel}</ActionButton>
      {sendState.status === "failed" && !sendState.transactionId && <div className="transaction-error" role="alert">{sendState.error}</div>}
    </div>
  </section>;
}

function AssetsPage({ networkMode, loading, error, assets, featuredAssets, search, setSearch, filter, setFilter, getBalanceState, onRetry, onOpenDetail, onCreate }: { networkMode: boolean; loading: boolean; error: string; assets: (AssetView | DemoAsset)[]; featuredAssets: AssetView[]; search: string; setSearch: (value: string) => void; filter: "all" | "crypto" | "equities" | "custom"; setFilter: (value: "all" | "crypto" | "equities" | "custom") => void; getBalanceState: (asset: AssetView) => "known" | "loading" | "unavailable"; onRetry: () => void; onOpenDetail: (asset: AssetView | DemoAsset) => void; onCreate: () => void }) {
  const filters = [
    { id: "all", label: <span className="asset-filter-option"><List size={16} aria-hidden="true" /><span>All</span></span>, textValue: "All" },
    { id: "crypto", label: <span className="asset-filter-option"><Coins size={16} aria-hidden="true" /><span>Crypto</span></span>, textValue: "Crypto" },
    { id: "equities", label: <span className="asset-filter-option"><TrendingUp size={16} aria-hidden="true" /><span>Equities</span></span>, textValue: "Equities" },
    { id: "custom", label: <span className="asset-filter-option"><Shapes size={16} aria-hidden="true" /><span>Custom</span></span>, textValue: "Custom" },
  ] as const;
  return <section className="page">
    <div className={`assets-toolbar${networkMode ? " assets-toolbar--network" : ""}`}>
      <div className="assets-toolbar-controls">
        {networkMode && <ResponsiveSelect id="asset-filter" ariaLabel="Filter assets" value={filter} onValueChange={(value) => setFilter(value as typeof filter)} options={filters.map((entry) => ({ value: entry.id, label: entry.label, textValue: entry.textValue }))} />}
        <label className="assets-search"><Search size={17} aria-hidden="true" /><input className="search" aria-label="Search assets" value={search} placeholder="Search assets..." onChange={(event) => setSearch(event.target.value)} /></label>
      </div>
      {networkMode && <ActionButton className="assets-create-action" variant="secondary" icon={CirclePlus} onClick={onCreate}>Create asset</ActionButton>}
    </div>
    <div className="assets-layout"><div>
      {error && <div className="empty-state" role="alert">{error}<ActionButton size="small" variant="tertiary" icon={RefreshCw} onClick={onRetry}>Try again</ActionButton></div>}
      {loading && assets.length === 0 && <AssetListSkeleton />}
      {!error && !loading && assets.length === 0 && <div className="empty-state">{networkMode ? "No matching assets on this network." : "No demo assets found."}</div>}
      {assets.length > 0 && <div className="card asset-list">{assets.map((entry) => {
        const isNetworkAsset = "assetIdHex" in entry;
        const id = isNetworkAsset ? entry.assetIdHex : entry.symbol;
        const balanceStatus = isNetworkAsset ? getBalanceState(entry) : "known";
        const amountText = entry.balance === null ? "" : formatAssetListAmount(entry.balance, entry.decimals);
        return <div className="asset-row" key={id} role="button" tabIndex={0} onClick={() => onOpenDetail(entry)} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); onOpenDetail(entry); } }}>
          {isNetworkAsset ? <AssetIcon asset={entry} size={40} /> : <span className="coin small-coin" style={{ background: entry.color }}>{entry.symbol[0]}</span>}
          <span className="asset-row-info"><strong>{entry.name}</strong><small>{entry.symbol}</small></span>
          <span className="asset-row-balance">{balanceStatus === "loading" ? <Skeleton width={82} height={17} aria-label="Loading balance" /> : balanceStatus === "unavailable" ? <span className="asset-balance-unavailable">Unavailable</span> : <strong>{amountText}</strong>}</span>
        </div>;
      })}</div>}
    </div><aside className="latest-assets"><h2>Featured Assets</h2><div className="card latest-list">{featuredAssets.length === 0 ? <div className="empty-state">Curated test assets will appear after their catalog and on-chain metadata match.</div> : featuredAssets.map((asset) => <button type="button" className="latest-asset" key={asset.assetIdHex} onClick={() => onOpenDetail(asset)}><AssetIcon asset={asset} size={36} /><span><strong>{asset.symbol}</strong><small>{asset.name} · {asset.presentation.badge}</small></span><span className="latest-chevron">›</span></button>)}</div></aside></div>
  </section>;
}

function AssetListSkeleton() {
  return <div className="card asset-list asset-list-skeleton" aria-label="Loading assets" aria-busy="true">{Array.from({ length: 5 }, (_, index) => <div className="asset-row" key={index}><Skeleton circle width={40} height={40} /><span className="asset-row-info"><Skeleton width="58%" height={18} /></span><span className="asset-row-balance"><Skeleton width={90} height={18} /></span></div>)}</div>;
}

function AssetDetailModal({ asset, networkMode, getBalanceState, onClose, onReceive, onSend }: { asset: AssetView | DemoAsset | null; networkMode: boolean; getBalanceState: (asset: AssetView) => "known" | "loading" | "unavailable"; onClose: () => void; onReceive: (asset: AssetView | DemoAsset) => void; onSend: (asset: AssetView | DemoAsset) => void }) {
  if (!asset) return null;
  const isNetworkAsset = "assetIdHex" in asset;
  const totalSupply = isNetworkAsset ? (asset.presentation.unit === "shares" ? `${formatUnits(asset.totalSupply, asset.decimals)} shares` : `${formatUnits(asset.totalSupply, asset.decimals)} ${asset.symbol}`) : "Demo data";
  const balance = isNetworkAsset
    ? getBalanceState(asset) === "loading" ? "Loading balance…" : getBalanceState(asset) === "unavailable" ? "Balance unavailable" : displayAssetAmount(asset)
    : `${displayAmount(asset.balance, asset.decimals)} ${asset.symbol}`;
  return <Modal open title={`${asset.symbol} details`} onClose={onClose} footer={<><ActionButton variant="secondary" icon={ArrowDownLeft} onClick={() => onReceive(asset)}>Receive</ActionButton><ActionButton variant="primary" icon={Send} onClick={() => onSend(asset)}>Send</ActionButton></>}>
    <div className="detail-modal">
      <div className="asset-detail-icon">{isNetworkAsset ? <AssetIcon asset={asset} size={64} /> : <span className="coin detail-coin" style={{ background: asset.color }}>{asset.symbol[0]}</span>}</div>
      <h2>{asset.name}</h2>
      <p className="muted">{asset.symbol}{isNetworkAsset && ` · ${asset.presentation.badge}`}</p>
      <div className="asset-detail-balance"><small>Balance</small><strong>{balance}</strong></div>
      <details className="asset-detail-more">
        <summary>More</summary>
        <dl>
          <div><dt>Decimals</dt><dd>{asset.decimals}</dd></div>
          <div><dt>Total supply</dt><dd>{totalSupply}</dd></div>
          {!networkMode && <div><dt>Value</dt><dd>{(asset as DemoAsset).value}</dd></div>}
          {isNetworkAsset && <>
            <div><dt>Asset class</dt><dd>{asset.presentation.class}</dd></div>
            <div className="asset-detail-copy"><CopyableValue label="Issuer" value={formatLocusId(asset.issuer)} layout="inline" copyPlacement="left" /></div>
            <div className="asset-detail-copy"><CopyableValue label="Asset ID" value={asset.assetIdHex} layout="inline" copyPlacement="left" /></div>
          </>}
        </dl>
        {isNetworkAsset && asset.presentation.disclosure && asset.symbol !== "DOT" && <p className="asset-detail-disclosure">{asset.presentation.disclosure}</p>}
      </details>
    </div>
  </Modal>;
}

function ActivityPage({ networkMode, filter, setFilter, rows }: { networkMode: boolean; filter: "all" | "sent" | "swap"; setFilter: (value: "all" | "sent" | "swap") => void; rows: ActivityItem[] }) {
  const filters = activityFilters(BROWSER_LOCAL_ACTIVITY_CAPABILITIES).map((entry) => {
    const Icon = entry.value === "all" ? ListFilter : entry.value === "sent" ? ArrowUpRight : ArrowLeftRight;
    return { value: entry.value, label: <><Icon size={16} aria-hidden="true" /><span>{entry.label}</span></>, textValue: entry.label };
  });
  return <section className="page">
    {networkMode && <SegmentedControl className="activity-filter-tabs" ariaLabel="Filter activity" value={filter} onValueChange={(value) => setFilter(value as typeof filter)} options={filters} />}
    {rows.length === 0
      ? <div className="card empty-state">{networkMode ? "No recent transactions in this browser yet. Incoming transfers and complete history are not indexed here." : "No network activity is available in Demo mode."}</div>
      : <div className="card activity-list" role="region" aria-label="Activity history table" tabIndex={0}><div className="activity-table" role="table" aria-label="Activity">
        <div className="activity-row activity-row--header" role="row">
          <span role="columnheader">Type</span>
          <span role="columnheader">Asset / Pair</span>
          <span role="columnheader" className="activity-amount-heading">Amount</span>
          <span role="columnheader">Recipient</span>
          <span role="columnheader">Transaction</span>
        </div>
        {rows.map((entry, index) => {
          const isSwap = entry.kind === "swap";
          const key = entry.transactionId ?? `activity-${index}`;
          return <div className={`activity-row${isSwap ? " activity-row--swap" : ""}`} key={key} role="row">
            <span className={`activity-kind${isSwap ? " activity-kind--swap" : " activity-kind--sent sent"}`} role="cell">
              {isSwap ? <><ArrowLeftRight size={15} aria-hidden="true" /> Swapped</> : <><ArrowUpRight size={15} aria-hidden="true" /> Sent</>}
            </span>
            <strong className="activity-assets" role="cell">{isSwap ? `${entry.assetIn} → ${entry.assetOut}` : entry.asset}</strong>
            <strong className="activity-amount" role="cell">{isSwap
              ? `${activityAmount(entry.amountIn, entry.assetIn)} → ${activityAmount(entry.amountOut, entry.assetOut)}`
              : activityAmount(entry.amount, entry.asset)}</strong>
            <span className="activity-recipient" role="cell">{isSwap ? <span className="activity-empty-value">—</span> : <CopyableValue value={entry.recipient} layout="inline" />}</span>
            <span className="activity-transaction" role="cell">{entry.transactionId ? <CopyableValue value={entry.transactionId} layout="inline" /> : <span className="activity-empty-value">—</span>}</span>
          </div>;
        })}
      </div></div>}
  </section>;
}
