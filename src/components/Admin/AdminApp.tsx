import React from "react";
import { QRCodeSVG } from "qrcode.react";
import { useAuth } from "../../auth/AuthProvider";
import { config } from "../../config";
import "./admin.scss";

const apiBase = config.api.replace(/\/api$/, "/api");

type Tab = "stats" | "users" | "rounds" | "withdrawals" | "wallets" | "channels" | "bots" | "webhooks" | "settings";

interface Stats {
  engine: { phase: string; multiplier: number; players: number; historyLen: number };
  users: { total: number; banned: number };
  last24h: { bets: number; rounds: number; wagered: number; paidOut: number; ggr: number; houseEdgePct: number };
  config: { minBet: number; maxBet: number; houseEdge: number; betDurationMs: number };
}

interface UserRow {
  userName: string;
  phone?: string;
  email?: string;
  balance: number;
  isAdmin: boolean;
  banned: boolean;
  bannedReason?: string;
  telegramId?: number;
  sid?: string;
  referrer?: string;
  referralEarned?: number;
  createdAt: string;
  lastLoginAt?: string;
}

interface RoundRow {
  roundId: number;
  crashPoint: number;
  serverSeedHash: string;
  betCount: number;
  totalBetAmount: number;
  totalCashout: number;
  createdAt: string;
}

const useApi = () => {
  const { token, logout } = useAuth();
  return React.useCallback(
    async (path: string, init: RequestInit = {}) => {
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
        ...(init.headers as Record<string, string> | undefined),
      };
      if (token) headers.authorization = `Bearer ${token}`;
      const res = await fetch(`${apiBase}${path}`, { ...init, headers });
      if (res.status === 401) { logout(); throw new Error("unauthorised"); }
      const body = await res.json();
      if (!res.ok) throw new Error(body.message || `HTTP ${res.status}`);
      return body;
    },
    [token, logout],
  );
};

export const AdminApp: React.FC = () => {
  const { user, logout } = useAuth();
  const [tab, setTab] = React.useState<Tab>("stats");

  return (
    <div className="admin-app">
      <header className="admin-header">
        <div className="admin-brand">⚙️ AVIATOR ADMIN</div>
        <nav className="admin-nav">
          <button className={tab === "stats" ? "active" : ""} onClick={() => setTab("stats")}>Stats</button>
          <button className={tab === "users" ? "active" : ""} onClick={() => setTab("users")}>Users</button>
          <button className={tab === "rounds" ? "active" : ""} onClick={() => setTab("rounds")}>Rounds</button>
          <button className={tab === "withdrawals" ? "active" : ""} onClick={() => setTab("withdrawals")}>Withdrawals</button>
          <button className={tab === "wallets" ? "active" : ""} onClick={() => setTab("wallets")}>Wallets</button>
          <button className={tab === "channels" ? "active" : ""} onClick={() => setTab("channels")}>Channels</button>
          <button className={tab === "bots" ? "active" : ""} onClick={() => setTab("bots")}>Bots</button>
          <button className={tab === "webhooks" ? "active" : ""} onClick={() => setTab("webhooks")}>Webhooks</button>
          <button className={tab === "settings" ? "active" : ""} onClick={() => setTab("settings")}>Settings</button>
        </nav>
        <div className="admin-user">
          <span>{user?.userName}</span>
          <button onClick={logout}>Sign out</button>
        </div>
      </header>

      <main className="admin-body">
        {tab === "stats" && <StatsTab />}
        {tab === "users" && <UsersTab />}
        {tab === "rounds" && <RoundsTab />}
        {tab === "withdrawals" && <WithdrawalsTab />}
        {tab === "wallets" && <WalletsTab />}
        {tab === "channels" && <ChannelsTab />}
        {tab === "bots" && <BotsTab />}
        {tab === "webhooks" && <WebhooksTab />}
        {tab === "settings" && <SettingsTab />}
      </main>
    </div>
  );
};

// ---------------------------------- Stats ----------------------------------

const StatsTab: React.FC = () => {
  const api = useApi();
  const [stats, setStats] = React.useState<Stats | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [tick, setTick] = React.useState(0);

  React.useEffect(() => {
    api("/admin/stats")
      .then(setStats)
      .catch((e) => setError(e.message));
  }, [api, tick]);

  React.useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 5000);
    return () => clearInterval(id);
  }, []);

  if (error) return <div className="admin-error">⚠ {error}</div>;
  if (!stats) return <div className="admin-loading">Loading…</div>;

  const fmt = (n: number) => n.toLocaleString("en-US", { maximumFractionDigits: 0 });

  return (
    <div className="admin-stats">
      <section className="stat-grid">
        <Stat label="Total users"        value={fmt(stats.users.total)} />
        <Stat label="Banned"             value={fmt(stats.users.banned)} accent={stats.users.banned > 0 ? "warn" : undefined} />
        <Stat label="Live players"       value={fmt(stats.engine.players)} accent="ok" />
        <Stat label="Engine phase"       value={stats.engine.phase} />
        <Stat label="Current multiplier" value={`${stats.engine.multiplier.toFixed(2)}x`} />
        <Stat label="History length"     value={fmt(stats.engine.historyLen)} />
      </section>

      <h2>Last 24 hours</h2>
      <section className="stat-grid">
        <Stat label="Rounds"        value={fmt(stats.last24h.rounds)} />
        <Stat label="Bets"          value={fmt(stats.last24h.bets)} />
        <Stat label="Wagered"       value={`₹${fmt(stats.last24h.wagered)}`} />
        <Stat label="Paid out"      value={`₹${fmt(stats.last24h.paidOut)}`} />
        <Stat label="GGR"           value={`₹${fmt(stats.last24h.ggr)}`} accent="ok" />
        <Stat label="Realised edge" value={`${stats.last24h.houseEdgePct}%`} />
      </section>

      <h2>Configuration</h2>
      <section className="stat-grid">
        <Stat label="Min bet"        value={`₹${stats.config.minBet}`} />
        <Stat label="Max bet"        value={`₹${stats.config.maxBet}`} />
        <Stat label="House edge"     value={`${(stats.config.houseEdge * 100).toFixed(1)}%`} />
        <Stat label="BET duration"   value={`${stats.config.betDurationMs / 1000}s`} />
      </section>
    </div>
  );
};

const Stat: React.FC<{ label: string; value: string; accent?: "ok" | "warn" }> = ({ label, value, accent }) => (
  <div className={`stat ${accent || ""}`}>
    <div className="stat-label">{label}</div>
    <div className="stat-value">{value}</div>
  </div>
);

// ---------------------------------- Users ----------------------------------

const UsersTab: React.FC = () => {
  const api = useApi();
  const [items, setItems] = React.useState<UserRow[]>([]);
  const [total, setTotal] = React.useState(0);
  const [q, setQ] = React.useState("");
  const [editing, setEditing] = React.useState<UserRow | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  const load = React.useCallback(() => {
    api(`/admin/users?q=${encodeURIComponent(q)}&limit=50`)
      .then((r) => { setItems(r.items); setTotal(r.total); })
      .catch((e) => setError(e.message));
  }, [api, q]);

  React.useEffect(() => { load(); }, [load]);

  return (
    <div className="admin-users">
      <div className="users-toolbar">
        <input
          type="search"
          placeholder="Search by username / phone / email…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <span className="users-total">{total} users</span>
      </div>

      {error && <div className="admin-error">⚠ {error}</div>}

      <table className="admin-table">
        <thead>
          <tr>
            <th>Username</th><th>Phone</th><th>Balance</th><th>Role</th>
            <th>SID</th><th>Referrer</th><th>Ref Earned</th>
            <th>Status</th><th>Created</th><th>Actions</th>
          </tr>
        </thead>
        <tbody>
          {items.map((u) => (
            <tr key={u.userName} className={u.banned ? "row-banned" : ""}>
              <td>{u.userName}{u.telegramId ? <span className="tag tg">TG</span> : null}</td>
              <td>{u.phone || "—"}</td>
              <td className="num">₹{u.balance.toFixed(2)}</td>
              <td>{u.isAdmin ? <span className="tag admin">ADMIN</span> : "player"}</td>
              <td>{u.sid || "—"}</td>
              <td>{u.referrer || "—"}</td>
              <td className="num">₹{(u.referralEarned || 0).toFixed(2)}</td>
              <td>{u.banned ? <span className="tag banned">BANNED</span> : "active"}</td>
              <td>{new Date(u.createdAt).toLocaleDateString()}</td>
              <td><button onClick={() => setEditing(u)}>Edit</button></td>
            </tr>
          ))}
          {items.length === 0 && <tr><td colSpan={10} className="empty">No users</td></tr>}
        </tbody>
      </table>

      {editing && (
        <UserEditModal
          user={editing}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); load(); }}
        />
      )}
    </div>
  );
};

const UserEditModal: React.FC<{ user: UserRow; onClose: () => void; onSaved: () => void }> = ({
  user, onClose, onSaved,
}) => {
  const api = useApi();
  const [balance, setBalance] = React.useState(user.balance);
  const [banned, setBanned] = React.useState(user.banned);
  const [bannedReason, setBannedReason] = React.useState(user.bannedReason || "");
  const [isAdmin, setIsAdmin] = React.useState(user.isAdmin);
  const [error, setError] = React.useState<string | null>(null);
  const [saving, setSaving] = React.useState(false);

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      await api(`/admin/users/${encodeURIComponent(user.userName)}`, {
        method: "PATCH",
        body: JSON.stringify({ balance, banned, bannedReason, isAdmin }),
      });
      onSaved();
    } catch (e: any) {
      setError(e.message);
    } finally { setSaving(false); }
  };

  return (
    <div className="admin-modal-overlay" onClick={onClose}>
      <div className="admin-modal" onClick={(e) => e.stopPropagation()}>
        <h3>Edit {user.userName}</h3>

        <label>
          <span>Balance (₹)</span>
          <input type="number" value={balance} onChange={(e) => setBalance(Number(e.target.value))} min={0} step="0.01" />
        </label>

        <label className="checkbox">
          <input type="checkbox" checked={isAdmin} onChange={(e) => setIsAdmin(e.target.checked)} />
          <span>Admin role</span>
        </label>

        <label className="checkbox">
          <input type="checkbox" checked={banned} onChange={(e) => setBanned(e.target.checked)} />
          <span>Banned</span>
        </label>

        {banned && (
          <label>
            <span>Ban reason</span>
            <input type="text" value={bannedReason} onChange={(e) => setBannedReason(e.target.value)} />
          </label>
        )}

        {error && <div className="admin-error">⚠ {error}</div>}

        <div className="admin-modal-actions">
          <button onClick={onClose} disabled={saving}>Cancel</button>
          <button className="primary" onClick={save} disabled={saving}>
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
};

// ---------------------------------- Rounds ----------------------------------

