import { useEffect, useMemo, useRef, useState } from "react";
import { useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import Skeleton from "react-loading-skeleton";
import "react-loading-skeleton/dist/skeleton.css";
import { formatLocusId, formatUnits, minimumAmountOut, parseUnits, quoteExactIn, toHex, type LocusClient, type Pool } from "@archelabs/locus";
import { ArrowDownLeft, ArrowLeftRight, ArrowUpRight, CirclePlus, Coins, History, RefreshCw, Send, X } from "lucide-react";
import { useNetwork } from "./network/NetworkProvider.js";
import { NetworkSwitcher } from "./network/NetworkSwitcher.js";
import { loadAssetBalance, loadAssetIds, loadAssetMetadataForId, loadCuratedCatalog, displayAmount, displayAssetAmount, type AssetMetadata, type AssetView } from "./locus/assets.js";
import { assetBalanceQueryKey, assetIdsQueryKey, assetMetadataQueryKey, assetQueryRetry, assetQueryRetryDelay } from "./locus/assetQueries.js";
import { attachAssetBalances, keepAssetRowsForScope } from "./locus/assetCache.js";
import { resolveRecipient, detectRecipientType, type RecipientType } from "./locus/recipients.js";
import { transferAndWait, type SendState } from "./locus/transaction.js";
import { useSession } from "./session/SessionProvider.js";
import { connectEvmProvider, restoreBrowserSession, watchBrowserSession } from "./session/connectors.js";
import { activeSessionKind, markSessionDisconnected, setActiveSessionKind } from "./session/sessionPersistence.js";
import { EvmSessionBridge } from "./session/EvmSessionBridge.js";
import { ConnectDialog } from "./session/ConnectDialog.js";
import { CreateAssetDialog, ReceiveDialog, ReviewDialog } from "./locus/dialogs.js";
import { AssetPicker } from "./locus/AssetPicker.js";
import { Modal } from "./components/Modal.js";
import { AccountMenu } from "./components/AccountMenu.js";
import { ActionButton } from "./components/ActionButton.js";
import { AssetIcon } from "./components/AssetIcon.js";
import { readStoredMatrixSession, restoreMatrixSession, connectMatrixTokenSession, signOutMatrixSession, type MatrixConnected } from "./matrix/MatrixConnector.js";
import { resolveMatrixRecipient } from "./matrix/MatrixRecipientResolver.js";
import { completeMatrixAuthCallback, hasMatrixAuthCallback, revokeMatrixOAuthSession, type MatrixOAuthSession } from "./matrix/MatrixOAuth.js";
import { useAppKitAccount, useAppKitProvider } from "@reown/appkit/react";
import type { Eip1193Provider } from "@jamscript/client";
import { OwnershipInput } from "./locus/OwnershipInput.js";
import { ThemeControl } from "./theme/ThemeControl.js";

type Page = "send" | "assets" | "swap" | "activity";
type DemoAsset = { symbol: string; name: string; balance: bigint; decimals: number; value: string; color: string };
type ActivityItem = { kind?: "transfer"; direction: "sent" | "received"; asset: string; recipient: string; amount: string; date: string; transactionId?: string }
  | { kind: "swap"; assetIn: string; assetOut: string; amountIn: string; amountOut: string; date: string; transactionId?: string };

const demoAssets: DemoAsset[] = [
  { symbol: "DOT", name: "Dot Token", balance: 12450n, decimals: 0, value: "≈ $623.40", color: "#247eaa" },
  { symbol: "MINI", name: "Mini Token", balance: 2400n, decimals: 0, value: "≈ $240.00", color: "#8555df" },
  { symbol: "USDX", name: "Dollar Token", balance: 1250n, decimals: 0, value: "≈ $1,250.00", color: "#18a56b" },
  { symbol: "NOTE", name: "Note Token", balance: 340n, decimals: 0, value: "≈ $29.10", color: "#7c8798" },
];

const demoActivity: ActivityItem[] = [
  { direction: "sent", asset: "DOT", recipient: "@bob:matrix.org", amount: "100 DOT", date: "Today, 10:24 AM" },
  { direction: "sent", asset: "DOT", recipient: "@charlie", amount: "50 DOT", date: "Today, 9:17 AM" },
  { direction: "sent", asset: "DOT", recipient: "0x71C7…8976", amount: "200 DOT", date: "Apr 22, 11:03 AM" },
  { direction: "received", asset: "DOT", recipient: "locus:AbCdEf…", amount: "320 DOT", date: "Apr 20, 9:12 AM" },
];

function sessionActivityKey(networkId: string, owner: string): string {
  return `locus.activity.v1.${networkId}.${owner}`;
}

function matrixRestoreMessage(connected: MatrixConnected): string {
  if (connected.state === "CONTROLLER_BOOTSTRAP_QUEUED") {
    return "Matrix verification is complete. The controller authorization is queued in MiniJAM; Locus will keep checking it. Do not repeat verification.";
  }
  if (connected.state === "CONTROLLER_BOOTSTRAP_UNKNOWN") {
    return "Matrix verification is complete. The controller authorization status is temporarily unavailable; use Check authorization status in the Matrix dialog. Do not repeat verification.";
  }
  if (connected.state === "CONTROLLER_BOOTSTRAPPING" || connected.state === "CONTROLLER_BOOTSTRAP_FINALIZING") {
    return "Matrix verification is complete. Locus is waiting for the controller authorization transaction to finalize on MiniJAM. Keep the Matrix dialog open.";
  }
  if (connected.state === "CONTROLLER_AUTHORIZATION_FAILED") {
    return `Matrix verification is complete, but controller authorization failed. ${connected.error}`;
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
  const [page, setPage] = useState<Page>("assets");
  const [demoAssetIndex, setDemoAssetIndex] = useState(0);
  const [selectedAssetId, setSelectedAssetId] = useState<string | null>(null);
  const [detailAsset, setDetailAsset] = useState<AssetView | DemoAsset | null>(null);
  const [search, setSearch] = useState("");
  const [assetSearch, setAssetSearch] = useState("");
  const [recipientType, setRecipientType] = useState<RecipientType>("matrix");
  const [recipient, setRecipient] = useState("");
  const [matrixRecipientOwnership, setMatrixRecipientOwnership] = useState<import("@archelabs/locus").Ownership | null>(null);
  const [matrixRecipientError, setMatrixRecipientError] = useState("");
  const [amount, setAmount] = useState("");
  const [typeOpen, setTypeOpen] = useState(false);
  const [assetPickerOpen, setAssetPickerOpen] = useState(false);
  const [filter, setFilter] = useState<"all" | "sent" | "received">("all");
  const [assetFilter, setAssetFilter] = useState<"all" | "crypto" | "equities" | "custom">("all");
  const [toast, setToast] = useState("");
  const [sendState, setSendState] = useState<SendState>({ status: "idle" });
  const [sessionActivity, setSessionActivity] = useState<ActivityItem[]>([]);
  const [connectOpen, setConnectOpen] = useState(false);
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
  const { address: appKitAddress } = useAppKitAccount({ namespace: "eip155" });
  const { walletProvider } = useAppKitProvider<Eip1193Provider>("eip155");
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
        setEvmConnectError("");
        setConnectOpen(false);
      },
      clearSession,
      createSession: connectEvmProvider,
      onError: (error) => {
        setEvmConnectError(error.message);
        if (lifecycleRef.current === "restoring") {
          evmBridgeRef.current?.cancelConnection();
          finishRestore(`Could not restore the EVM session. It remains saved so you can retry. ${error.message}`);
        }
      },
    });
  }
  const evmBridge = evmBridgeRef.current;
  networkIdRef.current = network.networkId;

  const sessionOwner = session?.owner ?? null;
  const locus = useMemo<LocusClient | null>(() => network.locus?.withSession(session?.ownershipSession ?? null) ?? null, [network.locus, session]);
  const queryClient = useQueryClient();
  if (networkMode && network.status === "ready" && network.deployment) {
    lastReadyServiceIdByNetwork.current.set(network.networkId, network.deployment.serviceId);
  }
  const serviceId = network.deployment?.serviceId ?? lastReadyServiceIdByNetwork.current.get(network.networkId) ?? null;
  const assetQueriesEnabled = networkMode && network.status === "ready" && !!network.locus && serviceId !== null;
  const catalogQuery = useQuery({
    queryKey: ["locus", "asset-catalog", network.networkId],
    queryFn: () => loadCuratedCatalog(network.networkId),
    enabled: networkMode,
    staleTime: 5 * 60_000,
    retry: assetQueryRetry,
    retryDelay: assetQueryRetryDelay,
  });
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
  balanceQueries.forEach((query, index) => {
    const asset = stableMetadata[index];
    if (asset && query.data !== undefined) balancesByAsset.set(asset.assetIdHex.toLowerCase(), query.data);
  });
  const assets = useMemo(() => attachAssetBalances(stableMetadata, balancesByAsset, sessionOwner !== null), [balanceQueries, metadataQueries, sessionOwner, stableMetadata]);
  const assetsLoading = networkMode && assets.length === 0 && (assetIdsQuery.isLoading || (listedAssetIds.length > 0 && metadataQueries.some((query) => query.isLoading)));
  const assetsError = assetIdsQuery.error instanceof Error
    ? assetIdsQuery.error.message
    : listedAssetIds.length > 0 && metadataQueries.every((query) => query.isError) && assets.length === 0
      ? "Unable to load asset details."
      : "";
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
        else { setPendingMatrixConnection(connected); setConnectOpen(true); finishRestore(matrixRestoreMessage(connected)); }
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

  function clearSavedSession() {
    if (readStoredMatrixSession()) signOutMatrix();
    else {
      void signOutMatrixSession().catch((cause) => notify(cause instanceof Error ? cause.message : "Could not clear the saved sign-in."));
      clearSession();
      finishRestore();
    }
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
    setSendState({ status: "idle" });
  }, [network.networkId]);

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
    if (recipientType !== "matrix" || !matrixRecipientOwnership) return matrixRecipientError ? { ...currentResolution, message: matrixRecipientError } : currentResolution;
    return { ...currentResolution, ownership: matrixRecipientOwnership, valid: true, configured: true, detectedType: "matrix" as const, message: "Matrix master Ownership resolved" };
  }, [currentResolution, matrixRecipientError, matrixRecipientOwnership, recipientType]);

  useEffect(() => {
    if (!networkMode || recipientType !== "matrix" || !/^@[A-Za-z0-9._=-]+:[^\s:]+$/.test(recipient.trim())) {
      setMatrixRecipientOwnership(null);
      setMatrixRecipientError("");
      return;
    }
    let cancelled = false;
    setMatrixRecipientOwnership(null);
    setMatrixRecipientError("Resolving Matrix master Ownership…");
    resolveMatrixRecipient(recipient.trim(), { resolverUrl: network.network?.matrixResolverUrl }).then((ownership) => {
      if (!cancelled) { setMatrixRecipientOwnership(ownership); setMatrixRecipientError(""); }
    }).catch((error) => { if (!cancelled) { setMatrixRecipientOwnership(null); setMatrixRecipientError(error instanceof Error ? error.message : "Matrix master Ownership could not be resolved."); } });
    return () => { cancelled = true; };
  }, [networkMode, recipient, recipientType]);
  const activity = networkMode ? sessionActivity : demoActivity;
  const filteredActivity = activity.filter((entry) => filter === "all" || entry.kind === "swap" || entry.direction === filter);

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
    setSelectedAssetId(asset.assetIdHex);
    setSendState({ status: "idle" });
    setPage("send");
  }

  function updateRecipient(value: string) {
    changeRecipient(value);
    setSendState({ status: "idle" });
  }

  function updateAmount(value: string) {
    setAmount(value);
    setSendState({ status: "idle" });
  }

  function continueSend() {
    const assetForSend = networkMode ? currentNetworkAsset : currentDemoAsset;
    if (!assetForSend) { notify("No asset is available on this network."); return; }
    if (!recipient.trim() || !amount.trim()) { notify("Enter a recipient and amount."); return; }
    if (!networkMode) { notify(`Demo: send ${amount} ${currentDemoAsset.symbol} to ${recipient}`); return; }
    if (!("assetId" in assetForSend)) { notify("No network asset is selected."); return; }
    if (network.status !== "ready" || !locus) { notify("The selected network is not ready."); return; }
    if (!session) { setSendState({ status: "failed", error: "Connect an Ownership session to send.", networkId: network.networkId }); notify("Connect to send."); return; }
    if (!resolvedRecipient.valid || !resolvedRecipient.ownership) { notify(resolvedRecipient.message); return; }
    let parsedAmount: bigint;
    try { parsedAmount = parseUnits(amount, assetForSend.decimals); } catch (error) { notify(error instanceof Error ? error.message : "Invalid amount."); return; }
    if (assetForSend.balance === 0n) { notify("This account has no balance for the selected asset."); return; }
    if (parsedAmount <= 0n || parsedAmount > (assetForSend.balance ?? 0n)) { notify("Enter an amount within the available balance."); return; }
    setReviewOpen(true);
  }

  async function confirmSend() {
    const assetForSend = currentNetworkAsset;
    if (!assetForSend || !locus || !session || !resolvedRecipient.ownership) return;
    const destinationOwner = resolvedRecipient.ownership;
    let parsedAmount: bigint;
    try { parsedAmount = parseUnits(amount, assetForSend.decimals); } catch (error) { notify(error instanceof Error ? error.message : "Invalid amount."); return; }
    const submittedNetwork = network.networkId;
    setReviewOpen(false);
    try {
      setSendState({ status: "awaiting-signature" });
      const applied = await transferAndWait(locus, assetForSend.assetId, destinationOwner, parsedAmount, submittedNetwork, (submitted) => {
        if (networkIdRef.current === submittedNetwork) setSendState({ status: "submitted", transactionId: submitted.transactionId, actionHash: submitted.actionHash, networkId: submittedNetwork });
      });
      if (networkIdRef.current !== submittedNetwork) return;
      setSendState(applied);
      const nextActivity = [{ direction: "sent" as const, asset: assetForSend.symbol, recipient, amount: `${formatUnits(parsedAmount, assetForSend.decimals)} ${assetForSend.symbol}`, date: "Just now", transactionId: applied.transactionId }, ...sessionActivity];
      setSessionActivity(nextActivity);
      window.localStorage.setItem(sessionActivityKey(submittedNetwork, formatLocusId(session.owner)), JSON.stringify(nextActivity));
      void refreshAssets();
      notify("Sent");
    } catch (error) {
      if (networkIdRef.current === submittedNetwork) {
        setSendState({ status: "failed", error: error instanceof Error ? error.message : "Transaction failed.", networkId: submittedNetwork });
        notify("Transaction failed.");
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
      date: "Just now",
      transactionId: item.transactionId,
    }, ...sessionActivity];
    setSessionActivity(nextActivity);
    window.localStorage.setItem(sessionActivityKey(item.networkId, formatLocusId(session.owner)), JSON.stringify(nextActivity));
    void refreshAssets();
  }

  return (
    <div className="app-shell" data-locus-mode={network.mode}>
      <aside className="sidebar">
        <div className="brand">locus</div>
        <nav aria-label="Primary">
          {(["assets", "send", "swap", "activity"] as Page[]).map((entry) => (
            <button type="button" className={page === entry ? "nav-item active" : "nav-item"} key={entry} onClick={() => setPage(entry)}>
              <span className="nav-icon" aria-hidden="true">{entry === "send" ? <Send size={17} /> : entry === "assets" ? <Coins size={17} /> : entry === "swap" ? <ArrowLeftRight size={17} /> : <History size={17} />}</span><span className="nav-label">{entry[0].toUpperCase() + entry.slice(1)}</span>
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          {networkMode ? <NetworkSwitcher /> : <div className="demo-footer"><span className="status-dot ready" />Demo Mode</div>}
        </div>
      </aside>

      <header className="mobile-header">
        <div className="mobile-header-row">
          <div className="brand">locus</div>
          <div className="mobile-header-actions">
            <ThemeControl />
            {networkMode
              ? <NetworkSwitcher compact />
              : <span className="mobile-demo-indicator"><span className="status-dot ready" aria-hidden="true" />Demo</span>}
            <AccountMenu session={session} lifecycle={lifecycle} restoreError={restoreError} onConnect={openConnect} onDisconnect={disconnectSession} onSignOutMatrix={signOutMatrix} onClearSavedSession={clearSavedSession} />
          </div>
        </div>
      </header>

      <main className="main">
        <header className="topbar">
          <ThemeControl />
          <AccountMenu session={session} lifecycle={lifecycle} restoreError={restoreError} onConnect={openConnect} onDisconnect={disconnectSession} onSignOutMatrix={signOutMatrix} onClearSavedSession={clearSavedSession} />
        </header>

        {networkMode && network.status !== "ready" && (
          <section className="connection-card card">
            <div><strong>{network.error?.category === "DEPLOYMENT_UNAVAILABLE" ? `${network.network?.label ?? "Network"} is not configured` : `Unable to connect to ${network.network?.label ?? "network"}`}</strong><p>{networkErrorMessage(network.error, network.error?.endpoint)}</p></div>
            {network.status === "error" && <ActionButton variant="secondary" icon={RefreshCw} onClick={network.reconnect}>Retry</ActionButton>}
          </section>
        )}

        {page === "send" && <SendPage networkMode={networkMode} status={network.status} asset={currentAsset} assets={assets} assetSearch={assetSearch} assetPickerOpen={assetPickerOpen} recipientType={recipientType} recipient={recipient} amount={amount} typeOpen={typeOpen} resolution={resolvedRecipient} sendState={sendState} onSearchAssets={setAssetSearch} onToggleAssets={setAssetPickerOpen} onSelectAsset={(asset) => { chooseNetworkAsset(asset); setAssetSearch(""); }} onChooseType={chooseType} onToggleTypes={setTypeOpen} onRecipient={updateRecipient} onAmount={updateAmount} onMax={() => updateAmount(currentAsset ? displayAmount(networkMode ? currentNetworkAsset?.balance ?? null : currentDemoAsset.balance, currentAsset.decimals) : "")} onContinue={continueSend} onCycleDemo={() => setDemoAssetIndex((value) => (value + 1) % demoAssets.length)} onClear={() => updateRecipient("")} />}
        {page === "assets" && <AssetsPage networkMode={networkMode} loading={assetsLoading} error={assetsError} assets={filteredAssets} featuredAssets={assets.filter((asset) => asset.presentation.curated).slice(0, 6)} search={search} setSearch={setSearch} filter={assetFilter} setFilter={setAssetFilter} onRetry={() => void refreshAssets()} onCreate={() => { if (!session) { openConnect(); return; } setCreateAssetOpen(true); }} onOpenDetail={setDetailAsset} />}
        {page === "swap" && <SwapPage networkMode={networkMode} networkId={network.networkId} status={network.status} locus={locus} assets={assets} session={session !== null} onConnect={openConnect} onApplied={recordSwap} onNotify={notify} />}
        {page === "activity" && <ActivityPage networkMode={networkMode} filter={filter} setFilter={setFilter} rows={filteredActivity} />}
      </main>
      <nav className="mobile-bottom-nav" aria-label="Primary">
        {(["assets", "send", "swap", "activity"] as Page[]).map((entry) => (
          <button type="button" className={page === entry ? "mobile-nav-item active" : "mobile-nav-item"} key={entry} aria-current={page === entry ? "page" : undefined} onClick={() => setPage(entry)}>
            {entry === "send" ? <Send size={20} aria-hidden="true" /> : entry === "assets" ? <Coins size={20} aria-hidden="true" /> : entry === "swap" ? <ArrowLeftRight size={20} aria-hidden="true" /> : <History size={20} aria-hidden="true" />}
            <span>{entry[0].toUpperCase() + entry.slice(1)}</span>
          </button>
        ))}
      </nav>
      {toast && <div className="toast" role="status">{toast}</div>}
      <ConnectDialog open={connectOpen} onClose={() => { evmBridge.cancelConnection(); setConnectOpen(false); }} onCancelMatrix={cancelMatrixSignIn} onMatrixSelected={() => setActiveSessionKind(window.localStorage, "matrix")} onConnected={(next) => { setSession(next); if (next.kind === "matrix") setPendingMatrixConnection(null); }} onEvmConnectRequested={() => { setActiveSessionKind(window.localStorage, "evm"); setEvmConnectError(""); return evmBridge.beginConnection(); }} onEvmConnectCancelled={() => evmBridge.cancelConnection()} evmError={evmConnectError} evmAccountAvailable={Boolean(walletProvider && appKitAddress)} locus={network.locus} initialMatrixConnection={pendingMatrixConnection} />
      {networkMode && currentNetworkAsset && <ReviewDialog open={reviewOpen} asset={currentNetworkAsset} amount={amount} recipient={recipient} resolution={resolvedRecipient} onClose={() => setReviewOpen(false)} onConfirm={confirmSend} />}
      <ReceiveDialog open={receiveAsset !== null} asset={receiveAsset} session={session} onClose={() => setReceiveAsset(null)} />
      <CreateAssetDialog open={createAssetOpen} locus={networkMode ? locus : null} session={session} networkId={network.networkId} serviceId={network.deployment?.serviceId ?? null} onClose={() => setCreateAssetOpen(false)} onCreated={() => void refreshAssets()} />
      <AssetDetailModal asset={detailAsset} networkMode={networkMode} onClose={() => setDetailAsset(null)} onReceive={(asset) => { setDetailAsset(null); setReceiveAsset(asset); }} onSend={(asset) => { setDetailAsset(null); if (networkMode && "assetId" in asset) chooseNetworkAsset(asset); else { setDemoAssetIndex(demoAssets.indexOf(asset as DemoAsset)); setPage("send"); } }} />
    </div>
  );
}

function SendPage({ networkMode, status, asset, assets, assetSearch, assetPickerOpen, recipientType, recipient, amount, typeOpen, resolution, sendState, onSearchAssets, onToggleAssets, onSelectAsset, onChooseType, onToggleTypes, onRecipient, onAmount, onMax, onContinue, onCycleDemo, onClear }: {
  networkMode: boolean; status: string; asset: AssetView | DemoAsset | null; assets: AssetView[]; assetSearch: string; assetPickerOpen: boolean; recipientType: RecipientType; recipient: string; amount: string; typeOpen: boolean; resolution: ReturnType<typeof resolveRecipient>; sendState: SendState;
  onSearchAssets: (value: string) => void; onToggleAssets: (open: boolean) => void; onSelectAsset: (asset: AssetView) => void; onChooseType: (type: RecipientType) => void; onToggleTypes: (open: boolean) => void; onRecipient: (value: string) => void; onAmount: (value: string) => void; onMax: () => void; onContinue: () => void; onCycleDemo: () => void; onClear: () => void;
}) {
  const symbol = asset?.symbol ?? "Asset";
  const decimals = asset?.decimals ?? 0;
  const balance = asset?.balance ?? null;
  const busy = sendState.status === "awaiting-signature" || sendState.status === "submitting" || sendState.status === "submitted";
  const sendLabel = networkMode && status !== "ready" ? "Network unavailable" : sendState.status === "awaiting-signature" ? "Approve in wallet…" : sendState.status === "submitting" ? "Submitting…" : sendState.status === "submitted" ? "Waiting for confirmation…" : sendState.status === "applied" ? "Sent" : "Review transfer";
  return <section className="page send-page"><h1>Send</h1><div className="card send-card"><label>Asset</label><AssetPicker networkMode={networkMode} asset={asset} assets={assets} search={assetSearch} open={assetPickerOpen} onOpenChange={onToggleAssets} onSearch={onSearchAssets} onSelect={onSelectAsset} onCycleDemo={onCycleDemo} /><OwnershipInput type={recipientType} value={recipient} open={typeOpen} networkMode={networkMode} message={resolution.message} valid={resolution.valid} onType={onChooseType} onToggle={onToggleTypes} onChange={onRecipient} onClear={onClear} /><div className="field-group"><label>Amount</label><div className="amount-control"><input value={amount} inputMode="decimal" placeholder="0" onChange={(event) => onAmount(event.target.value)} /><strong>{symbol}</strong><ActionButton className="amount-max-button" variant="tertiary" size="small" icon={ArrowUpRight} disabled={!asset} onClick={onMax}>Max</ActionButton></div><div className="amount-foot"><span>{networkMode ? "No market price is configured" : "≈ $12.12 USD (estimate)"}</span><span>Balance: {displayAmount(balance, decimals)} {asset ? symbol : ""}</span></div></div><ActionButton variant="primary" icon={ArrowUpRight} fullWidth disabled={!asset || busy || sendState.status === "applied" || (networkMode && status !== "ready")} onClick={onContinue}>{sendLabel}</ActionButton>{sendState.status === "failed" && <div className="transaction-error">{sendState.error}</div>}{sendState.status === "submitted" && <Receipt state={sendState} />}{sendState.status === "applied" && <Receipt state={sendState} />}<div className="notice">The recipient type describes who controls the destination Ownership, not a target chain.</div></div></section>;
}

function Receipt({ state }: { state: Extract<SendState, { status: "submitted" | "applied" }> }) {
  return <div className="receipt"><strong>{state.status === "applied" ? "Transaction applied" : "Transaction submitted"}</strong><span>Network: {state.networkId}</span><span>Status: {state.status}</span><code>{state.transactionId}</code>{state.actionHash && <code>{state.actionHash}</code>}</div>;
}

type SwapSubmissionState = "idle" | "awaiting-signature" | "submitted" | "applied" | "failed";

function SwapPage({ networkMode, networkId, status, locus, assets, session, onConnect, onApplied, onNotify }: {
  networkMode: boolean;
  networkId: string;
  status: string;
  locus: LocusClient | null;
  assets: AssetView[];
  session: boolean;
  onConnect: () => void;
  onApplied: (item: { assetIn: string; assetOut: string; amountIn: string; amountOut: string; transactionId: string; networkId: string }) => void;
  onNotify: (message: string) => void;
}) {
  const [pools, setPools] = useState<Pool[]>([]);
  const [poolLoading, setPoolLoading] = useState(false);
  const [poolError, setPoolError] = useState("");
  const [poolRefresh, setPoolRefresh] = useState(0);
  const [poolKey, setPoolKey] = useState("");
  const [reverse, setReverse] = useState(false);
  const [amount, setAmount] = useState("");
  const [slippage, setSlippage] = useState("100");
  const [customSlippage, setCustomSlippage] = useState("1");
  const [reviewOpen, setReviewOpen] = useState(false);
  const [submission, setSubmission] = useState<SwapSubmissionState>("idle");
  const [transactionId, setTransactionId] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    if (!networkMode || status !== "ready" || !locus) {
      setPools([]);
      setPoolLoading(false);
      setPoolError("");
      return;
    }
    let cancelled = false;
    setPoolLoading(true);
    setPoolError("");
    void locus.listPools().then((next) => {
      if (!cancelled) {
        setPools(next);
        setPoolKey((current) => current || next.map((pool) => `${toHex(pool.asset0)}:${toHex(pool.asset1)}`)[0] || "");
      }
    }).catch((cause) => {
      if (!cancelled) setPoolError(cause instanceof Error ? cause.message : "Pools could not be loaded.");
    }).finally(() => { if (!cancelled) setPoolLoading(false); });
    return () => { cancelled = true; };
  }, [locus, networkId, networkMode, poolRefresh, status]);

  const assetById = useMemo(() => new Map(assets.map((asset) => [asset.assetIdHex.toLowerCase(), asset])), [assets]);
  const availablePools = useMemo(() => pools.flatMap((pool) => {
    const asset0 = assetById.get(toHex(pool.asset0).toLowerCase());
    const asset1 = assetById.get(toHex(pool.asset1).toLowerCase());
    return asset0 && asset1 ? [{ pool, asset0, asset1, key: `${toHex(pool.asset0)}:${toHex(pool.asset1)}` }] : [];
  }), [assetById, pools]);
  const selected = availablePools.find((entry) => entry.key === poolKey) ?? availablePools[0] ?? null;
  const selectedHasLiquidity = !!selected && selected.pool.reserve0 > 0n && selected.pool.reserve1 > 0n;
  const assetIn = selected ? (reverse ? selected.asset1 : selected.asset0) : null;
  const assetOut = selected ? (reverse ? selected.asset0 : selected.asset1) : null;
  const slippageBps = slippage === "custom" ? Math.round(Number(customSlippage) * 100) : Number(slippage);
  const quote = useMemo(() => {
    if (!selected || !assetIn || !assetOut || !amount.trim()) return null;
    try {
      if (!Number.isInteger(slippageBps) || slippageBps < 0 || slippageBps >= 10000) return null;
      const amountIn = parseUnits(amount, assetIn.decimals);
      const asset0In = assetIn.assetIdHex.toLowerCase() === toHex(selected.pool.asset0).toLowerCase();
      const result = quoteExactIn(asset0In ? selected.pool.reserve0 : selected.pool.reserve1, asset0In ? selected.pool.reserve1 : selected.pool.reserve0, amountIn);
      return { ...result, minimumAmountOut: minimumAmountOut(result.amountOut, slippageBps) };
    } catch {
      return null;
    }
  }, [amount, assetIn, assetOut, selected, slippageBps]);

  const poolPrice = useMemo(() => {
    if (!selected || !selectedHasLiquidity || !assetIn || !assetOut) return null;
    const asset0In = assetIn.assetIdHex.toLowerCase() === toHex(selected.pool.asset0).toLowerCase();
    const reserveIn = asset0In ? selected.pool.reserve0 : selected.pool.reserve1;
    const reserveOut = asset0In ? selected.pool.reserve1 : selected.pool.reserve0;
    if (reserveIn === 0n || reserveOut === 0n) return null;
    const humanIn = Number(formatUnits(reserveIn, assetIn.decimals));
    const humanOut = Number(formatUnits(reserveOut, assetOut.decimals));
    const price = humanOut / humanIn;
    return Number.isFinite(price) ? price : null;
  }, [assetIn, assetOut, selected, selectedHasLiquidity]);

  const priceImpact = useMemo(() => {
    if (poolPrice === null || !quote || !assetIn || !assetOut) return null;
    const humanIn = Number(formatUnits(quote.amountIn, assetIn.decimals));
    const humanOut = Number(formatUnits(quote.amountOut, assetOut.decimals));
    const executionPrice = humanOut / humanIn;
    const impact = (1 - executionPrice / poolPrice) * 100;
    return Number.isFinite(impact) ? Math.max(0, impact) : null;
  }, [assetIn, assetOut, poolPrice, quote]);

  function openReview() {
    if (!networkMode) { onNotify("Swap is available in Network Mode."); return; }
    if (status !== "ready" || !locus) { onNotify("The selected network is not ready."); return; }
    if (!session) { onConnect(); return; }
    if (!selected || !assetIn || !assetOut || !quote) { onNotify("Enter an amount with available pool liquidity."); return; }
    if (assetIn.balance === null || quote.amountIn > assetIn.balance) { onNotify("The input amount exceeds your available balance."); return; }
    setError("");
    setReviewOpen(true);
  }

  async function confirmSwap() {
    if (!locus || !selected || !assetIn || !assetOut || !quote) return;
    setReviewOpen(false);
    setSubmission("awaiting-signature");
    setError("");
    try {
      const submitted = await locus.swapExactIn(assetIn.assetId, assetOut.assetId, quote.amountIn, quote.minimumAmountOut);
      setTransactionId(submitted.transactionId);
      setSubmission("submitted");
      const receipt = await locus.waitForAction(submitted.transactionId, { intervalMs: 500, timeoutMs: 180_000 });
      if (receipt.actionReceipt.status !== "applied") {
        throw new Error(`Swap failed${receipt.actionReceipt.errorCode === null ? "" : ` (error ${receipt.actionReceipt.errorCode})`}`);
      }
      setSubmission("applied");
      let activitySaved = true;
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
        activitySaved = false;
      }
      setAmount("");
      onNotify(activitySaved ? "Swap completed." : "Swap completed, but browser-local activity could not be saved.");
    } catch (cause) {
      setSubmission("failed");
      setError(cause instanceof Error ? cause.message : "Swap failed.");
    }
  }

  const busy = submission === "awaiting-signature" || submission === "submitted";
  const equityPool = selected?.asset0.presentation.class === "equity-demo" || selected?.asset1.presentation.class === "equity-demo";
  const minReceived = quote && assetOut ? formatUnits(quote.minimumAmountOut, assetOut.decimals) : "—";

  return <section className="page swap-page">
    <h1>Swap</h1>
    <div className="card swap-card">
      <label className="swap-label" htmlFor="swap-pool">Pool</label>
      <select id="swap-pool" className="swap-pool-select" value={selected?.key ?? ""} disabled={availablePools.length === 0} onChange={(event) => { setPoolKey(event.target.value); setReverse(false); setSubmission("idle"); }}>
        {availablePools.length === 0 ? <option value="">No pool available</option> : availablePools.map((entry) => <option key={entry.key} value={entry.key}>{entry.asset0.symbol} / {entry.asset1.symbol}{entry.asset0.presentation.class === "equity-demo" || entry.asset1.presentation.class === "equity-demo" ? " · Demo pool" : ""}</option>)}
      </select>
      {poolLoading && <p className="muted">Loading pools…</p>}
      {poolError && <div className="transaction-error" role="alert">{poolError}<ActionButton size="small" variant="tertiary" icon={RefreshCw} onClick={() => setPoolRefresh((value) => value + 1)}>Retry</ActionButton></div>}
      {!poolLoading && !poolError && availablePools.length === 0 && <div className="empty-state swap-empty">No liquidity is available yet. This pair is not available until its pool is initialized.</div>}
      {selected && !selectedHasLiquidity && <div className="empty-state swap-empty">No liquidity is available for this pair. No quote is available until the pool is seeded.</div>}
      {selected && selectedHasLiquidity && assetIn && assetOut && <>
        <div className="swap-side-label"><label htmlFor="swap-amount">You pay</label><span>Balance: {displayAssetAmount(assetIn)}</span></div>
        <div className="swap-token-card">
          <div className="swap-token-heading"><AssetIcon asset={assetIn} size={36} /><span><strong>{assetIn.symbol}</strong><small>{assetIn.name}</small></span></div>
          <input id="swap-amount" value={amount} inputMode="decimal" placeholder="0.00" onChange={(event) => { setAmount(event.target.value); setSubmission("idle"); }} aria-label={`Amount of ${assetIn.symbol} to swap`} />
        </div>
        <button className="swap-direction" type="button" aria-label="Switch swap direction" onClick={() => { setReverse((value) => !value); setSubmission("idle"); }}><ArrowDownLeft size={19} aria-hidden="true" /></button>
        <div className="swap-side-label"><span>You receive</span><span>{assetOut.symbol}</span></div>
        <div className="swap-token-card swap-token-output">
          <div className="swap-token-heading"><AssetIcon asset={assetOut} size={36} /><span><strong>{assetOut.symbol}</strong><small>{assetOut.name}</small></span></div>
          <strong>{quote ? formatUnits(quote.amountOut, assetOut.decimals) : "—"}</strong>
        </div>
        <div className="swap-settings">
          <label htmlFor="swap-slippage">Slippage tolerance</label>
          <select id="swap-slippage" value={slippage} onChange={(event) => setSlippage(event.target.value)}><option value="50">0.5%</option><option value="100">1%</option><option value="200">2%</option><option value="custom">Custom</option></select>
          {slippage === "custom" && <input aria-label="Custom slippage percent" inputMode="decimal" value={customSlippage} onChange={(event) => setCustomSlippage(event.target.value)} />}
        </div>
        <dl className="swap-quote-details">
          <div><dt>Pool price</dt><dd>{poolPrice === null ? "Unavailable" : `1 ${assetIn.symbol} ≈ ${poolPrice.toLocaleString(undefined, { maximumFractionDigits: 8 })} ${assetOut.symbol}`}</dd></div>
          <div><dt>Fee</dt><dd>0.30%</dd></div>
          <div><dt>Minimum received</dt><dd>{minReceived} {assetOut.symbol}</dd></div>
          <div><dt>Price impact</dt><dd>{priceImpact === null ? "—" : `≈ ${priceImpact.toLocaleString(undefined, { maximumFractionDigits: 2 })}%`}</dd></div>
          <div><dt>Pricing</dt><dd>Pool price · Demo liquidity · No market oracle</dd></div>
          {equityPool && <div><dt>Asset disclosure</dt><dd>Demo equity · No real securities rights</dd></div>}
        </dl>
      </>}
      <ActionButton className="swap-review-action" variant="primary" icon={ArrowLeftRight} fullWidth disabled={busy || status !== "ready" || !selected || !quote || submission === "applied"} onClick={openReview}>
        {submission === "awaiting-signature" ? "Approve in wallet…" : submission === "submitted" ? "Waiting for confirmation…" : submission === "applied" ? "Swap completed" : session ? "Review swap" : "Connect to swap"}
      </ActionButton>
      {submission === "submitted" && transactionId && <div className="receipt"><strong>Swap submitted · waiting for confirmation</strong><code>{transactionId}</code></div>}
      {submission === "applied" && transactionId && <div className="receipt"><strong>Swap applied</strong><code>{transactionId}</code></div>}
      {(error || submission === "failed") && <div className="transaction-error" role="alert">{error || "Swap failed."}</div>}
      <p className="notice">Pool prices come from on-chain reserves, not market data. Demo liquidity · No market oracle. Quotes appear only when chain state contains a seeded pool. Swaps use a single pool and a fixed 0.30% fee.</p>
    </div>
    {reviewOpen && quote && assetIn && assetOut && <Modal open title="Review swap" onClose={() => setReviewOpen(false)} footer={<><ActionButton variant="secondary" icon={X} onClick={() => setReviewOpen(false)}>Cancel</ActionButton><ActionButton variant="primary" icon={ArrowLeftRight} onClick={() => void confirmSwap()}>Confirm swap</ActionButton></>}>
      <p className="modal-lead">Review the exact-input swap before signing.</p>
      <dl className="review-list"><div><dt>You pay</dt><dd>{formatUnits(quote.amountIn, assetIn.decimals)} {assetIn.symbol}</dd></div><div><dt>Expected output</dt><dd>{formatUnits(quote.amountOut, assetOut.decimals)} {assetOut.symbol}</dd></div><div><dt>Minimum received</dt><dd>{formatUnits(quote.minimumAmountOut, assetOut.decimals)} {assetOut.symbol}</dd></div><div><dt>Pool</dt><dd>{selected?.asset0.symbol} / {selected?.asset1.symbol}</dd></div><div><dt>Fee</dt><dd>0.30%</dd></div><div><dt>Slippage tolerance</dt><dd>{(slippageBps / 100).toFixed(slippageBps % 100 === 0 ? 0 : 2)}%</dd></div></dl>
    </Modal>}
  </section>;
}

