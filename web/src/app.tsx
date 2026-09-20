import { useMemo, useState } from "react";
import { evmOwnership, polkadotOwnership } from "../../sdk/src/ownership.js";
import type { Ownership } from "../../sdk/src/types.js";

type Page = "send" | "assets" | "activity";
type RecipientType = "matrix" | "telegram" | "email" | "github" | "evm" | "polkadot" | "locus";

type DemoAsset = {
  symbol: string;
  name: string;
  balance: string;
  decimals: number;
  value: string;
  color: string;
};

type ActivityItem = {
  direction: "sent" | "received";
  asset: string;
  recipient: string;
  type: RecipientType;
  amount: string;
  date: string;
};

const demoAssets: DemoAsset[] = [
  { symbol: "DOT", name: "Dot Token", balance: "12450", decimals: 10, value: "≈ $623.40", color: "#247eaa" },
  { symbol: "MINI", name: "Mini Token", balance: "2400", decimals: 12, value: "≈ $240.00", color: "#8555df" },
  { symbol: "USDX", name: "Dollar Token", balance: "1250", decimals: 6, value: "≈ $1,250.00", color: "#18a56b" },
  { symbol: "NOTE", name: "Note Token", balance: "340", decimals: 0, value: "≈ $29.10", color: "#7c8798" },
];

const activity: ActivityItem[] = [
  { direction: "sent", asset: "DOT", recipient: "@bob:matrix.org", type: "matrix", amount: "100 DOT", date: "Today, 10:24 AM" },
  { direction: "sent", asset: "DOT", recipient: "@charlie", type: "telegram", amount: "50 DOT", date: "Today, 9:17 AM" },
  { direction: "sent", asset: "DOT", recipient: "0x71C7...8976", type: "evm", amount: "200 DOT", date: "Apr 22, 11:03 AM" },
  { direction: "received", asset: "DOT", recipient: "locus:AbCdEf...", type: "locus", amount: "320 DOT", date: "Apr 20, 9:12 AM" },
];

const recipientLabels: Record<RecipientType, string> = {
  matrix: "Matrix",
  telegram: "Telegram",
  email: "Email",
  github: "GitHub",
  evm: "EVM Address",
  polkadot: "Polkadot Account",
  locus: "Locus ID",
};

const recipientHints: Record<RecipientType, string> = {
  matrix: "@username:server",
  telegram: "@username",
  email: "user@example.com",
  github: "@username",
  evm: "0x...",
  polkadot: "1...",
  locus: "locus:...",
};

function icon(type: RecipientType): string {
  return type === "matrix" ? "[m]" : type === "telegram" ? "➤" : type === "email" ? "✉" : type === "github" ? "⌘" : type === "evm" ? "◇" : type === "polkadot" ? "◎" : "#";
}

function isNetworkMode(): boolean {
  return import.meta.env.VITE_LOCUS_MODE === "network";
}

function recipientOwnership(type: RecipientType, value: string): Ownership | null {
  try {
    if (type === "evm") return evmOwnership(value);
    if (type === "polkadot") return polkadotOwnership(value);
    if (type === "locus" && value.startsWith("locus:")) return null;
  } catch {
    return null;
  }
  return null;
}

