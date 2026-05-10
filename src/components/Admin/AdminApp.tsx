import React from "react";
import { QRCodeSVG } from "qrcode.react";
import { useAuth } from "../../auth/AuthProvider";
import { config } from "../../config";
import "./admin.scss";

const apiBase = config.api.replace(/\/api$/, "/api");

type Tab = "stats" | "users" | "rounds" | "withdrawals" | "wallets" | "settings";

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

const SETTINGS_FIELDS: { key: keyof SettingsData; label: string; hint: string; group: string }[] = [
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
];

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

  const draftOrCurrent = (k: keyof SettingsData): number =>
    draft[k] !== undefined ? (draft[k] as number) : (data[k] as number);

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
            {SETTINGS_FIELDS.filter((f) => f.group === g).map((f) => (
              <label key={f.key} className="admin-settings-field">
                <span className="admin-settings-label">{f.label}</span>
                <input
                  type="number"
                  step="any"
                  value={draftOrCurrent(f.key)}
                  onChange={(e) =>
                    setDraft((d) => ({ ...d, [f.key]: Number(e.target.value) }))
                  }
                />
                <span className="admin-settings-hint">{f.hint}</span>
              </label>
            ))}
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
            const canAct = ["pending", "processing", "manual_queue"].includes(r.status);
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
  trxBalance: number;
  usdtBalance: number;
  paidOrderCount?: number;
  unsweptOrderCount?: number;
  totalUsdtClaimed?: number;
}

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
  const [sweeping, setSweeping] = React.useState(false);

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

  const runSweep = async () => {
    if (!window.confirm(
      `Sweep ${data?.totals.unsweptOrders || 0} un-swept order(s)? ` +
      `This sends USDT from sub-addresses to the hot wallet (each takes ~13-30 TRX gas).`,
    )) return;
    setSweeping(true);
    try {
      const r = await api(`/admin/wallets/sweep`, {
        method: "POST",
        body: JSON.stringify({ dryRun: false }),
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
      setSweeping(false);
    }
  };

  const dryRunSweep = async () => {
    try {
      const r = await api(`/admin/wallets/sweep`, {
        method: "POST",
        body: JSON.stringify({ dryRun: true }),
      });
      const d = r.data;
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
        <button onClick={() => load(true)} disabled={loading}>↻ Refresh balances</button>
        <button onClick={dryRunSweep}>Sweep dry-run</button>
        <button onClick={runSweep} disabled={sweeping || data.totals.unsweptOrders === 0}>
          {sweeping ? "Sweeping…" : `Run sweep (${data.totals.unsweptOrders})`}
        </button>
        <button className="primary" onClick={() => setTransferOpen(true)}>
          Transfer out from hot…
        </button>
        <span style={{ marginLeft: "auto", fontSize: 11, opacity: 0.55 }}>
          Last fetched: {new Date(data.fetchedAt).toLocaleTimeString()}
          {data.cached && " (cached)"}
        </span>
      </div>

      {hot && <HotWalletCard hot={hot} />}

      <h3 style={{ fontSize: 14, margin: "20px 0 8px" }}>Deposit sub-addresses ({deposits.length})</h3>
      <table className="admin-table">
        <thead>
          <tr>
            <th>Index</th><th>Address</th>
            <th>USDT</th><th>TRX</th>
            <th>Paid</th><th>Un-swept</th><th>Total claimed</th>
          </tr>
        </thead>
        <tbody>
          {deposits.map((w) => (
            <tr key={w.address} className={w.unsweptOrderCount && w.unsweptOrderCount > 0 ? "row-banned" : ""}>
              <td>{w.index}</td>
              <td className="seed">{w.address}</td>
              <td className="num">{w.usdtBalance.toFixed(4)}</td>
              <td className="num">{w.trxBalance.toFixed(4)}</td>
              <td className="num">{w.paidOrderCount}</td>
              <td className="num">{w.unsweptOrderCount}</td>
              <td className="num">{w.totalUsdtClaimed?.toFixed(2)}</td>
            </tr>
          ))}
          {deposits.length === 0 && <tr><td colSpan={7} className="empty">No deposit addresses yet</td></tr>}
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
const HotWalletCard: React.FC<{ hot: WalletEntry }> = ({ hot }) => {
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
          <div style={{ fontSize: 12, marginTop: 8 }}>
            <strong style={{ color: "#ffc857" }}>{hot.usdtBalance.toFixed(4)} USDT</strong>
            {" · "}
            <strong>{hot.trxBalance.toFixed(4)} TRX</strong>
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