const RoundsTab: React.FC = () => {
  const api = useApi();
  const [items, setItems] = React.useState<RoundRow[]>([]);
  const [error, setError] = React.useState<string | null>(null);
  const [tick, setTick] = React.useState(0);

  React.useEffect(() => {
    api("/admin/rounds?limit=50")
      .then((r) => setItems(r.items))
      .catch((e) => setError(e.message));
  }, [api, tick]);

  React.useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 7000);
    return () => clearInterval(id);
  }, []);

  if (error) return <div className="admin-error">⚠ {error}</div>;

  const colorFor = (m: number) =>
    m < 2 ? "var(--admin-blue)" : m < 10 ? "var(--admin-purple)" : "var(--admin-gold)";

  return (
    <div className="admin-rounds">
      <table className="admin-table">
        <thead>
          <tr>
            <th>#</th><th>Crash</th><th>Bets</th><th>Wagered</th>
            <th>Paid out</th><th>House P&L</th><th>Seed hash</th><th>When</th>
          </tr>
        </thead>
        <tbody>
          {items.map((r) => (
            <tr key={r.roundId}>
              <td>{r.roundId}</td>
              <td><strong style={{ color: colorFor(r.crashPoint) }}>{r.crashPoint.toFixed(2)}x</strong></td>
              <td>{r.betCount}</td>
              <td className="num">₹{r.totalBetAmount.toFixed(2)}</td>
              <td className="num">₹{r.totalCashout.toFixed(2)}</td>
              <td className="num"><strong>₹{(r.totalBetAmount - r.totalCashout).toFixed(2)}</strong></td>
              <td className="seed">{r.serverSeedHash.slice(0, 12)}…</td>
              <td>{new Date(r.createdAt).toLocaleTimeString()}</td>
            </tr>
          ))}
          {items.length === 0 && <tr><td colSpan={8} className="empty">No rounds</td></tr>}
        </tbody>
      </table>
    </div>
  );
};

// --------------------------------- Settings -------------------------------

interface SettingsData {
  maxCrashMultiplier: number;
  houseEdge: number;
  minBet: number;
  maxBet: number;
  initialBalance: number;
  cryptoMinUsdt: number;
  cryptoMaxUsdt: number;
  usdtInrRateFallback: number;
  botMinCount: number;
  botMaxCount: number;
  referralRewardInr: number;
  withdrawalFeePct: number;
  withdrawalMinInr: number;
  wagerMultiplier: number;
  withdrawalReviewAboveInr: number;
  withdrawalReviewNewAccountHours: number;
  registerMaxPerIp24h: number;
  inrRechargeEnabled: number;
  usdtAutoPayoutEnabled: number;
  usdtAutoPayoutMaxInr: number;
  updatedAt?: string;
  updatedBy?: string;
}

type SettingsFieldType = "number" | "text" | "secret";
const SETTINGS_FIELDS: { key: keyof SettingsData; label: string; hint: string; group: string; type?: SettingsFieldType }[] = [
  { group: "Game", key: "maxCrashMultiplier", label: "Max crash multiplier", hint: "Cap on max payout (eg 100 = 100x). Lower = less variance for operator." },
  { group: "Game", key: "houseEdge", label: "House edge", hint: "0.03 = 3%. Higher = better operator margin, lower player RTP." },
  { group: "Game", key: "minBet", label: "Min bet (INR)", hint: "Smallest allowed wager." },
  { group: "Game", key: "maxBet", label: "Max bet (INR)", hint: "Largest allowed wager per side." },
  { group: "Game", key: "initialBalance", label: "Initial balance (new user)", hint: "Free balance new users start with. 0 to disable." },
  { group: "Crypto", key: "cryptoMinUsdt", label: "Min crypto recharge (USDT)", hint: "Order rejected below this." },
  { group: "Crypto", key: "cryptoMaxUsdt", label: "Max crypto recharge (USDT)", hint: "Order rejected above this." },
  { group: "Crypto", key: "usdtInrRateFallback", label: "USDT/INR fallback rate", hint: "Used when CoinGecko unreachable." },
  { group: "Bots", key: "botMinCount", label: "Bot min per round", hint: "Lower bound of random fake-player count." },
  { group: "Bots", key: "botMaxCount", label: "Bot max per round", hint: "Upper bound (5-15 = lively, 0-0 = none)." },
  { group: "Referral", key: "referralRewardInr", label: "Reward per recharge/payout (INR)", hint: "Credited to referrer EACH TIME a referred user recharges OR withdraws. 0 to disable referrals." },
  { group: "Withdrawal", key: "withdrawalFeePct", label: "Fee on top (%)", hint: "0.05 = 5%. Charged ON TOP of withdrawal amount: user requests ₹1000 → balance −₹1050." },
  { group: "Withdrawal", key: "withdrawalMinInr", label: "Minimum (INR)", hint: "Smallest gross withdrawal accepted." },
  { group: "Withdrawal", key: "wagerMultiplier", label: "Wager multiplier", hint: "1.0 = recharge of ₹X must be wagered ₹X before becoming withdrawable. 0 disables playthrough lock." },
  { group: "Anti-abuse", key: "withdrawalReviewAboveInr", label: "Review above (INR)", hint: "Withdrawals at or above this gross amount auto-flagged for admin review. 0 disables." },
  { group: "Anti-abuse", key: "withdrawalReviewNewAccountHours", label: "Review new account (hours)", hint: "If account younger than this and withdrawing → flagged for review. 0 disables." },
  { group: "Anti-abuse", key: "registerMaxPerIp24h", label: "Max registrations / IP / 24h", hint: "Hard cap on new accounts from one IP per day. 3 = real users uneffected, bot farms blocked. 0 disables." },
  { group: "Recharge", key: "inrRechargeEnabled", label: "INR channel enabled (1=on, 0=off)", hint: "Single switch for BOTH INR top-up AND bank withdrawal. Turn ON only AFTER a real payment provider (Razorpay/Cashfree) is wired in for recharge AND a real payout adapter for bank transfer. While OFF, both routes return 403 and the in-app sheets hide the Bank/INR tabs. USDT recharge + USDT withdrawal unaffected." },
  { group: "Auto-payout", key: "usdtAutoPayoutEnabled", label: "USDT auto-payout (1=on, 0=off)", hint: "When ON: USDT withdrawals under the cap broadcast to TRON automatically (no admin click). Bank withdrawals always manual. Default OFF — opt in when comfortable." },
  { group: "Auto-payout", key: "usdtAutoPayoutMaxInr", label: "Auto-payout cap (INR)", hint: "USDT withdrawals at or above this stay in 'processing' awaiting admin Approve. Below this and auto-on → instant broadcast. Set 2000-5000 for sensible mid-range automation." },
  // Payme moved to the Channels tab — see admin → Channels.
];

// ================================ Channels ================================

interface ProviderTypeInfo {
  name: string;
  displayName: string;
  countries: string[];
  supports: { payin: boolean; payout: boolean };
  credentialFields: FieldSpecApi[];
  paramFields: FieldSpecApi[];
}
interface FieldSpecApi {
  key: string;
  label: string;
  kind: "text" | "secret" | "select" | "number";
  required?: boolean;
  default?: string;
  hint?: string;
  options?: { value: string; label: string }[];
}
interface ChannelRow {
  code: string;
  name: string;
  provider: string;
  providerDisplayName: string;
  country: string;
  enabled: boolean;
  supports: { payin: boolean; payout: boolean };
  credentials: Record<string, string>;
  params: Record<string, string>;
  priority: number;
  callbackIpAllowlist: string;
  createdAt: string;
  updatedAt: string;
}

const ChannelsTab: React.FC = () => {
  const api = useApi();
  const [types, setTypes] = React.useState<ProviderTypeInfo[]>([]);
  const [rows, setRows] = React.useState<ChannelRow[]>([]);
  const [editing, setEditing] = React.useState<{ row?: ChannelRow; newProvider?: string } | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [balances, setBalances] = React.useState<Record<string, number>>({});
  const [drillingChannel, setDrillingChannel] = React.useState<string | null>(null);
  const [adjustingChannel, setAdjustingChannel] = React.useState<string | null>(null);

  const load = React.useCallback(async () => {
    setLoading(true);
    try {
      const [t, r] = await Promise.all([
        api("/admin/channels/types"),
        api("/admin/channels"),
      ]);
      setTypes(t.data || []);
      setRows(r.data || []);
      setError(null);
      // Fetch balance for each channel in parallel — small N so OK
      const bals = await Promise.all(
        (r.data || []).map((row: ChannelRow) =>
          api(`/admin/channels/${row.code}/balance`).then((rb: any) => [row.code, rb.data?.balanceInr ?? 0] as [string, number]).catch(() => [row.code, 0] as [string, number])
        ),
      );
      setBalances(Object.fromEntries(bals));
    } catch (e) { setError((e as Error).message); }
    finally { setLoading(false); }
  }, [api]);

  React.useEffect(() => { load(); }, [load]);

  const onDelete = async (code: string) => {
    if (!window.confirm(`Delete channel "${code}"? Active orders using it will keep working until they settle.`)) return;
    try { await api(`/admin/channels/${code}`, { method: "DELETE" }); load(); }
    catch (e) { alert((e as Error).message); }
  };

  const onToggle = async (row: ChannelRow) => {
    try {
      await api(`/admin/channels/${row.code}`, {
        method: "PATCH",
        body: JSON.stringify({ enabled: !row.enabled }),
      });
      load();
    } catch (e) { alert((e as Error).message); }
  };

  const onTest = async (code: string) => {
    try {
      const r = await api(`/admin/channels/${code}/test`, { method: "POST" });
      alert(`Test: ${r.data?.message || "ok"}`);
    } catch (e) { alert("Test failed: " + (e as Error).message); }
  };

  return (
    <div className="admin-channels">
      <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 12 }}>
        <h3 style={{ margin: 0, fontSize: 14 }}>Payment channels ({rows.length})</h3>
        <button onClick={load} disabled={loading}>↻ Refresh</button>
        <select
          onChange={(e) => {
            if (e.target.value) {
              setEditing({ newProvider: e.target.value });
              e.target.value = "";
            }
          }}
          defaultValue=""
          style={{ marginLeft: "auto" }}
        >
          <option value="">+ Add channel…</option>
          {types.map((t) => (
            <option key={t.name} value={t.name}>{t.displayName}</option>
          ))}
        </select>
      </div>

      {error && <div className="admin-error">⚠ {error}</div>}

      <table className="admin-table">
        <thead>
          <tr>
            <th>Code</th><th>Name</th><th>Provider</th><th>Country</th>
            <th>Supports</th><th className="num">Balance (INR)</th><th className="num">Priority</th><th>Enabled</th><th>Actions</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.code}>
              <td><code style={{ fontSize: 11 }}>{r.code}</code></td>
              <td>{r.name}</td>
              <td>{r.providerDisplayName}</td>
              <td>{r.country}</td>
              <td style={{ fontSize: 11 }}>
                {r.supports.payin && <span className="tag" style={{ background: "rgba(86,224,154,0.18)", color: "#56e09a", marginRight: 4 }}>payin</span>}
                {r.supports.payout && <span className="tag" style={{ background: "rgba(255,200,87,0.18)", color: "#ffc857" }}>payout</span>}
              </td>
              <td className="num">
                <strong style={{ color: (balances[r.code] || 0) >= 0 ? "#56e09a" : "#ff5468" }}>
                  ₹{(balances[r.code] ?? 0).toLocaleString("en-IN", { maximumFractionDigits: 2 })}
                </strong>
              </td>
              <td className="num">{r.priority}</td>
              <td>
                <label style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                  <input type="checkbox" checked={r.enabled} onChange={() => onToggle(r)} />
                  {r.enabled ? "on" : "off"}
                </label>
              </td>
              <td style={{ whiteSpace: "nowrap" }}>
                <button onClick={() => setDrillingChannel(r.code)} style={{ marginRight: 4 }} title="View ledger">📒</button>
                <button onClick={() => setAdjustingChannel(r.code)} style={{ marginRight: 4 }} title="Adjust balance (manual withdraw / credit)">±</button>
                <button onClick={() => setEditing({ row: r })} style={{ marginRight: 4 }}>Edit</button>
                <button onClick={() => onTest(r.code)} style={{ marginRight: 4 }}>Test</button>
                <button onClick={() => onDelete(r.code)}>Delete</button>
              </td>
            </tr>
          ))}
          {rows.length === 0 && <tr><td colSpan={9} className="empty">No channels configured. Pick a provider type from the dropdown above to add one.</td></tr>}
        </tbody>
      </table>

      {drillingChannel && (
        <ChannelLedgerModal
          channelCode={drillingChannel}
          onClose={() => setDrillingChannel(null)}
        />
      )}
      {adjustingChannel && (
        <ChannelAdjustModal
          channelCode={adjustingChannel}
          currentBalance={balances[adjustingChannel] || 0}
          onClose={() => setAdjustingChannel(null)}
          onSaved={() => { setAdjustingChannel(null); load(); }}
        />
      )}

      {editing && (
        <ChannelEditModal
          types={types}
          row={editing.row}
          newProvider={editing.newProvider}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); load(); }}
        />
      )}
    </div>
  );
};