export function App() {
  const [page, setPage] = useState<Page>("send");
  const [assetIndex, setAssetIndex] = useState(0);
  const [recipientType, setRecipientType] = useState<RecipientType>("matrix");
  const [recipient, setRecipient] = useState("@bob:matrix.org");
  const [amount, setAmount] = useState("100");
  const [filter, setFilter] = useState<"all" | "sent" | "received">("all");
  const [toast, setToast] = useState("");
  const [typeOpen, setTypeOpen] = useState(false);
  const [search, setSearch] = useState("");

  const asset = demoAssets[assetIndex];
  const networkMode = isNetworkMode();
  const filteredAssets = useMemo(
    () => demoAssets.filter((entry) => !search || `${entry.name} ${entry.symbol}`.toLowerCase().includes(search.toLowerCase())),
    [search],
  );
  const filteredActivity = activity.filter((entry) => filter === "all" || entry.direction === filter);

  function notify(message: string) {
    setToast(message);
    window.setTimeout(() => setToast(""), 2400);
  }

  function chooseType(type: RecipientType) {
    setRecipientType(type);
    setTypeOpen(false);
    notify(`${recipientLabels[type]} recipient selected`);
  }

  function continueSend() {
    if (!recipient.trim() || !amount.trim()) {
      notify("Enter a recipient and amount.");
      return;
    }
    if (networkMode && !recipientOwnership(recipientType, recipient)) {
      notify(`${recipientLabels[recipientType]} resolver is not configured for Network Mode.`);
      return;
    }
    notify(networkMode ? "Ownership session is ready; submit through the connected signer." : `Demo: send ${amount} ${asset.symbol} to ${recipient}`);
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">locus</div>
        <nav>
          {(["send", "assets", "activity"] as Page[]).map((entry) => (
            <button className={page === entry ? "nav-item active" : "nav-item"} key={entry} onClick={() => setPage(entry)}>
              <span className="nav-icon">{entry === "send" ? "➤" : entry === "assets" ? "◉" : "◷"}</span>
              {entry[0].toUpperCase() + entry.slice(1)}
            </button>
          ))}
        </nav>
        <div className="sidebar-foot">{networkMode ? "Network Mode" : "Demo Mode"}</div>
      </aside>

      <main className="main">
        <header className="topbar">
          <div className="mode-pill">{networkMode ? "● Network" : "● Demo"}</div>
          <div className="profile-pill"><span className="matrix-mark">[m]</span> @alice:matrix.org <span className="muted">⌄</span></div>
        </header>

        {page === "send" && (
          <section className="page send-page">
            <h1>Send</h1>
            <div className="card send-card">
              <label>Asset</label>
              <button className="asset-picker" onClick={() => setAssetIndex((assetIndex + 1) % demoAssets.length)}>
                <span className="coin" style={{ background: asset.color }}>{asset.symbol[0]}</span>
                <span className="asset-copy"><strong>{asset.symbol}</strong><small>{asset.name}</small></span>
                <span className="balance-copy"><small>Balance</small><strong>{Number(asset.balance).toLocaleString()} {asset.symbol}</strong></span>
                <span className="muted">⌄</span>
              </button>

              <div className="field-group recipient-field">
                <label>To</label>
                <div className="recipient-control">
                  <button className="type-button" onClick={() => setTypeOpen(!typeOpen)}><span className="type-icon">{icon(recipientType)}</span><span className="muted">⌄</span></button>
                  <input value={recipient} placeholder={recipientHints[recipientType]} onChange={(event) => setRecipient(event.target.value)} />
                  {recipient && <button className="clear" onClick={() => setRecipient("")}>×</button>}
                </div>
                {typeOpen && <div className="type-menu">{(Object.keys(recipientLabels) as RecipientType[]).map((type) => <button key={type} onClick={() => chooseType(type)}><span className="type-icon">{icon(type)}</span><span><strong>{recipientLabels[type]}</strong><small>{recipientHints[type]}</small></span></button>)}</div>}
                <small className="field-note">{recipientLabels[recipientType]} describes who controls the destination ownership, not a target chain.</small>
              </div>

              <div className="field-group">
                <label>Amount</label>
                <div className="amount-control"><input value={amount} inputMode="decimal" onChange={(event) => setAmount(event.target.value)} /><strong>{asset.symbol}</strong><button onClick={() => setAmount(asset.balance)}>Max</button></div>
                <div className="amount-foot"><span>≈ $12.12 USD (estimate)</span><span>Balance: {Number(asset.balance).toLocaleString()} {asset.symbol}</span></div>
              </div>
              <button className="primary" onClick={continueSend}>Continue</button>
            </div>
          </section>
        )}

        {page === "assets" && <AssetsPage assets={filteredAssets} selected={asset} search={search} setSearch={setSearch} onSend={(entry) => { setAssetIndex(demoAssets.indexOf(entry)); setPage("send"); }} />}
        {page === "activity" && <ActivityPage filter={filter} setFilter={setFilter} rows={filteredActivity} />}
      </main>
      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}

function AssetsPage({ assets, selected, search, setSearch, onSend }: { assets: DemoAsset[]; selected: DemoAsset; search: string; setSearch: (value: string) => void; onSend: (asset: DemoAsset) => void }) {
  return <section className="page"><h1>Assets</h1><div className="assets-layout"><div><div className="card summary"><div><small>Total Assets</small><strong>4</strong></div><div><small>Total Balance (USD)</small><strong>≈ $1,842.50</strong></div></div><input className="search" value={search} placeholder="Search assets..." onChange={(event) => setSearch(event.target.value)} /><div className="card asset-list">{assets.map((entry) => <div className="asset-row" key={entry.symbol}><span className="coin small-coin" style={{ background: entry.color }}>{entry.symbol[0]}</span><strong>{entry.name}</strong><span>{entry.symbol}</span><span>{Number(entry.balance).toLocaleString()} {entry.symbol}</span><button className="secondary" onClick={() => onSend(entry)}>Send</button></div>)}</div></div><div className="card detail"><span className="coin detail-coin" style={{ background: selected.color }}>{selected.symbol[0]}</span><h2>{selected.symbol}</h2><p className="muted">{selected.name}</p><dl><div><dt>Decimals</dt><dd>{selected.decimals}</dd></div><div><dt>Balance</dt><dd>{Number(selected.balance).toLocaleString()} {selected.symbol}</dd></div><div><dt>Estimated Value</dt><dd>{selected.value}</dd></div></dl><button className="secondary full">Receive</button></div></div></section>;
}

function ActivityPage({ filter, setFilter, rows }: { filter: "all" | "sent" | "received"; setFilter: (value: "all" | "sent" | "received") => void; rows: ActivityItem[] }) {
  return <section className="page"><div className="activity-heading"><div><h1>Activity</h1></div><div className="card activity-summary"><div><small>Total sent (30d)</small><strong>1,240 DOT</strong></div><div><small>Total received (30d)</small><strong>320 DOT</strong></div></div></div><div className="tabs">{(["all", "sent", "received"] as const).map((entry) => <button className={filter === entry ? "active" : ""} key={entry} onClick={() => setFilter(entry)}>{entry[0].toUpperCase() + entry.slice(1)}</button>)}</div><div className="card activity-list">{rows.map((entry, index) => <div className="activity-row" key={`${entry.date}-${index}`}><span className={entry.direction === "sent" ? "sent" : "received"}>{entry.direction === "sent" ? "↗ Sent" : "↓ Received"}</span><strong>{entry.asset}</strong><span>{icon(entry.type)} {entry.recipient}<small>{recipientLabels[entry.type]}</small></span><strong>{entry.amount}</strong><small>{entry.date}</small></div>)}</div></section>;
}
