import React from "react";
import { useAuth } from "../../auth/AuthProvider";
import { config } from "../../config";
import "./admin.scss";

const apiBase = config.api.replace(/\/api$/, "/api");

type Tab = "stats" | "users" | "rounds" | "settings";

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
              <td>{u.banned ? <span className="tag banned">BANNED</span> : "active"}</td>
              <td>{new Date(u.createdAt).toLocaleDateString()}</td>
              <td><button onClick={() => setEditing(u)}>Edit</button></td>
            </tr>
          ))}
          {items.length === 0 && <tr><td colSpan={7} className="empty">No users</td></tr>}
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