const ChannelEditModal: React.FC<{
  types: ProviderTypeInfo[];
  row?: ChannelRow;
  newProvider?: string;
  onClose: () => void;
  onSaved: () => void;
}> = ({ types, row, newProvider, onClose, onSaved }) => {
  const api = useApi();
  const isNew = !row;
  const providerName = row?.provider || newProvider!;
  const type = types.find((t) => t.name === providerName);

  const [code, setCode] = React.useState(row?.code || "");
  const [name, setName] = React.useState(row?.name || "");
  const [country, setCountry] = React.useState(row?.country || (type?.countries[0] || ""));
  const [enabled, setEnabled] = React.useState(row?.enabled ?? false);
  const [supportsPayin, setSupportsPayin] = React.useState(row?.supports.payin ?? !!type?.supports.payin);
  const [supportsPayout, setSupportsPayout] = React.useState(row?.supports.payout ?? !!type?.supports.payout);
  const [priority, setPriority] = React.useState(row?.priority ?? 100);
  const [ipAllowlist, setIpAllowlist] = React.useState(row?.callbackIpAllowlist ?? "");
  const initCreds: Record<string, string> = React.useMemo(() => {
    const out: Record<string, string> = {};
    type?.credentialFields.forEach((f) => { out[f.key] = row?.credentials[f.key] || ""; });
    return out;
  }, [type, row]);
  const initParams: Record<string, string> = React.useMemo(() => {
    const out: Record<string, string> = {};
    type?.paramFields.forEach((f) => { out[f.key] = row?.params[f.key] ?? (f.default || ""); });
    return out;
  }, [type, row]);
  const [creds, setCreds] = React.useState<Record<string, string>>(initCreds);
  const [params, setParams] = React.useState<Record<string, string>>(initParams);
  const [busy, setBusy] = React.useState(false);
  const [err, setErr] = React.useState<string | null>(null);

  if (!type) return null;

  const save = async () => {
    setBusy(true); setErr(null);
    try {
      const body: any = {
        name, country, enabled, priority,
        callbackIpAllowlist: ipAllowlist,
        supports: { payin: supportsPayin, payout: supportsPayout },
        credentials: creds,
        params,
      };
      if (isNew) {
        body.code = code;
        body.provider = providerName;
        await api("/admin/channels", { method: "POST", body: JSON.stringify(body) });
      } else {
        await api(`/admin/channels/${row!.code}`, { method: "PATCH", body: JSON.stringify(body) });
      }
      onSaved();
    } catch (e) { setErr((e as Error).message); }
    finally { setBusy(false); }
  };

  return (
    <div className="admin-modal-overlay" onClick={onClose}>
      <div className="admin-modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 560 }}>
        <h3>{isNew ? `New ${type.displayName} channel` : `Edit ${row!.code}`}</h3>

        {isNew && (
          <label>
            <span>Code (stable identifier)</span>
            <input type="text" value={code} onChange={(e) => setCode(e.target.value)} placeholder="e.g. payme-in-1" />
          </label>
        )}
        <label>
          <span>Display name</span>
          <input type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Payme India (primary)" />
        </label>
        <label>
          <span>Country</span>
          <select value={country} onChange={(e) => setCountry(e.target.value)}>
            {type.countries.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </label>
        <div style={{ display: "flex", gap: 16, marginTop: 8 }}>
          <label className="checkbox">
            <input type="checkbox" checked={supportsPayin} disabled={!type.supports.payin} onChange={(e) => setSupportsPayin(e.target.checked)} />
            <span>Payin (recharge)</span>
          </label>
          <label className="checkbox">
            <input type="checkbox" checked={supportsPayout} disabled={!type.supports.payout} onChange={(e) => setSupportsPayout(e.target.checked)} />
            <span>Payout (withdrawal)</span>
          </label>
          <label className="checkbox">
            <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
            <span>Enabled</span>
          </label>
        </div>
        <label>
          <span>Priority (higher = preferred)</span>
          <input type="number" value={priority} onChange={(e) => setPriority(Number(e.target.value))} />
        </label>
        <label>
          <span>Callback IP allowlist</span>
          <input
            type="text"
            value={ipAllowlist}
            onChange={(e) => setIpAllowlist(e.target.value)}
            placeholder="e.g. 16.163.88.85, 54.46.98.55, 10.0.0.0/24"
          />
          <span className="admin-settings-hint" style={{ display: "block", fontSize: 10.5, opacity: 0.7 }}>
            Comma-separated IPs and/or CIDR blocks that may POST webhook callbacks for this channel. Leave empty to skip the IP gate (signature alone authenticates). Strongly recommended to fill with the provider's documented callback IPs.
          </span>
        </label>

        <h4 style={{ marginTop: 16, marginBottom: 4, fontSize: 12, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--admin-muted)" }}>Credentials</h4>
        {type.credentialFields.map((f) => (
          <label key={f.key}>
            <span>{f.label}{f.required && " *"}</span>
            {f.kind === "select" ? (
              <select value={creds[f.key] || ""} onChange={(e) => setCreds((c) => ({ ...c, [f.key]: e.target.value }))}>
                <option value=""></option>
                {(f.options || []).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            ) : (
              <input
                type={f.kind === "secret" ? "password" : "text"}
                value={creds[f.key] || ""}
                autoComplete="off" spellCheck={false}
                placeholder={f.kind === "secret" && creds[f.key]?.startsWith("••••") ? creds[f.key] : ""}
                onChange={(e) => setCreds((c) => ({ ...c, [f.key]: e.target.value }))}
              />
            )}
            {f.hint && <span className="admin-settings-hint" style={{ display: "block", fontSize: 10.5, opacity: 0.7 }}>{f.hint}</span>}
          </label>
        ))}

        {type.paramFields.length > 0 && (
          <>
            <h4 style={{ marginTop: 16, marginBottom: 4, fontSize: 12, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--admin-muted)" }}>Params</h4>
            {type.paramFields.map((f) => (
              <label key={f.key}>
                <span>{f.label}</span>
                {f.kind === "select" ? (
                  <select value={params[f.key] || ""} onChange={(e) => setParams((p) => ({ ...p, [f.key]: e.target.value }))}>
                    <option value=""></option>
                    {(f.options || []).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </select>
                ) : (
                  <input type="text" value={params[f.key] || ""} onChange={(e) => setParams((p) => ({ ...p, [f.key]: e.target.value }))} />
                )}
                {f.hint && <span className="admin-settings-hint" style={{ display: "block", fontSize: 10.5, opacity: 0.7 }}>{f.hint}</span>}
              </label>
            ))}
          </>
        )}

        {err && <div className="admin-error">⚠ {err}</div>}

        <div className="admin-modal-actions">
          <button onClick={onClose} disabled={busy}>Cancel</button>
          <button className="primary" onClick={save} disabled={busy}>{busy ? "Saving…" : (isNew ? "Create" : "Save")}</button>
        </div>
      </div>
    </div>
  );
};

// =========================== Channel ledger / adjust ===========================

interface LedgerRow {
  _id: string;
  direction: "credit" | "debit";
  amountInr: number;
  category: string;
  relatedOrderId?: string;
  note?: string;
  createdBy?: string;
  providerRef?: string;
  meta?: Record<string, unknown>;
  createdAt: string;
}

interface ChannelBalanceData {
  channelCode: string;
  balanceInr: number;
  totalIn: number;
  totalOut: number;
  byCategory: Record<string, number>;
  entryCount: number;
}

const ChannelLedgerModal: React.FC<{ channelCode: string; onClose: () => void }> = ({ channelCode, onClose }) => {
  const api = useApi();
  const [rows, setRows] = React.useState<LedgerRow[]>([]);
  const [balance, setBalance] = React.useState<ChannelBalanceData | null>(null);
  const [filter, setFilter] = React.useState<{ category: string; direction: string }>({ category: "", direction: "" });

  const load = React.useCallback(async () => {
    const qs = Object.entries(filter).filter(([, v]) => v).map(([k, v]) => `${k}=${v}`).join("&");
    const [bal, lg] = await Promise.all([
      api(`/admin/channels/${channelCode}/balance`),
      api(`/admin/channels/${channelCode}/ledger${qs ? "?" + qs : ""}`),
    ]);
    setBalance(bal.data);
    setRows(lg.items || []);
  }, [api, channelCode, filter]);

  React.useEffect(() => { load(); }, [load]);

  const categoryColor = (c: string): string => {
    if (c === "payin") return "#56e09a";
    if (c === "payin_fee") return "#ff9933";
    if (c === "payout") return "#ffc857";
    if (c === "payout_fee") return "#ff9933";
    if (c === "manual_credit") return "#56e09a";
    if (c === "manual_withdraw") return "#ff5468";
    return "var(--admin-muted)";
  };

  return (
    <div className="admin-modal-overlay" onClick={onClose}>
      <div className="admin-modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 760, maxHeight: "90vh", overflow: "auto" }}>
        <h3>Ledger — {channelCode}</h3>
        {balance && (
          <div style={{ background: "rgba(255,200,87,0.06)", padding: 10, borderRadius: 6, marginBottom: 12, fontSize: 12 }}>
            <div style={{ fontSize: 14 }}>
              <strong style={{ color: balance.balanceInr >= 0 ? "#56e09a" : "#ff5468" }}>
                Balance: ₹{balance.balanceInr.toLocaleString("en-IN", { maximumFractionDigits: 2 })}
              </strong>
            </div>
            <div style={{ marginTop: 4 }}>
              In: ₹{balance.totalIn.toLocaleString("en-IN")} · Out: ₹{balance.totalOut.toLocaleString("en-IN")} · {balance.entryCount} entries
            </div>
            <div style={{ marginTop: 4, fontSize: 11, opacity: 0.75 }}>
              By category: {Object.entries(balance.byCategory).map(([k, v]) => `${k}=₹${Number(v).toLocaleString("en-IN")}`).join(" · ")}
            </div>
          </div>
        )}
        <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
          <select value={filter.category} onChange={(e) => setFilter((f) => ({ ...f, category: e.target.value }))}>
            <option value="">Any category</option>
            <option value="payin">payin</option>
            <option value="payin_fee">payin_fee</option>
            <option value="payout">payout</option>
            <option value="payout_fee">payout_fee</option>
            <option value="manual_credit">manual_credit</option>
            <option value="manual_withdraw">manual_withdraw</option>
          </select>
          <select value={filter.direction} onChange={(e) => setFilter((f) => ({ ...f, direction: e.target.value }))}>
            <option value="">Any direction</option>
            <option value="credit">credit (+)</option>
            <option value="debit">debit (−)</option>
          </select>
        </div>
        <table className="admin-table">
          <thead>
            <tr>
              <th>Time</th><th>Category</th><th className="num">Amount</th>
              <th>Related</th><th>Note</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r._id}>
                <td className="seed">{new Date(r.createdAt).toLocaleString()}</td>
                <td>
                  <span className="tag" style={{ background: "rgba(255,255,255,0.05)", color: categoryColor(r.category), border: `1px solid ${categoryColor(r.category)}33` }}>
                    {r.category}
                  </span>
                </td>
                <td className="num" style={{ color: r.direction === "credit" ? "#56e09a" : "#ff5468" }}>
                  {r.direction === "credit" ? "+" : "−"}₹{r.amountInr.toLocaleString("en-IN", { maximumFractionDigits: 2 })}
                </td>
                <td className="seed">{r.relatedOrderId ? r.relatedOrderId.slice(0, 12) + "…" : "—"}</td>
                <td style={{ fontSize: 11 }}>
                  {r.note}
                  {r.createdBy && <span style={{ opacity: 0.6 }}> · by {r.createdBy}</span>}
                </td>
              </tr>
            ))}
            {rows.length === 0 && <tr><td colSpan={5} className="empty">No ledger entries yet</td></tr>}
          </tbody>
        </table>
        <div className="admin-modal-actions"><button onClick={onClose}>Close</button></div>
      </div>
    </div>
  );
};

const ChannelAdjustModal: React.FC<{
  channelCode: string;
  currentBalance: number;
  onClose: () => void;
  onSaved: () => void;
}> = ({ channelCode, currentBalance, onClose, onSaved }) => {
  const api = useApi();
  const [direction, setDirection] = React.useState<"credit" | "debit">("debit");
  const [amount, setAmount] = React.useState("");
  const [note, setNote] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [err, setErr] = React.useState<string | null>(null);

  const submit = async () => {
    setBusy(true); setErr(null);
    try {
      await api(`/admin/channels/${channelCode}/adjust`, {
        method: "POST",
        body: JSON.stringify({ direction, amountInr: Number(amount), note }),
      });
      onSaved();
    } catch (e) { setErr((e as Error).message); }
    finally { setBusy(false); }
  };

  const valid = Number(amount) > 0 && note.trim().length > 0;
  const projectedBalance = currentBalance + (direction === "credit" ? Number(amount) : -Number(amount));

  return (
    <div className="admin-modal-overlay" onClick={onClose}>
      <div className="admin-modal" onClick={(e) => e.stopPropagation()}>
        <h3>Adjust balance — {channelCode}</h3>
        <p style={{ fontSize: 11, opacity: 0.7, marginTop: -6 }}>
          Current balance: ₹{currentBalance.toLocaleString("en-IN", { maximumFractionDigits: 2 })}
        </p>
        <label>
          <span>Type</span>
          <select value={direction} onChange={(e) => setDirection(e.target.value as any)}>
            <option value="debit">Withdraw (−) — operator pulled funds out of gateway</option>
            <option value="credit">Credit (+) — top-up / refund / adjustment</option>
          </select>
        </label>
        <label>
          <span>Amount (INR)</span>
          <input type="number" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^\d.]/g, ""))} placeholder="0.00" />
        </label>
        <label>
          <span>Note (required — reason for the adjustment)</span>
          <input type="text" value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Withdraw to HDFC settlement A/C 2026-05-12" />
        </label>
        {Number(amount) > 0 && (
          <div style={{ background: "rgba(255,200,87,0.06)", padding: 8, borderRadius: 4, fontSize: 11, margin: "8px 0" }}>
            Balance after: <strong style={{ color: projectedBalance >= 0 ? "#56e09a" : "#ff5468" }}>
              ₹{projectedBalance.toLocaleString("en-IN", { maximumFractionDigits: 2 })}
            </strong>
          </div>
        )}
        {err && <div className="admin-error">⚠ {err}</div>}
        <div className="admin-modal-actions">
          <button onClick={onClose} disabled={busy}>Cancel</button>
          <button className="primary" onClick={submit} disabled={!valid || busy}>
            {busy ? "Saving…" : `Record ${direction}`}
          </button>
        </div>
      </div>
    </div>
  );
};

