import { useEffect, useMemo, useRef, useState } from "react";
import { formatLocusId, formatUnits, parseUnits, type LocusClient } from "@archelabs/locus";
import { ArrowDownLeft, ArrowUpRight, CirclePlus, Coins, History, Send } from "lucide-react";
import { useNetwork } from "./network/NetworkProvider.js";
import { NetworkSwitcher } from "./network/NetworkSwitcher.js";
import { loadAssets, displayAmount, type AssetView } from "./locus/assets.js";
import { recipientLabels, resolveRecipient, detectRecipientType, type RecipientType } from "./locus/recipients.js";
import { transferAndWait, type SendState } from "./locus/transaction.js";
import { useSession } from "./session/SessionProvider.js";
import { connectBrowserSession, watchBrowserSession } from "./session/connectors.js";
import { ConnectDialog } from "./session/ConnectDialog.js";
import { CreateAssetDialog, ReceiveDialog, ReviewDialog } from "./locus/dialogs.js";
import { AssetPicker } from "./locus/AssetPicker.js";
import { RecipientTypeMenu } from "./locus/RecipientTypeMenu.js";
import { AccountMenu } from "./components/AccountMenu.js";
import { discoverHomeserver, readStoredMatrixSession, restoreMatrixSession } from "./matrix/MatrixConnector.js";
import { resolveMatrixMasterOwnership } from "./matrix/MatrixKeysQuery.js";

type Page = "send" | "assets" | "activity";
type DemoAsset = { symbol: string; name: string; balance: bigint; decimals: number; value: string; color: string };
type ActivityItem = { direction: "sent" | "received"; asset: string; recipient: string; amount: string; date: string; transactionId?: string };

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

function networkErrorMessage(error: Error | null, endpoint?: string): string {
  if (!error) return "";
  return endpoint ? `${error.message}\n${endpoint}` : error.message;
}