function AssetsPage({ networkMode, loading, error, assets, featuredAssets, search, setSearch, filter, setFilter, onRetry, onOpenDetail, onCreate }: { networkMode: boolean; loading: boolean; error: string; assets: (AssetView | DemoAsset)[]; featuredAssets: AssetView[]; search: string; setSearch: (value: string) => void; filter: "all" | "crypto" | "equities" | "custom"; setFilter: (value: "all" | "crypto" | "equities" | "custom") => void; onRetry: () => void; onOpenDetail: (asset: AssetView | DemoAsset) => void; onCreate: () => void }) {
  const filters = [{ id: "all", label: "All" }, { id: "crypto", label: "Crypto" }, { id: "equities", label: "Equities" }, { id: "custom", label: "Custom" }] as const;
  return <section className="page">
    <div className="page-heading"><h1>Assets</h1>{networkMode && <ActionButton variant="secondary" icon={CirclePlus} onClick={onCreate}>Create asset</ActionButton>}</div>
    <div className="assets-layout"><div>
      <div className="assets-toolbar">
        {networkMode && <div className="tabs asset-class-tabs asset-filter-tabs" aria-label="Filter assets">{filters.map((entry) => <button key={entry.id} type="button" className={filter === entry.id ? "active" : ""} onClick={() => setFilter(entry.id)}>{entry.label}</button>)}</div>}
        {networkMode && <label className="asset-filter-mobile"><span className="sr-only">Asset type</span><select aria-label="Asset type" value={filter} onChange={(event) => setFilter(event.target.value as typeof filter)}>{filters.map((entry) => <option key={entry.id} value={entry.id}>{entry.label}</option>)}</select></label>}
        <input className="search" value={search} placeholder="Search assets..." onChange={(event) => setSearch(event.target.value)} />
      </div>
      {error && <div className="empty-state" role="alert">{error}<ActionButton size="small" variant="tertiary" icon={RefreshCw} onClick={onRetry}>Try again</ActionButton></div>}
      {loading && assets.length === 0 && <AssetListSkeleton />}
      {!error && !loading && assets.length === 0 && <div className="empty-state">{networkMode ? "No matching assets on this network." : "No demo assets found."}</div>}
      {assets.length > 0 && <div className="card asset-list">{assets.map((entry) => {
        const isNetworkAsset = "assetIdHex" in entry;
        const id = isNetworkAsset ? entry.assetIdHex : entry.symbol;
        const balance = isNetworkAsset ? (entry.balance === null ? "—" : displayAssetAmount(entry)) : `${displayAmount(entry.balance, entry.decimals)} ${entry.symbol}`;
        return <div className="asset-row" key={id} role="button" tabIndex={0} onClick={() => onOpenDetail(entry)} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); onOpenDetail(entry); } }}>
          {isNetworkAsset ? <AssetIcon asset={entry} size={40} /> : <span className="coin small-coin" style={{ background: entry.color }}>{entry.symbol[0]}</span>}
          <span className="asset-row-info"><strong>{entry.name}</strong></span><span className="asset-row-balance">{balance}</span>
        </div>;
      })}</div>}
    </div><aside className="latest-assets"><h2>Featured Assets</h2><div className="card latest-list">{featuredAssets.length === 0 ? <div className="empty-state">Curated test assets will appear after their catalog and on-chain metadata match.</div> : featuredAssets.map((asset) => <button type="button" className="latest-asset" key={asset.assetIdHex} onClick={() => onOpenDetail(asset)}><AssetIcon asset={asset} size={36} /><span><strong>{asset.symbol}</strong><small>{asset.name} · {asset.presentation.badge}</small></span><span className="latest-chevron">›</span></button>)}</div></aside></div>
  </section>;
}