// ================================ Telegram Bots ================================

interface BotRow {
  code: string;
  name: string;
  username?: string;
  tokenMasked: string;
  webappUrl: string;
  startMessage?: string;
  startButtonLabel?: string;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

const BotsTab: React.FC = () => {
  const api = useApi();
  const [rows, setRows] = React.useState<BotRow[]>([]);
  const [error, setError] = React.useState<string | null>(null);
  const [editing, setEditing] = React.useState<{ row?: BotRow; isNew?: boolean } | null>(null);

  const load = React.useCallback(async () => {
    try {
      const r = await api("/admin/telegram-bots");
      setRows(r.data || []);
      setError(null);
    } catch (e) { setError((e as Error).message); }
  }, [api]);

  React.useEffect(() => { load(); }, [load]);

  const onToggle = async (row: BotRow) => {
    try {
      await api(`/admin/telegram-bots/${row.code}`, {
        method: "PATCH",
        body: JSON.stringify({ enabled: !row.enabled }),
      });
      load();
    } catch (e) { alert((e as Error).message); }
  };

  const onDelete = async (code: string) => {
    if (!window.confirm(`Delete bot "${code}"? Players who joined via this bot will fail re-auth.`)) return;
    try { await api(`/admin/telegram-bots/${code}`, { method: "DELETE" }); load(); }
    catch (e) { alert((e as Error).message); }
  };

  return (
    <div className="admin-bots">
      <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 12 }}>
        <h3 style={{ margin: 0, fontSize: 14 }}>Telegram bots ({rows.length})</h3>
        <button onClick={load}>↻ Refresh</button>
        <button className="primary" style={{ marginLeft: "auto" }} onClick={() => setEditing({ isNew: true })}>
          + Add bot
        </button>
      </div>

      {error && <div className="admin-error">⚠ {error}</div>}

      <p style={{ fontSize: 11, opacity: 0.7, marginTop: -4, marginBottom: 12 }}>
        Register multiple bots so a Telegram ban on one doesn't kill the funnel.
        Players who joined via any enabled bot can re-auth seamlessly — the
        backend tries each token until one matches.
      </p>

      <table className="admin-table">
        <thead>
          <tr>
            <th>Code</th><th>Name</th><th>@Username</th><th>Token</th>
            <th>WebApp URL</th><th>Enabled</th><th>Actions</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.code}>
              <td><code style={{ fontSize: 11 }}>{r.code}</code></td>
              <td>{r.name}</td>
              <td>{r.username ? `@${r.username}` : <span style={{ opacity: 0.5 }}>—</span>}</td>
              <td className="seed" style={{ fontSize: 10.5 }}>{r.tokenMasked}</td>
              <td className="seed" style={{ fontSize: 10.5 }}>{r.webappUrl || <span style={{ opacity: 0.5 }}>(env default)</span>}</td>
              <td>
                <label style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                  <input type="checkbox" checked={r.enabled} onChange={() => onToggle(r)} />
                  {r.enabled ? "on" : "off"}
                </label>
              </td>
              <td style={{ whiteSpace: "nowrap" }}>
                <button onClick={() => setEditing({ row: r })} style={{ marginRight: 4 }}>Edit</button>
                <button onClick={() => onDelete(r.code)}>Delete</button>
              </td>
            </tr>
          ))}
          {rows.length === 0 && <tr><td colSpan={7} className="empty">No bots configured. Click + Add bot to register one.</td></tr>}
        </tbody>
      </table>

      {editing && (
        <BotEditModal
          row={editing.row}
          isNew={!!editing.isNew}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); load(); }}
        />
      )}
    </div>
  );
};