export function App() {
  const network = useNetwork();
  const { session, setSession } = useSession();
  const networkMode = network.mode === "network";
  const [page, setPage] = useState<Page>("assets");
  const [demoAssetIndex, setDemoAssetIndex] = useState(0);
  const [selectedAssetId, setSelectedAssetId] = useState<string | null>(null);
  const [assets, setAssets] = useState<AssetView[]>([]);
  const [assetsLoading, setAssetsLoading] = useState(false);
  const [assetsError, setAssetsError] = useState("");
  const [search, setSearch] = useState("");
  const [assetSearch, setAssetSearch] = useState("");
  const [recipientType, setRecipientType] = useState<RecipientType>("matrix");
  const [recipient, setRecipient] = useState("@bob:matrix.org");
  const [matrixRecipientOwnership, setMatrixRecipientOwnership] = useState<import("@archelabs/locus").Ownership | null>(null);
  const [matrixRecipientError, setMatrixRecipientError] = useState("");
  const [amount, setAmount] = useState("100");
  const [typeOpen, setTypeOpen] = useState(false);
  const [assetPickerOpen, setAssetPickerOpen] = useState(false);
  const [filter, setFilter] = useState<"all" | "sent" | "received">("all");
  const [toast, setToast] = useState("");
  const [sendState, setSendState] = useState<SendState>({ status: "idle" });
  const [sessionActivity, setSessionActivity] = useState<ActivityItem[]>([]);
  const [refreshToken, setRefreshToken] = useState(0);
  const [connectOpen, setConnectOpen] = useState(false);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [receiveAsset, setReceiveAsset] = useState<AssetView | DemoAsset | null>(null);
  const [createAssetOpen, setCreateAssetOpen] = useState(false);
  const networkIdRef = useRef(network.networkId);
  const sessionRestoreAttempted = useRef(false);
  networkIdRef.current = network.networkId;

  const sessionOwner = session?.owner ?? null;
  const locus = useMemo<LocusClient | null>(() => network.locus?.withSession(session?.ownershipSession ?? null) ?? null, [network.locus, session]);

  useEffect(() => {
    if (sessionRestoreAttempted.current || session) return;
    sessionRestoreAttempted.current = true;
    try {
      const matrixStored = readStoredMatrixSession();
      if (matrixStored) {
        const matrixControlClaim = network.network?.controlClaim && network.protocolClient ? { client: network.protocolClient, deployment: network.network.controlClaim } : undefined;
        restoreMatrixSession(matrixStored, matrixControlClaim).then((connected) => {
          if (connected.bootstrapper) setSession(connected.session);
          else connected.crypto.dispose();
        }).catch(() => undefined);
        return;
      }
      const stored = window.localStorage.getItem("locus.session.v1");
      if (!stored) return;
      const saved = JSON.parse(stored) as { kind?: "evm" | "polkadot" | "solana"; address?: string; connectionId?: string };
      if (!saved.kind || !saved.address) return;
      connectBrowserSession(saved.kind, saved.connectionId ?? saved.address).then(setSession).catch(() => {
        window.localStorage.removeItem("locus.session.v1");
      });
    } catch {
      window.localStorage.removeItem("locus.session.v1");
    }
  }, [network.network, network.protocolClient, session, setSession]);

  useEffect(() => {
    if (!session) {
      window.localStorage.removeItem("locus.session.v1");
      return;
    }
    if (session.kind === "matrix") {
      window.localStorage.removeItem("locus.session.v1");
      return;
    }
    window.localStorage.setItem("locus.session.v1", JSON.stringify({ kind: session.kind, address: session.address, connectionId: session.connectionId }));
    return watchBrowserSession(session, (address) => {
      if (!address || address.toLowerCase() !== session.address.toLowerCase()) setSession(null);
    });
  }, [session, setSession]);

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

  useEffect(() => {
    if (!networkMode || network.status !== "ready" || !network.locus) {
      setAssets([]);
      setAssetsLoading(false);
      return;
    }
    let cancelled = false;
    setAssetsLoading(true);
    setAssetsError("");
    loadAssets(network.locus, sessionOwner)
      .then((next) => { if (!cancelled) setAssets(next); })
      .catch((error) => { if (!cancelled) setAssetsError(error instanceof Error ? error.message : "Unable to load assets."); })
      .finally(() => { if (!cancelled) setAssetsLoading(false); });
    return () => { cancelled = true; };
  }, [network.locus, network.networkId, network.status, networkMode, refreshToken, sessionOwner]);

  const currentDemoAsset = demoAssets[demoAssetIndex];
  const currentNetworkAsset = assets.find((asset) => asset.assetIdHex === selectedAssetId) ?? assets[0] ?? null;
  const currentAsset = networkMode ? currentNetworkAsset : currentDemoAsset;
  const filteredAssets = useMemo(
    () => networkMode
      ? assets.filter((asset) => !search || `${asset.name} ${asset.symbol} ${asset.assetIdHex}`.toLowerCase().includes(search.toLowerCase()))
      : demoAssets.filter((asset) => !search || `${asset.name} ${asset.symbol}`.toLowerCase().includes(search.toLowerCase())),
    [assets, networkMode, search],
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
    discoverHomeserver(recipient.trim()).then((homeserver) => resolveMatrixMasterOwnership(recipient.trim(), homeserver)).then((ownership) => {
      if (!cancelled) { setMatrixRecipientOwnership(ownership); setMatrixRecipientError(""); }
    }).catch((error) => { if (!cancelled) { setMatrixRecipientOwnership(null); setMatrixRecipientError(error instanceof Error ? error.message : "Matrix master Ownership could not be resolved."); } });
    return () => { cancelled = true; };
  }, [networkMode, recipient, recipientType]);
  const activity = networkMode ? sessionActivity : demoActivity;
  const filteredActivity = activity.filter((entry) => filter === "all" || entry.direction === filter);

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
    setPage("send");
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
    if (assetForSend.balance === null || parsedAmount <= 0n || parsedAmount > assetForSend.balance) { notify("Amount exceeds the available balance."); return; }
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
      setSendState({ status: "submitting" });
      const applied = await transferAndWait(locus, assetForSend.assetId, destinationOwner, parsedAmount, submittedNetwork, (submitted) => {
        if (networkIdRef.current === submittedNetwork) setSendState({ status: "submitted", transactionId: submitted.transactionId, actionHash: submitted.actionHash, networkId: submittedNetwork });
      });
      if (networkIdRef.current !== submittedNetwork) return;
      setSendState(applied);
      const nextActivity = [{ direction: "sent" as const, asset: assetForSend.symbol, recipient, amount: `${formatUnits(parsedAmount, assetForSend.decimals)} ${assetForSend.symbol}`, date: "Just now", transactionId: applied.transactionId }, ...sessionActivity];
      setSessionActivity(nextActivity);
      window.localStorage.setItem(sessionActivityKey(submittedNetwork, formatLocusId(session.owner)), JSON.stringify(nextActivity));
      setRefreshToken((value) => value + 1);
      notify("Sent");
    } catch (error) {
      if (networkIdRef.current === submittedNetwork) {
        setSendState({ status: "failed", error: error instanceof Error ? error.message : "Transaction failed.", networkId: submittedNetwork });
        notify("Transaction failed.");
      }
    }
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">locus</div>
        <nav aria-label="Primary">
          {(["assets", "send", "activity"] as Page[]).map((entry) => (
            <button type="button" className={page === entry ? "nav-item active" : "nav-item"} key={entry} onClick={() => setPage(entry)}>
              <span className="nav-icon" aria-hidden="true">{entry === "send" ? <Send size={17} /> : entry === "assets" ? <Coins size={17} /> : <History size={17} />}</span>{entry[0].toUpperCase() + entry.slice(1)}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          {networkMode ? <NetworkSwitcher /> : <div className="demo-footer"><span className="status-dot ready" />Demo Mode</div>}
        </div>
      </aside>

      <main className="main">
        <header className="topbar">
          <AccountMenu session={session} onConnect={() => setConnectOpen(true)} onDisconnect={() => setSession(null)} />
        </header>

        {networkMode && network.status !== "ready" && (
          <section className="connection-card card">
            <div><strong>{network.error?.category === "DEPLOYMENT_UNAVAILABLE" ? `${network.network?.label ?? "Network"} is not configured` : `Unable to connect to ${network.network?.label ?? "network"}`}</strong><p>{networkErrorMessage(network.error, network.error?.endpoint)}</p></div>
            {network.status === "error" && <button type="button" className="secondary" onClick={network.reconnect}>Retry</button>}
          </section>
        )}

        {page === "send" && <SendPage networkMode={networkMode} status={network.status} asset={currentAsset} assets={assets} assetSearch={assetSearch} assetPickerOpen={assetPickerOpen} recipientType={recipientType} recipient={recipient} amount={amount} typeOpen={typeOpen} resolution={resolvedRecipient} sendState={sendState} onSearchAssets={setAssetSearch} onToggleAssets={setAssetPickerOpen} onSelectAsset={(asset) => { chooseNetworkAsset(asset); setAssetSearch(""); }} onChooseType={chooseType} onToggleTypes={setTypeOpen} onRecipient={changeRecipient} onAmount={setAmount} onMax={() => setAmount(currentAsset ? displayAmount(networkMode ? currentNetworkAsset?.balance ?? null : currentDemoAsset.balance, currentAsset.decimals) : "")} onContinue={continueSend} onCycleDemo={() => setDemoAssetIndex((value) => (value + 1) % demoAssets.length)} onClear={() => changeRecipient("")} />}
        {page === "assets" && <AssetsPage networkMode={networkMode} loading={assetsLoading} error={assetsError} assets={filteredAssets} selected={currentAsset} search={search} setSearch={setSearch} onCreate={() => { if (!session) { setConnectOpen(true); return; } setCreateAssetOpen(true); }} onReceive={(asset) => setReceiveAsset(asset)} onSelect={networkMode ? (asset) => { if ("assetId" in asset) chooseNetworkAsset(asset); } : (asset) => { setDemoAssetIndex(demoAssets.indexOf(asset as DemoAsset)); setPage("send"); }} />}
        {page === "activity" && <ActivityPage networkMode={networkMode} filter={filter} setFilter={setFilter} rows={filteredActivity} />}
      </main>
      {toast && <div className="toast" role="status">{toast}</div>}
      <ConnectDialog open={connectOpen} onClose={() => setConnectOpen(false)} onConnected={setSession} matrixControlClaim={network.network?.controlClaim && network.protocolClient ? { client: network.protocolClient, deployment: network.network.controlClaim } : undefined} />
      {networkMode && currentNetworkAsset && <ReviewDialog open={reviewOpen} asset={currentNetworkAsset} amount={amount} recipient={recipient} resolution={resolvedRecipient} onClose={() => setReviewOpen(false)} onConfirm={confirmSend} />}
      <ReceiveDialog open={receiveAsset !== null} asset={receiveAsset} session={session} onClose={() => setReceiveAsset(null)} />
      <CreateAssetDialog open={createAssetOpen} locus={networkMode ? locus : null} session={session} onClose={() => setCreateAssetOpen(false)} onCreated={() => setRefreshToken((value) => value + 1)} />
    </div>
  );
}

function SendPage({ networkMode, status, asset, assets, assetSearch, assetPickerOpen, recipientType, recipient, amount, typeOpen, resolution, sendState, onSearchAssets, onToggleAssets, onSelectAsset, onChooseType, onToggleTypes, onRecipient, onAmount, onMax, onContinue, onCycleDemo, onClear }: {
  networkMode: boolean; status: string; asset: AssetView | DemoAsset | null; assets: AssetView[]; assetSearch: string; assetPickerOpen: boolean; recipientType: RecipientType; recipient: string; amount: string; typeOpen: boolean; resolution: ReturnType<typeof resolveRecipient>; sendState: SendState;
  onSearchAssets: (value: string) => void; onToggleAssets: (open: boolean) => void; onSelectAsset: (asset: AssetView) => void; onChooseType: (type: RecipientType) => void; onToggleTypes: (open: boolean) => void; onRecipient: (value: string) => void; onAmount: (value: string) => void; onMax: () => void; onContinue: () => void; onCycleDemo: () => void; onClear: () => void;
}) {
  const symbol = asset?.symbol ?? "—";
  const decimals = asset?.decimals ?? 0;
  const balance = asset?.balance ?? null;
  const sendLabel = networkMode && status !== "ready" ? "Network unavailable" : sendState.status === "submitted" || sendState.status === "submitting" ? "Submitting…" : sendState.status === "applied" ? "Sent" : networkMode && sendState.status === "failed" && sendState.error.includes("session") ? "Connect to send" : "Continue";
  return <section className="page send-page"><h1>Send</h1><div className="card send-card"><label>Asset</label><AssetPicker networkMode={networkMode} asset={asset} assets={assets} search={assetSearch} open={assetPickerOpen} onOpenChange={onToggleAssets} onSearch={onSearchAssets} onSelect={onSelectAsset} onCycleDemo={onCycleDemo} /><RecipientTypeMenu type={recipientType} open={typeOpen} onOpenChange={onToggleTypes} onChoose={onChooseType} networkMode={networkMode} value={recipient} onChange={onRecipient} onClear={onClear} /><small className={resolution.valid ? "field-note valid" : "field-note"}>{networkMode ? resolution.message : `${recipientLabels[recipientType]} describes who controls the destination ownership, not a target chain.`}</small><div className="field-group"><label>Amount</label><div className="amount-control"><input value={amount} inputMode="decimal" onChange={(event) => onAmount(event.target.value)} /><strong>{symbol}</strong><button type="button" onClick={onMax}>Max</button></div><div className="amount-foot"><span>{networkMode ? "Estimated value unavailable" : "≈ $12.12 USD (estimate)"}</span><span>Balance: {displayAmount(balance, decimals)} {asset ? symbol : ""}</span></div></div><button type="button" className="primary" disabled={!asset || sendState.status === "submitting" || sendState.status === "submitted" || (networkMode && status !== "ready")} onClick={onContinue}>{sendLabel}</button>{sendState.status === "failed" && <div className="transaction-error">{sendState.error}</div>}{sendState.status === "submitted" && <Receipt state={sendState} />}{sendState.status === "applied" && <Receipt state={sendState} />}<div className="notice">The recipient type describes who controls the destination ownership, not a target chain.</div></div></section>;
}

function Receipt({ state }: { state: Extract<SendState, { status: "submitted" | "applied" }> }) {
  return <div className="receipt"><strong>{state.status === "applied" ? "Transaction applied" : "Transaction submitted"}</strong><span>Network: {state.networkId}</span><span>Status: {state.status}</span><code>{state.transactionId}</code>{state.actionHash && <code>{state.actionHash}</code>}</div>;
}

function AssetsPage({ networkMode, loading, error, assets, selected, search, setSearch, onSelect, onCreate, onReceive }: { networkMode: boolean; loading: boolean; error: string; assets: (AssetView | DemoAsset)[]; selected: AssetView | DemoAsset | null; search: string; setSearch: (value: string) => void; onSelect: (asset: AssetView | DemoAsset) => void; onCreate: () => void; onReceive: (asset: AssetView | DemoAsset) => void }) {
  return <section className="page"><div className="page-heading"><h1>Assets</h1>{networkMode && <button type="button" className="secondary" onClick={onCreate}><CirclePlus size={16} aria-hidden="true" /> Create asset</button>}</div><div className="assets-layout"><div><div className="card summary"><div><small>Total Assets</small><strong>{loading ? "…" : assets.length}</strong></div><div><small>{networkMode ? "Portfolio Value" : "Total Balance (USD)"}</small><strong>{networkMode ? "Unavailable" : "≈ $1,842.50"}</strong></div></div><input className="search" value={search} placeholder="Search assets…" onChange={(event) => setSearch(event.target.value)} />{error && <div className="empty-state">{error}</div>}{!error && !loading && assets.length === 0 && <div className="empty-state">No assets found on this network.</div>}<div className="card asset-list">{assets.map((entry) => { const view = entry; const id = "assetIdHex" in view ? view.assetIdHex : view.symbol; return <div className="asset-row" key={id} onClick={() => onSelect(view)}><span className="coin small-coin" style={{ background: view.color }}>{view.symbol[0]}</span><strong>{view.name}</strong><span>{view.symbol}</span><span>{displayAmount(view.balance, view.decimals)} {view.symbol}</span><button type="button" className="secondary" onClick={(event) => { event.stopPropagation(); onSelect(view); }}>Send</button></div>; })}</div></div><AssetDetail asset={selected} networkMode={networkMode} onReceive={onReceive} /></div></section>;
}

function AssetDetail({ asset, networkMode, onReceive }: { asset: AssetView | DemoAsset | null; networkMode: boolean; onReceive: (asset: AssetView | DemoAsset) => void }) {
  if (!asset) return <div className="card detail empty-state">Select an asset to view details.</div>;
  const totalSupply = "totalSupply" in asset ? formatUnits(asset.totalSupply, asset.decimals) : "—";
  return <div className="card detail"><span className="coin detail-coin" style={{ background: asset.color }}>{asset.symbol[0]}</span><h2>{asset.symbol}</h2><p className="muted">{asset.name}</p><dl><div><dt>Decimals</dt><dd>{asset.decimals}</dd></div><div><dt>Balance</dt><dd>{displayAmount(asset.balance, asset.decimals)} {asset.symbol}</dd></div><div><dt>Total supply</dt><dd>{totalSupply} {asset.symbol}</dd></div><div><dt>Estimated value</dt><dd>{networkMode ? "Unavailable" : "≈ $623.40"}</dd></div></dl><button type="button" className="secondary full" onClick={() => onReceive(asset)}>Receive</button></div>;
}

function ActivityPage({ networkMode, filter, setFilter, rows }: { networkMode: boolean; filter: "all" | "sent" | "received"; setFilter: (value: "all" | "sent" | "received") => void; rows: ActivityItem[] }) {
  return <section className="page"><div className="activity-heading"><div><h1>Activity</h1><p className="muted">{networkMode ? "This session" : "Demo activity"}</p></div>{!networkMode && <div className="card activity-summary"><div><small>Total sent (30d)</small><strong>1,240 DOT</strong></div><div><small>Total received (30d)</small><strong>320 DOT</strong></div></div>}</div><div className="tabs">{(["all", "sent", "received"] as const).map((entry) => <button type="button" className={filter === entry ? "active" : ""} key={entry} onClick={() => setFilter(entry)}>{entry[0].toUpperCase() + entry.slice(1)}</button>)}</div>{networkMode && rows.length === 0 ? <div className="card empty-state">No indexed activity yet. Transactions from this browser session will appear here.</div> : <div className="card activity-list">{rows.map((entry, index) => <div className="activity-row" key={`${entry.transactionId ?? entry.date}-${index}`}><span className={entry.direction === "sent" ? "sent" : "received"}>{entry.direction === "sent" ? <><ArrowUpRight size={15} aria-hidden="true" /> Sent</> : <><ArrowDownLeft size={15} aria-hidden="true" /> Received</>}</span><strong>{entry.asset}</strong><span>{entry.recipient}<small>{networkMode ? "This session" : "Recipient"}</small></span><strong>{entry.amount}</strong><small>{entry.date}</small></div>)}</div>}</section>;
}