function AssetListSkeleton() {
  return <div className="card asset-list asset-list-skeleton" aria-label="Loading assets" aria-busy="true">{Array.from({ length: 5 }, (_, index) => <div className="asset-row" key={index}><Skeleton circle width={40} height={40} /><span className="asset-row-info"><Skeleton width="58%" height={18} /></span><span className="asset-row-balance"><Skeleton width={90} height={18} /></span></div>)}</div>;
}

function AssetDetailModal({ asset, networkMode, onClose, onReceive, onSend }: { asset: AssetView | DemoAsset | null; networkMode: boolean; onClose: () => void; onReceive: (asset: AssetView | DemoAsset) => void; onSend: (asset: AssetView | DemoAsset) => void }) {
  if (!asset) return null;
  const isNetworkAsset = "assetIdHex" in asset;
  const totalSupply = isNetworkAsset ? (asset.presentation.unit === "shares" ? `${formatUnits(asset.totalSupply, asset.decimals)} shares` : `${formatUnits(asset.totalSupply, asset.decimals)} ${asset.symbol}`) : "Demo data";
  const balance = isNetworkAsset ? (asset.balance === null ? "—" : displayAssetAmount(asset)) : `${displayAmount(asset.balance, asset.decimals)} ${asset.symbol}`;
  return <Modal open title={`${asset.symbol} details`} onClose={onClose} footer={<><ActionButton variant="secondary" icon={ArrowDownLeft} onClick={() => onReceive(asset)}>Receive</ActionButton><ActionButton variant="primary" icon={Send} onClick={() => onSend(asset)}>Send</ActionButton></>}><div className="detail-modal">{isNetworkAsset ? <AssetIcon asset={asset} size={64} /> : <span className="coin detail-coin" style={{ background: asset.color }}>{asset.symbol[0]}</span>}<h2>{asset.name}</h2><p className="muted">{asset.symbol}{isNetworkAsset && ` · ${asset.presentation.badge}`}</p><dl><div><dt>Decimals</dt><dd>{asset.decimals}</dd></div><div><dt>Balance</dt><dd>{balance}</dd></div><div><dt>Total supply</dt><dd>{totalSupply}</dd></div><div><dt>Value</dt><dd>{networkMode ? "Not priced" : (asset as DemoAsset).value}</dd></div>{isNetworkAsset && <><div><dt>Asset class</dt><dd>{asset.presentation.class}</dd></div><div><dt>Issuer</dt><dd><code>{formatLocusId(asset.issuer)}</code></dd></div><div><dt>Asset ID</dt><dd><code>{asset.assetIdHex}</code></dd></div></>}</dl>{isNetworkAsset && asset.presentation.disclosure ? <p className="asset-disclosure">{asset.presentation.disclosure}</p> : <p className="modal-note">Asset balances and supply are read from the selected Locus network.</p>}</div></Modal>;
}