const BotEditModal: React.FC<{
  row?: BotRow;
  isNew: boolean;
  onClose: () => void;
  onSaved: () => void;
}> = ({ row, isNew, onClose, onSaved }) => {
  const api = useApi();
  // Sensible defaults for NEW bots so admin only needs to paste a token.
  // Existing bots: use whatever is stored (empty fields fall through to
  // backend defaults at runtime).
  const defaultWebappUrl = (typeof window !== "undefined" && window.location?.origin) || "";
  const defaultStartMessage = "Welcome to Aviator Crash! Tap below to launch the game.";
  const defaultStartButton = "🛩️ Play Aviator";
  // Pseudo-random short code for new bots. Random suffix so we don't
  // collide with an existing "backup-1" — admin can edit if they prefer.
  const defaultCode = React.useMemo(
    () => `backup-${Math.random().toString(36).slice(2, 6)}`,
    [],
  );

  const [code, setCode] = React.useState(row?.code || (isNew ? defaultCode : ""));
  const [name, setName] = React.useState(row?.name || (isNew ? "Aviator Bot" : ""));
  const [token, setToken] = React.useState("");          // never pre-fill (masked)
  const [webappUrl, setWebappUrl] = React.useState(
    row?.webappUrl || (isNew ? defaultWebappUrl : ""),
  );
  const [startMessage, setStartMessage] = React.useState(
    row?.startMessage || (isNew ? defaultStartMessage : ""),
  );
  const [startButtonLabel, setStartButtonLabel] = React.useState(
    row?.startButtonLabel || (isNew ? defaultStartButton : ""),
  );
  const [enabled, setEnabled] = React.useState(row?.enabled ?? (isNew ? true : false));
  const [busy, setBusy] = React.useState(false);
  const [err, setErr] = React.useState<string | null>(null);

  const save = async () => {
    setBusy(true); setErr(null);
    try {
      const body: any = { name, webappUrl, startMessage, startButtonLabel, enabled };
      if (token.trim()) body.token = token.trim();
      if (isNew) {
        body.code = code;
        if (!body.token) {
          setErr("Token required for new bot");
          setBusy(false);
          return;
        }
        await api("/admin/telegram-bots", { method: "POST", body: JSON.stringify(body) });
      } else {
        await api(`/admin/telegram-bots/${row!.code}`, { method: "PATCH", body: JSON.stringify(body) });
      }
      onSaved();
    } catch (e) { setErr((e as Error).message); }
    finally { setBusy(false); }
  };

  return (
    <div className="admin-modal-overlay" onClick={onClose}>
      <div className="admin-modal" onClick={(e) => e.stopPropagation()}>
        <h3>{isNew ? "Add bot" : `Edit ${row!.code}`}</h3>
        <p style={{ fontSize: 11, opacity: 0.7, marginTop: -6 }}>
          Get your token from @BotFather → /newbot → copy "Use this token to access the HTTP API".
        </p>
        {isNew && (
          <label>
            <span>Code (stable identifier)</span>
            <input type="text" value={code} onChange={(e) => setCode(e.target.value)} placeholder="primary / backup-1 / ..." />
          </label>
        )}
        <label>
          <span>Display name</span>
          <input type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Aviator India (primary)" />
        </label>
        <label>
          <span>Bot token{!isNew && " (leave empty to keep current)"}</span>
          <input
            type="password"
            autoComplete="off" spellCheck={false}
            value={token}
            onChange={(e) => setToken(e.target.value)}
            placeholder={isNew ? "1234567890:ABCDEF..." : (row?.tokenMasked || "")}
          />
        </label>
        <label>
          <span>WebApp URL (optional — defaults to TELEGRAM_WEBAPP_URL env)</span>
          <input type="text" value={webappUrl} onChange={(e) => setWebappUrl(e.target.value)} placeholder="https://aviator.rummydeatly.com" />
        </label>
        <label>
          <span>/start reply text (optional)</span>
          <textarea
            value={startMessage}
            onChange={(e) => setStartMessage(e.target.value)}
            placeholder="Welcome to Aviator Crash! Tap below to launch the game."
            rows={3}
            style={{ width: "100%", boxSizing: "border-box", background: "var(--admin-bg-3)", border: "1px solid var(--admin-border)", color: "var(--admin-text)", padding: "8px 10px", borderRadius: 6, fontFamily: "inherit", fontSize: 13, resize: "vertical" }}
            maxLength={4000}
          />
          <span className="admin-settings-hint" style={{ display: "block", fontSize: 10.5, opacity: 0.7 }}>
            What the bot replies when user sends /start. Leave empty to use the default. Backup bots that may face Telegram-Ads review can use softer wording (avoid "crash" / "betting") to reduce auto-reject risk.
          </span>
        </label>
        <label>
          <span>/start button label (optional)</span>
          <input
            type="text"
            value={startButtonLabel}
            onChange={(e) => setStartButtonLabel(e.target.value)}
            placeholder="🛩️ Play Aviator"
            maxLength={64}
          />
          <span className="admin-settings-hint" style={{ display: "block", fontSize: 10.5, opacity: 0.7 }}>
            Text on the inline WebApp button below the /start reply.
          </span>
        </label>
        <label className="checkbox">
          <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
          <span>Enabled</span>
        </label>
        {err && <div className="admin-error">⚠ {err}</div>}
        <div className="admin-modal-actions">
          <button onClick={onClose} disabled={busy}>Cancel</button>
          <button className="primary" onClick={save} disabled={busy}>{busy ? "Saving…" : (isNew ? "Create" : "Save")}</button>
        </div>
      </div>
    </div>
  );
};

// ============================== Webhook Logs ==============================

interface WebhookLogRow {
  _id: string;
  channelCode?: string;
  direction: "payin" | "payout";
  ip: string;
  ipAllowed: boolean;
  signValid: boolean;
  outcome: string;
  orderNo?: string;
  platOrderNo?: string;
  orderStatus?: string;
  rawBody: string;
  headers: Record<string, string>;
  responseStatus: number;
  responseBody: string;
  note?: string;
  createdAt: string;
}

const WebhooksTab: React.FC = () => {
  const api = useApi();
  const [rows, setRows] = React.useState<WebhookLogRow[]>([]);
  const [total, setTotal] = React.useState(0);
  const [error, setError] = React.useState<string | null>(null);
  const [filters, setFilters] = React.useState({
    channelCode: "", direction: "", outcome: "", orderNo: "", platOrderNo: "", ip: "", from: "", to: "",
  });
  const [detailRow, setDetailRow] = React.useState<WebhookLogRow | null>(null);

  const load = React.useCallback(async () => {
    try {
      const qs = Object.entries(filters)
        .filter(([, v]) => v)
        .map(([k, v]) => `${k}=${encodeURIComponent(v)}`)
        .join("&");
      const r = await api(`/admin/webhook-logs${qs ? "?" + qs : ""}`);
      setRows(r.items || []);
      setTotal(r.total || 0);
      setError(null);
    } catch (e) { setError((e as Error).message); }
  }, [api, filters]);

  React.useEffect(() => { load(); }, [load]);

  const setF = (key: keyof typeof filters, value: string) =>
    setFilters((f) => ({ ...f, [key]: value }));

  const clearFilters = () => setFilters({ channelCode: "", direction: "", outcome: "", orderNo: "", platOrderNo: "", ip: "", from: "", to: "" });

  const outcomeColor = (o: string): string => {
    if (o === "ok-paid") return "#56e09a";
    if (o === "ok-failed") return "#ffb0bc";
    if (o.startsWith("rejected")) return "#ff5468";
    if (o === "order-not-found") return "#ffc857";
    return "var(--admin-muted)";
  };

  return (
    <div className="admin-webhooks">
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 8, marginBottom: 12 }}>
        <input type="text" placeholder="Channel code" value={filters.channelCode} onChange={(e) => setF("channelCode", e.target.value)} />
        <select value={filters.direction} onChange={(e) => setF("direction", e.target.value)}>
          <option value="">Any direction</option>
          <option value="payin">payin</option>
          <option value="payout">payout</option>
        </select>
        <select value={filters.outcome} onChange={(e) => setF("outcome", e.target.value)}>
          <option value="">Any outcome</option>
          <option value="ok-paid">ok-paid</option>
          <option value="ok-failed">ok-failed</option>
          <option value="rejected-ip">rejected-ip</option>
          <option value="rejected-sig">rejected-sig</option>
          <option value="order-not-found">order-not-found</option>
          <option value="error">error</option>
        </select>
        <input type="text" placeholder="Order no" value={filters.orderNo} onChange={(e) => setF("orderNo", e.target.value)} />
        <input type="text" placeholder="Plat order no" value={filters.platOrderNo} onChange={(e) => setF("platOrderNo", e.target.value)} />
        <input type="text" placeholder="Source IP" value={filters.ip} onChange={(e) => setF("ip", e.target.value)} />
        <input type="datetime-local" value={filters.from} onChange={(e) => setF("from", e.target.value)} title="From" />
        <input type="datetime-local" value={filters.to} onChange={(e) => setF("to", e.target.value)} title="To" />
      </div>
      <div style={{ display: "flex", gap: 8, marginBottom: 12, alignItems: "center" }}>
        <button onClick={load}>↻ Refresh</button>
        <button onClick={clearFilters}>Clear filters</button>
        <span style={{ marginLeft: "auto", fontSize: 11, opacity: 0.6 }}>
          Showing {rows.length} of {total} logs (90-day TTL)
        </span>
      </div>

      {error && <div className="admin-error">⚠ {error}</div>}

      <table className="admin-table">
        <thead>
          <tr>
            <th>Time</th><th>Channel</th><th>Dir</th><th>IP</th>
            <th>Outcome</th><th>Order</th><th>Status</th><th></th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r._id}>
              <td className="seed">{new Date(r.createdAt).toLocaleString()}</td>
              <td><code style={{ fontSize: 11 }}>{r.channelCode || "—"}</code></td>
              <td>{r.direction}</td>
              <td className="seed">
                {r.ip}
                {!r.ipAllowed && <span title="IP not on allowlist" style={{ marginLeft: 4, color: "#ff5468" }}>⛔</span>}
              </td>
              <td>
                <span className="tag" style={{ background: "rgba(255,255,255,0.05)", color: outcomeColor(r.outcome), border: `1px solid ${outcomeColor(r.outcome)}33` }}>
                  {r.outcome}
                </span>
                {!r.signValid && <div className="seed" style={{ color: "#ff5468" }}>bad signature</div>}
              </td>
              <td className="seed">{r.orderNo || r.platOrderNo || "—"}</td>
              <td>{r.orderStatus || "—"}</td>
              <td><button onClick={() => setDetailRow(r)}>View</button></td>
            </tr>
          ))}
          {rows.length === 0 && <tr><td colSpan={8} className="empty">No webhook callbacks logged yet</td></tr>}
        </tbody>
      </table>

      {detailRow && (
        <div className="admin-modal-overlay" onClick={() => setDetailRow(null)}>
          <div className="admin-modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 720 }}>
            <h3>Webhook detail — {detailRow.outcome}</h3>
            <div style={{ fontSize: 11, marginBottom: 12 }}>
              <div>Time:    <code>{new Date(detailRow.createdAt).toISOString()}</code></div>
              <div>Channel: <code>{detailRow.channelCode || "(legacy provider)"}</code></div>
              <div>Direction: {detailRow.direction}</div>
              <div>IP: <code>{detailRow.ip}</code> {detailRow.ipAllowed ? "✓ allowed" : "✗ rejected"}</div>
              <div>Sig: {detailRow.signValid ? "✓ valid" : "✗ invalid"}</div>
              <div>Order no: <code>{detailRow.orderNo || "—"}</code></div>
              <div>Plat order no: <code>{detailRow.platOrderNo || "—"}</code></div>
              <div>Order status: {detailRow.orderStatus || "—"}</div>
              {detailRow.note && <div>Note: {detailRow.note}</div>}
            </div>
            <h4 style={{ fontSize: 11, opacity: 0.7, margin: "12px 0 4px" }}>RAW BODY</h4>
            <pre style={{ background: "rgba(255,255,255,0.04)", padding: 8, fontSize: 10.5, maxHeight: 260, overflow: "auto", whiteSpace: "pre-wrap", wordBreak: "break-all" }}>{detailRow.rawBody}</pre>
            <h4 style={{ fontSize: 11, opacity: 0.7, margin: "12px 0 4px" }}>RESPONSE ({detailRow.responseStatus})</h4>
            <pre style={{ background: "rgba(255,255,255,0.04)", padding: 8, fontSize: 10.5, maxHeight: 120, overflow: "auto", whiteSpace: "pre-wrap", wordBreak: "break-all" }}>{detailRow.responseBody}</pre>
            <h4 style={{ fontSize: 11, opacity: 0.7, margin: "12px 0 4px" }}>HEADERS</h4>
            <pre style={{ background: "rgba(255,255,255,0.04)", padding: 8, fontSize: 10.5, maxHeight: 120, overflow: "auto" }}>{JSON.stringify(detailRow.headers, null, 2)}</pre>
            <div className="admin-modal-actions">
              <button onClick={() => setDetailRow(null)}>Close</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

const SettingsTab: React.FC = () => {
  const api = useApi();
  const [data, setData] = React.useState<SettingsData | null>(null);
  const [draft, setDraft] = React.useState<Partial<SettingsData>>({});
  const [error, setError] = React.useState<string | null>(null);
  const [saving, setSaving] = React.useState(false);
  const [saved, setSaved] = React.useState<string | null>(null);

  const load = React.useCallback(async () => {
    try {
      const r = await api("/admin/settings");
      setData(r.data);
      setDraft({});
    } catch (e) {
      setError((e as Error).message);
    }
  }, [api]);

  React.useEffect(() => { load(); }, [load]);

  const save = async () => {
    setError(null);
    setSaving(true);
    try {
      const r = await api("/admin/settings", {
        method: "PUT",
        body: JSON.stringify(draft),
      });
      setData(r.data);
      setDraft({});
      setSaved(new Date().toLocaleTimeString());
      setTimeout(() => setSaved(null), 2500);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  if (!data) return <div className="admin-tab-body">Loading…</div>;

  const groups = Array.from(new Set(SETTINGS_FIELDS.map((f) => f.group)));

  const draftOrCurrent = (k: keyof SettingsData): number | string =>
    (draft[k] !== undefined ? draft[k] : data[k]) as number | string;

  const dirty = Object.keys(draft).length > 0;

  return (
    <div className="admin-tab-body admin-settings">
      <div className="admin-settings-meta">
        Last updated {data.updatedAt ? new Date(data.updatedAt).toLocaleString() : "—"}
        {data.updatedBy && ` by ${data.updatedBy}`}
      </div>
      {groups.map((g) => (
        <section key={g} className="admin-settings-group">
          <h3>{g}</h3>
          <div className="admin-settings-grid">
            {SETTINGS_FIELDS.filter((f) => f.group === g).map((f) => {
              const isText = f.type === "text" || f.type === "secret";
              const isSecret = f.type === "secret";
              const v = draftOrCurrent(f.key);
              return (
                <label key={f.key} className="admin-settings-field">
                  <span className="admin-settings-label">{f.label}</span>
                  {isText ? (
                    <input
                      type={isSecret ? "password" : "text"}
                      autoComplete="off"
                      spellCheck={false}
                      value={typeof v === "string" ? v : (v == null ? "" : String(v))}
                      placeholder={isSecret ? (v ? "•••••••• (saved)" : "(empty)") : ""}
                      onChange={(e) =>
                        setDraft((d) => ({ ...d, [f.key]: e.target.value }))
                      }
                    />
                  ) : (
                    <input
                      type="number"
                      step="any"
                      value={typeof v === "number" ? v : Number(v) || 0}
                      onChange={(e) =>
                        setDraft((d) => ({ ...d, [f.key]: Number(e.target.value) }))
                      }
                    />
                  )}
                  <span className="admin-settings-hint">{f.hint}</span>
                </label>
              );
            })}
          </div>
        </section>
      ))}
      {error && <div className="admin-settings-error">{error}</div>}
      <div className="admin-settings-actions">
        <button
          className="admin-btn-primary"
          onClick={save}
          disabled={!dirty || saving}
        >
          {saving ? "Saving…" : `Save${dirty ? ` (${Object.keys(draft).length} changed)` : ""}`}
        </button>
        <button
          className="admin-btn"
          onClick={() => { setDraft({}); setError(null); }}
          disabled={!dirty}
        >
          Discard
        </button>
        {saved && <span className="admin-settings-saved">✓ saved at {saved}</span>}
      </div>
    </div>
  );
};

// -------------------------------- Withdrawals -----------------------------

interface WithdrawalRow {
  orderId: string;
  userName: string;
  method: "bank" | "usdt";
  status: string;
  grossAmount: number;
  feeAmount: number;
  totalDebitInr: number;
  bankAccount?: string;
  ifsc?: string;
  holderName?: string;
  trc20Address?: string;
  fxRate?: number;
  txHash?: string;
  provider?: string;
  failedReason?: string;
  meta?: { reviewReason?: string; autoBroadcast?: boolean };
  createdAt: string;
  paidAt?: string;
}

interface HotWalletData {
  address: string;
  network: string;
  trxBalance: number;
  usdtBalance: number;
}

const WithdrawalsTab: React.FC = () => {
  const api = useApi();
  const [items, setItems] = React.useState<WithdrawalRow[]>([]);
  const [pendingCount, setPendingCount] = React.useState(0);
  const [statusFilter, setStatusFilter] = React.useState<string>("");
  const [error, setError] = React.useState<string | null>(null);
  const [hot, setHot] = React.useState<HotWalletData | null>(null);
  const [busyOrder, setBusyOrder] = React.useState<string | null>(null);

  const load = React.useCallback(() => {
    const qs = statusFilter ? `?status=${statusFilter}` : "";
    api(`/admin/withdrawals${qs}`)
      .then((r) => { setItems(r.items); setPendingCount(r.pendingCount); })
      .catch((e) => setError(e.message));
    api(`/admin/wallet-status`)
      .then((r) => setHot(r.data))
      .catch(() => { /* tron may be off */ });
  }, [api, statusFilter]);

  React.useEffect(() => { load(); }, [load]);
  React.useEffect(() => {
    const id = setInterval(load, 8000);
    return () => clearInterval(id);
  }, [load]);

  const markPaid = async (row: WithdrawalRow) => {
    let txHash: string | undefined;
    if (row.method === "usdt") {
      const inp = window.prompt("TX hash (paste from your wallet, or leave blank if marked outside Tron)?");
      if (inp === null) return;
      txHash = inp.trim() || undefined;
    } else {
      if (!window.confirm(`Mark ${row.userName}'s ₹${row.grossAmount} bank transfer as PAID?`)) return;
    }
    setBusyOrder(row.orderId);
    try {
      await api(`/admin/withdrawals/${row.orderId}/mark-paid`, {
        method: "POST",
        body: JSON.stringify({ txHash }),
      });
      load();
    } catch (e) { alert((e as Error).message); }
    finally { setBusyOrder(null); }
  };

  const markFailed = async (row: WithdrawalRow) => {
    const reason = window.prompt(`Reason for failing ${row.userName}'s withdrawal? (will refund ₹${row.totalDebitInr})`);
    if (!reason) return;
    setBusyOrder(row.orderId);
    try {
      await api(`/admin/withdrawals/${row.orderId}/mark-failed`, {
        method: "POST",
        body: JSON.stringify({ reason }),
      });
      load();
    } catch (e) { alert((e as Error).message); }
    finally { setBusyOrder(null); }
  };

  const approveReview = async (row: WithdrawalRow) => {
    if (!window.confirm(
      `Approve ${row.userName}'s ${row.method.toUpperCase()} withdrawal for ` +
      `${row.method === "bank" ? "₹" + row.grossAmount : row.grossAmount + " USDT"}? ` +
      `This will hand it off to the payout provider.`
    )) return;
    setBusyOrder(row.orderId);
    try {
      await api(`/admin/withdrawals/${row.orderId}/approve-review`, { method: "POST" });
      load();
    } catch (e) { alert((e as Error).message); }
    finally { setBusyOrder(null); }
  };

  if (error) return <div className="admin-error">⚠ {error}</div>;

  return (
    <div className="admin-withdrawals">
      <section className="stat-grid">
        <Stat label="Pending withdrawals" value={String(pendingCount)} accent={pendingCount > 0 ? "warn" : undefined} />
        {hot && (
          <>
            <Stat label="Hot wallet USDT" value={hot.usdtBalance.toFixed(2)} accent={hot.usdtBalance < 50 ? "warn" : "ok"} />
            <Stat label="Hot wallet TRX" value={hot.trxBalance.toFixed(2)} />
            <Stat label="Network" value={hot.network} />
          </>
        )}
      </section>
      {hot && (
        <div className="admin-withdrawals-hot">
          Hot wallet: <code>{hot.address}</code>
        </div>
      )}

      <div className="users-toolbar" style={{ marginTop: 12 }}>
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          style={{ padding: 6, background: "transparent", color: "inherit", borderRadius: 6 }}
        >
          <option value="">All statuses</option>
          <option value="pending">pending</option>
          <option value="processing">processing</option>
          <option value="manual_queue">manual_queue</option>
          <option value="review">review</option>
          <option value="paid">paid</option>
          <option value="failed">failed</option>
          <option value="cancelled">cancelled</option>
        </select>
      </div>

      <table className="admin-table">
        <thead>
          <tr>
            <th>When</th><th>User</th><th>Method</th>
            <th>Gross</th><th>Fee</th><th>Total deduct</th>
            <th>Destination</th><th>Status</th><th>Actions</th>
          </tr>
        </thead>
        <tbody>
          {items.map((r) => {
            const canAct = ["pending", "processing", "manual_queue", "review"].includes(r.status);
            return (
              <tr key={r.orderId}>
                <td>{new Date(r.createdAt).toLocaleString()}</td>
                <td>{r.userName}</td>
                <td>{r.method.toUpperCase()}</td>
                <td className="num">
                  {r.method === "bank" ? `₹${r.grossAmount.toFixed(2)}` : `${r.grossAmount.toFixed(4)} USDT`}
                </td>
                <td className="num">₹{r.feeAmount.toFixed(2)}</td>
                <td className="num">₹{r.totalDebitInr.toFixed(2)}</td>
                <td className="seed">
                  {r.method === "bank" ? (
                    <>
                      <div>A/C: {r.bankAccount}</div>
                      <div>{r.ifsc} · {r.holderName}</div>
                    </>
                  ) : (
                    <>
                      <div>{r.trc20Address}</div>
                      {r.txHash && <div>TX: {r.txHash.slice(0, 16)}…</div>}
                      {r.fxRate && <div>@ ₹{r.fxRate.toFixed(2)}/USDT</div>}
                    </>
                  )}
                </td>
                <td>
                  <span className={`tag status-${r.status}`}>{r.status}</span>
                  {r.meta?.autoBroadcast && (
                    <span className="tag" style={{ background: "rgba(86,224,154,0.18)", color: "#56e09a", marginLeft: 4 }} title="Auto-broadcast">⚡ AUTO</span>
                  )}
                  {r.meta?.reviewReason && (
                    <div className="seed" title={r.meta.reviewReason}>⚠ {r.meta.reviewReason}</div>
                  )}
                  {r.failedReason && <div className="seed">{r.failedReason}</div>}
                </td>
                <td>
                  {canAct ? (
                    <>
                      {r.status === "review" && (
                        <button
                          onClick={() => approveReview(r)}
                          disabled={busyOrder === r.orderId}
                          style={{ marginRight: 4 }}
                          title="Approve & send to provider"
                        >
                          Approve
                        </button>
                      )}
                      <button
                        onClick={() => markPaid(r)}
                        disabled={busyOrder === r.orderId}
                        style={{ marginRight: 4 }}
                      >
                        Paid
                      </button>
                      <button
                        onClick={() => markFailed(r)}
                        disabled={busyOrder === r.orderId}
                      >
                        Fail
                      </button>
                    </>
                  ) : "—"}
                </td>
              </tr>
            );
          })}
          {items.length === 0 && <tr><td colSpan={9} className="empty">No withdrawals</td></tr>}
        </tbody>
      </table>
    </div>
  );
};

// -------------------------------- Wallets ---------------------------------

interface WalletEntry {
  role: "hot" | "deposit";
  index: number;
  address: string;
  /** null when the backend's chain RPC call failed — show as "⚠ ?" not "0" */
  trxBalance: number | null;
  usdtBalance: number | null;
  paidOrderCount?: number;
  unsweptOrderCount?: number;
  totalUsdtClaimed?: number;
}

/** Render a balance: number → fixed-decimal string; null → ⚠ ? */
const fmtBal = (v: number | null, decimals = 4): string =>
  v == null ? "⚠ ?" : v.toFixed(decimals);

interface WalletsListData {
  network: string;
  contract: string;
  fetchedAt: string;
  cached: boolean;
  wallets: WalletEntry[];
  totals: {
    hotTrx: number;
    hotUsdt: number;
    depositTrx: number;
    depositUsdt: number;
    unsweptOrders: number;
  };
}

const WalletsTab: React.FC = () => {
  const api = useApi();
  const [data, setData] = React.useState<WalletsListData | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [transferOpen, setTransferOpen] = React.useState(false);

  const load = React.useCallback(async (fresh = false) => {
    setLoading(true);
    try {
      const r = await api(`/admin/wallets${fresh ? "?fresh=1" : ""}`);
      setData(r.data);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [api]);

  React.useEffect(() => { load(); }, [load]);

  // Tracks which sweep operation is in flight:
  //   • "all" = the global "Run sweep (N)" button
  //   • "<address>" = a per-row sweep
  //   • null = idle
  // Stored as a single value because the sweep route serialises on-chain
  // calls anyway — running two parallel sweeps would just double the
  // TronGrid traffic without speeding anything up.
  const [sweepingTarget, setSweepingTarget] = React.useState<string | null>(null);
  // Per-address "fetching from chain" indicator. Independent from sweep
  // so the operator can refresh a row's balance even while a sweep runs
  // on a different address.
  const [refreshingAddr, setRefreshingAddr] = React.useState<string | null>(null);

  // Refresh ONE address's on-chain balance via the dedicated endpoint
  // (bypasses the 30s listWallets cache). Patches the row in-place so
  // we don't re-render the whole table.
  const refreshOneFromChain = async (address: string) => {
    setRefreshingAddr(address);
    try {
      const r = await api(`/admin/wallets/balance/${address}`);
      const fresh = r.data;
      setData((prev) => prev ? {
        ...prev,
        wallets: prev.wallets.map((w) =>
          w.address === address
            ? { ...w, trxBalance: fresh.trxBalance, usdtBalance: fresh.usdtBalance }
            : w
        ),
        fetchedAt: new Date().toISOString(),
        cached: false,
      } : prev);
    } catch (e) {
      alert("Chain refresh failed: " + (e as Error).message);
    } finally {
      setRefreshingAddr(null);
    }
  };

  const runSweepCore = async (addresses?: string[], label?: string) => {
    const count = addresses?.length ?? (data?.totals.unsweptOrders || 0);
    if (!window.confirm(
      `Sweep ${count} address${count === 1 ? "" : "es"}? ` +
      `This sends USDT from sub-address${count === 1 ? "" : "es"} to the hot wallet ` +
      `(each takes ~13-30 TRX gas). The operation can take 15-60 seconds per address ` +
      `— please don't close this tab while it runs.`,
    )) return;
    setSweepingTarget(label || "all");
    try {
      const r = await api(`/admin/wallets/sweep`, {
        method: "POST",
        body: JSON.stringify({ dryRun: false, addresses }),
      });
      const d = r.data;
      alert(
        `Sweep complete:\n` +
        `Attempted: ${d.attempted}\n` +
        `Swept: ${d.swept}\n` +
        `Total USDT swept: ${d.totalUsdt.toFixed(4)}\n\n` +
        `Details:\n${d.details.map((x: any) =>
          `${x.address.slice(0, 12)}…  ${x.action}` +
          (x.txHash ? ` [${x.txHash.slice(0, 10)}…]` : "") +
          (x.error ? ` ERROR: ${x.error}` : "")
        ).join("\n")}`,
      );
      load(true);
    } catch (e) {
      alert("Sweep failed: " + (e as Error).message);
    } finally {
      setSweepingTarget(null);
    }
  };

  const runSweep = () => runSweepCore(undefined, "all");
  const runSweepOne = (address: string) => runSweepCore([address], address);

  // Force-sweep: ignores the "no un-swept orders" gate. Used when on-chain
  // USDT actually exists on a sub-address but the DB marked it swept
  // (e.g. earlier sweep saw TronGrid rate-limited 0 and falsely flagged
  // the order as "no-balance" swept).
  const forceSweepOne = async (address: string) => {
    if (!window.confirm(
      `Force-sweep ${address.slice(0, 12)}…?\n\n` +
      `This resets any sweptAt marker on the order(s) for this address ` +
      `then re-runs sweep. Use ONLY when you see on-chain USDT but admin ` +
      `says "0" / "un-swept = 0".`,
    )) return;
    setSweepingTarget(address);
    try {
      // Step 1: clear the marker via a tiny admin endpoint
      await api(`/admin/wallets/reset-sweep-marker`, {
        method: "POST",
        body: JSON.stringify({ address }),
      });
      // Step 2: re-run sweep for that address
      const r = await api(`/admin/wallets/sweep`, {
        method: "POST",
        body: JSON.stringify({ dryRun: false, addresses: [address] }),
      });
      const d = r.data;
      alert(
        `Force-sweep result:\n` +
        `Attempted: ${d.attempted}\n` +
        `Swept: ${d.swept}\n` +
        `Total USDT swept: ${d.totalUsdt.toFixed(4)}\n\n` +
        d.details.map((x: any) =>
          `${x.address.slice(0, 12)}…  ${x.action}` +
          (x.txHash ? ` [${x.txHash.slice(0, 10)}…]` : "") +
          (x.error ? ` ERROR: ${x.error}` : "")
        ).join("\n"),
      );
      load(true);
    } catch (e) {
      alert("Force sweep failed: " + (e as Error).message);
    } finally {
      setSweepingTarget(null);
    }
  };

  const dryRunSweep = async () => {
    try {
      const r = await api(`/admin/wallets/sweep`, {
        method: "POST",
        body: JSON.stringify({ dryRun: true }),
      });
      const d = r.data;
      if (d.attempted === 0) {
        alert("Nothing to sweep — no paid+un-swept orders.");
        return;
      }
      alert(
        `Sweep DRY-RUN preview:\n` +
        `Would attempt: ${d.attempted} address(es)\n` +
        `Total USDT to sweep: ${d.totalUsdt.toFixed(4)}\n\n` +
        d.details.map((x: any) =>
          `${x.address.slice(0, 12)}…  ${x.action}  USDT=${x.onChainUsdt.toFixed(2)}  TRX=${x.onChainTrx.toFixed(2)}`
        ).join("\n"),
      );
    } catch (e) {
      alert("Dry-run failed: " + (e as Error).message);
    }
  };

  if (error && !data) return <div className="admin-error">⚠ {error}</div>;
  if (!data) return <div className="admin-tab-body">Loading wallets…</div>;

  const hot = data.wallets.find((w) => w.role === "hot");
  const deposits = data.wallets.filter((w) => w.role === "deposit");

  return (
    <div className="admin-wallets">
      <section className="stat-grid">
        <Stat label="Hot USDT" value={data.totals.hotUsdt.toFixed(2)} accent={data.totals.hotUsdt < 50 ? "warn" : "ok"} />
        <Stat label="Hot TRX" value={data.totals.hotTrx.toFixed(2)} accent={data.totals.hotTrx < 50 ? "warn" : "ok"} />
        <Stat label="Deposit USDT (un-swept)" value={data.totals.depositUsdt.toFixed(2)} accent={data.totals.depositUsdt > 0 ? "warn" : undefined} />
        <Stat label="Un-swept orders" value={String(data.totals.unsweptOrders)} accent={data.totals.unsweptOrders > 0 ? "warn" : undefined} />
        <Stat label="Network" value={data.network || "—"} />
      </section>

      <div className="admin-wallets-actions" style={{ display: "flex", gap: 8, marginTop: 12, alignItems: "center", flexWrap: "wrap" }}>
        <button onClick={() => load(true)} disabled={loading || !!sweepingTarget}>↻ Refresh balances</button>
        <button onClick={dryRunSweep} disabled={!!sweepingTarget}>Sweep dry-run</button>
        <button
          onClick={runSweep}
          disabled={!!sweepingTarget || data.totals.unsweptOrders === 0}
        >
          {sweepingTarget === "all" ? "Sweeping all… (can take 1+ min)" : `Run sweep (${data.totals.unsweptOrders})`}
        </button>
        <button className="primary" onClick={() => setTransferOpen(true)} disabled={!!sweepingTarget}>
          Transfer out from hot…
        </button>
        <span style={{ marginLeft: "auto", fontSize: 11, opacity: 0.55 }}>
          Last fetched: {new Date(data.fetchedAt).toLocaleTimeString()}
          {data.cached && " (cached)"}
        </span>
      </div>
      {sweepingTarget && (
        <div style={{ marginTop: 8, padding: "8px 10px", background: "rgba(255,200,87,0.08)", border: "1px dashed rgba(255,200,87,0.3)", borderRadius: 6, fontSize: 12 }}>
          <strong style={{ color: "#ffc857" }}>⏳ Sweeping</strong>{" "}
          {sweepingTarget === "all" ? "all un-swept addresses" : `${sweepingTarget.slice(0, 12)}…`}
          — please wait. Each address takes 15-60 seconds (TRX top-up + USDT transfer + chain confirm).
        </div>
      )}

      {hot && (
        <HotWalletCard
          hot={hot}
          refreshing={refreshingAddr === hot.address}
          onRefreshFromChain={() => refreshOneFromChain(hot.address)}
        />
      )}

      <h3 style={{ fontSize: 14, margin: "20px 0 8px" }}>Deposit sub-addresses ({deposits.length})</h3>
      <table className="admin-table">
        <thead>
          <tr>
            <th>Index</th><th>Address</th>
            <th className="num">USDT</th><th className="num">TRX</th>
            <th className="num">Paid</th><th className="num">Un-swept</th><th className="num">Total claimed</th>
            <th>Action</th>
          </tr>
        </thead>
        <tbody>
          {deposits.map((w) => {
            const isBusy = sweepingTarget === w.address;
            const hasUnswept = (w.unsweptOrderCount || 0) > 0;
            // Show "Force" option when there's no un-swept marker in DB
            // BUT the address has paid orders + some on-chain USDT (rare
            // case where a buggy earlier sweep falsely marked the order
            // as no-balance while the chain still holds funds).
            const showForce = !hasUnswept
              && (w.paidOrderCount || 0) > 0
              && (w.usdtBalance || 0) > 0;
            return (
              <tr key={w.address} className={hasUnswept ? "row-banned" : ""}>
                <td>{w.index}</td>
                <td className="seed">{w.address}</td>
                <td className="num" title={w.usdtBalance == null ? "On-chain balance fetch failed — retry via ↻ Refresh" : ""}>{fmtBal(w.usdtBalance)}</td>
                <td className="num" title={w.trxBalance == null ? "On-chain balance fetch failed — retry via ↻ Refresh" : ""}>{fmtBal(w.trxBalance)}</td>
                <td className="num">{w.paidOrderCount}</td>
                <td className="num">{w.unsweptOrderCount}</td>
                <td className="num">{w.totalUsdtClaimed?.toFixed(2)}</td>
                <td>
                  <div style={{ display: "flex", gap: 4, justifyContent: "flex-start", flexWrap: "wrap" }}>
                    <button
                      onClick={() => refreshOneFromChain(w.address)}
                      disabled={refreshingAddr === w.address || !!sweepingTarget}
                      title="Refresh this address's balance directly from chain (bypasses 30s cache)"
                      style={{ padding: "2px 8px", fontSize: 11 }}
                    >
                      {refreshingAddr === w.address ? "…" : "↻ Chain"}
                    </button>
                    {hasUnswept ? (
                      <button
                        onClick={() => runSweepOne(w.address)}
                        disabled={!!sweepingTarget}
                        title="Sweep just this address"
                      >
                        {isBusy ? "Sweeping…" : "Sweep"}
                      </button>
                    ) : showForce ? (
                      <button
                        onClick={() => forceSweepOne(w.address)}
                        disabled={!!sweepingTarget}
                        title="Force sweep — resets DB marker then sweeps"
                        style={{ background: "rgba(193,34,68,0.18)", color: "#ffb0bc", border: "1px solid rgba(193,34,68,0.4)" }}
                      >
                        {isBusy ? "Sweeping…" : "Force"}
                      </button>
                    ) : null}
                  </div>
                </td>
              </tr>
            );
          })}
          {deposits.length === 0 && <tr><td colSpan={8} className="empty">No deposit addresses yet</td></tr>}
        </tbody>
      </table>

      {transferOpen && (
        <TransferOutModal onClose={() => setTransferOpen(false)} onDone={() => { setTransferOpen(false); load(true); }} hotUsdt={hot?.usdtBalance || 0} hotTrx={hot?.trxBalance || 0} />
      )}
    </div>
  );
};

/**
 * Hot wallet display card — address + balances + copy + QR for scan.
 *
 * Why a QR: when topping up the hot wallet from a phone wallet (Binance,
 * TronLink mobile), scanning is way safer than typing/pasting a 34-char
 * address. ⚠️ The QR encodes the address only — destination network is
 * still TRON-TRC20, the operator must select that on the sender app.
 */
const HotWalletCard: React.FC<{
  hot: WalletEntry;
  refreshing?: boolean;
  onRefreshFromChain?: () => void;
}> = ({ hot, refreshing, onRefreshFromChain }) => {
  const [copied, setCopied] = React.useState(false);
  const [qrOpen, setQrOpen] = React.useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(hot.address);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      const ta = document.createElement("textarea");
      ta.value = hot.address;
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand("copy"); setCopied(true); setTimeout(() => setCopied(false), 1800); } catch { /* ignore */ }
      document.body.removeChild(ta);
    }
  };

  return (
    <div className="admin-wallets-hot" style={{ marginTop: 16 }}>
      <h3 style={{ fontSize: 14, margin: "0 0 8px" }}>Hot wallet (index {hot.index})</h3>
      <div style={{ display: "flex", gap: 14, alignItems: "flex-start", flexWrap: "wrap" }}>
        <div
          onClick={() => setQrOpen(true)}
          style={{
            background: "white",
            padding: 6,
            borderRadius: 6,
            cursor: "zoom-in",
            flex: "0 0 auto",
            display: "flex",
          }}
          title="Click to enlarge"
        >
          <QRCodeSVG value={hot.address} size={88} level="M" />
        </div>
        <div style={{ flex: "1 1 280px", minWidth: 0 }}>
          <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
            <code
              style={{
                background: "rgba(255, 200, 87, 0.06)",
                padding: "4px 8px",
                borderRadius: 4,
                fontSize: 11,
                wordBreak: "break-all",
                flex: 1,
                minWidth: 0,
              }}
            >
              {hot.address}
            </code>
            <button onClick={copy} style={{ whiteSpace: "nowrap" }}>
              {copied ? "✓ Copied" : "Copy"}
            </button>
            <button onClick={() => setQrOpen(true)}>QR</button>
          </div>
          <div style={{ fontSize: 12, marginTop: 8, display: "flex", alignItems: "center", gap: 8 }}>
            <strong style={{ color: "#ffc857" }}>{fmtBal(hot.usdtBalance)} USDT</strong>
            {" · "}
            <strong>{fmtBal(hot.trxBalance)} TRX</strong>
            {onRefreshFromChain && (
              <button
                onClick={onRefreshFromChain}
                disabled={refreshing}
                title="Refresh hot wallet balance directly from chain"
                style={{ padding: "2px 8px", fontSize: 11, marginLeft: 8 }}
              >
                {refreshing ? "…" : "↻ Chain"}
              </button>
            )}
          </div>
          <div style={{ fontSize: 10.5, opacity: 0.55, marginTop: 4 }}>
            Network: TRC20 · Send TRX or USDT (TRC20) only — never ERC20/BEP20
          </div>
        </div>
      </div>

      {qrOpen && (
        <div className="admin-modal-overlay" onClick={() => setQrOpen(false)}>
          <div className="admin-modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 360 }}>
            <h3>Scan to deposit</h3>
            <div style={{ background: "white", padding: 16, borderRadius: 8, display: "flex", justifyContent: "center" }}>
              <QRCodeSVG value={hot.address} size={260} level="H" />
            </div>
            <p style={{ fontSize: 11, opacity: 0.7, textAlign: "center", marginTop: 12 }}>
              Network: <strong style={{ color: "#ffc857" }}>TRON (TRC20)</strong>
            </p>
            <code style={{ display: "block", textAlign: "center", fontSize: 10.5, wordBreak: "break-all", margin: "8px 0" }}>
              {hot.address}
            </code>
            <div className="admin-modal-actions">
              <button onClick={copy}>{copied ? "✓ Copied" : "Copy address"}</button>
              <button className="primary" onClick={() => setQrOpen(false)}>Close</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

const TransferOutModal: React.FC<{ onClose: () => void; onDone: () => void; hotUsdt: number; hotTrx: number }> = ({ onClose, onDone, hotUsdt, hotTrx }) => {
  const api = useApi();
  const [to, setTo] = React.useState("");
  const [amount, setAmount] = React.useState("");
  const [currency, setCurrency] = React.useState<"USDT" | "TRX">("USDT");
  const [busy, setBusy] = React.useState(false);
  const [result, setResult] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  const TRC20_RE = /^T[1-9A-HJ-NP-Za-km-z]{33}$/;
  const valid = TRC20_RE.test(to.trim()) && Number(amount) > 0;

  const submit = async (dryRun: boolean) => {
    setBusy(true); setError(null); setResult(null);
    try {
      const body: any = { to: to.trim(), dryRun };
      if (currency === "USDT") body.amountUsdt = Number(amount);
      else body.amountTrx = Number(amount);
      const r = await api(`/admin/wallets/transfer-out`, { method: "POST", body: JSON.stringify(body) });
      const d = r.data;
      if (dryRun) {
        setResult(`✓ Dry-run OK\nFrom: ${d.from.slice(0, 12)}…\nTo: ${d.to.slice(0, 12)}…\n${d.amount} ${d.currency}`);
      } else {
        setResult(`✓ Sent\nTX: ${d.txHash}\nView on Tronscan: https://tronscan.org/#/transaction/${d.txHash}`);
        setTimeout(onDone, 3500);
      }
    } catch (e: any) {
      // The API also returns reason via 400 body; fetch it
      setError(e.message || "Transfer failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="admin-modal-overlay" onClick={onClose}>
      <div className="admin-modal" onClick={(e) => e.stopPropagation()}>
        <h3>Transfer out from hot wallet</h3>
        <p style={{ fontSize: 11, opacity: 0.7, marginTop: -8 }}>
          Available: {hotUsdt.toFixed(4)} USDT · {hotTrx.toFixed(4)} TRX
        </p>

        <label>
          <span>Destination (TRC20)</span>
          <input type="text" placeholder="T..." value={to} onChange={(e) => setTo(e.target.value.trim())} maxLength={34} />
        </label>

        <label>
          <span>Currency</span>
          <select value={currency} onChange={(e) => setCurrency(e.target.value as any)}>
            <option value="USDT">USDT</option>
            <option value="TRX">TRX</option>
          </select>
        </label>

        <label>
          <span>Amount ({currency})</span>
          <input type="text" inputMode="decimal" placeholder="0.0" value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^\d.]/g, ""))} />
        </label>

        {result && <pre style={{ background: "rgba(86,224,154,0.1)", padding: 8, borderRadius: 6, fontSize: 11, whiteSpace: "pre-wrap", wordBreak: "break-all" }}>{result}</pre>}
        {error && <div className="admin-error">⚠ {error}</div>}

        <div className="admin-modal-actions">
          <button onClick={onClose} disabled={busy}>Close</button>
          <button onClick={() => submit(true)} disabled={!valid || busy}>Dry-run</button>
          <button className="primary" onClick={() => {
            if (!window.confirm(`Send ${amount} ${currency} to ${to}? This is irreversible.`)) return;
            submit(false);
          }} disabled={!valid || busy}>
            {busy ? "Sending…" : "Send for real"}
          </button>
        </div>
      </div>
    </div>
  );
};