function ActivityPage({ networkMode, filter, setFilter, rows }: { networkMode: boolean; filter: "all" | "sent" | "received"; setFilter: (value: "all" | "sent" | "received") => void; rows: ActivityItem[] }) {
  return <section className="page"><div className="activity-heading"><div><h1>Activity</h1><p className="muted">{networkMode ? "Browser-local recent activity · not an indexed history" : "Demo activity"}</p></div>{!networkMode && <div className="card activity-summary"><div><small>Total sent (30d)</small><strong>1,240 DOT</strong></div><div><small>Total received (30d)</small><strong>320 DOT</strong></div></div>}</div><div className="tabs">{(["all", "sent", "received"] as const).map((entry) => <button type="button" className={filter === entry ? "active" : ""} key={entry} onClick={() => setFilter(entry)}>{entry[0].toUpperCase() + entry.slice(1)}</button>)}</div>{networkMode && rows.length === 0 ? <div className="card empty-state">No recent transactions in this browser yet. This list is local to this browser and is not a complete on-chain history.</div> : <div className="card activity-list">{rows.map((entry, index) => entry.kind === "swap" ? <div className="activity-row activity-row-swap" key={`${entry.transactionId ?? entry.date}-${index}`}><span className="received"><ArrowLeftRight size={15} aria-hidden="true" /> Swapped</span><strong>{entry.amountIn} {entry.assetIn} → {entry.amountOut} {entry.assetOut}</strong><span>Simple swap<small>Browser-local</small></span><small>{entry.date}</small></div> : <div className="activity-row" key={`${entry.transactionId ?? entry.date}-${index}`}><span className={entry.direction === "sent" ? "sent" : "received"}>{entry.direction === "sent" ? <><ArrowUpRight size={15} aria-hidden="true" /> Sent</> : <><ArrowDownLeft size={15} aria-hidden="true" /> Received</>}</span><strong>{entry.asset}</strong><span>{entry.recipient}<small>{networkMode ? "Browser-local" : "Recipient"}</small></span><strong>{entry.amount}</strong><small>{entry.date}</small></div>)}</div>}</section>;
}
