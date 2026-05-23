import React from "react";
import { config } from "../../config";

/**
 * AffiliateSheet — agent/referral dashboard.
 *
 * Shows:
 *   • Stats: total referred users, total earned, total deposits by referrals
 *   • Referral link with copy button
 *   • Tab toggle: Recent Rewards | Referred Users
 *
 * Backend: GET /api/affiliate/stats and /api/affiliate/referrals
 * Auth: Bearer token from localStorage ("aviator_token")
 */

interface Props {
  open: boolean;
  onClose: () => void;
}

interface StatsData {
  totalReferrals: number;
  totalEarned: number;
  totalRewardEvents: number;
  totalRefereeDeposited: number;
  rewardPerEvent: number;
  recentRewards: Array<{
    referee: string;
    amount: number;
    refereeAmount: number;
    sourceType: string;
    createdAt: string;
  }>;
}

interface ReferralUser {
  userName: string;
  joinedAt: string;
  lastLoginAt?: string;
  totalDeposited: number;
  myEarnedFromUser: number;
  rewardCount: number;
}

type Tab = "rewards" | "users";

const TOKEN_KEY = "aviator_token";
const apiBase = config.api;

const authHeaders = (): Record<string, string> => {
  const t = localStorage.getItem(TOKEN_KEY);
  return t ? { Authorization: `Bearer ${t}` } : {};
};

const fmt = (n: number) =>
  n.toLocaleString("en-IN", { maximumFractionDigits: 2, minimumFractionDigits: 2 });

const timeAgo = (iso: string): string => {
  const diff = Date.now() - new Date(iso).getTime();
  const d = Math.floor(diff / 86400000);
  if (d > 0) return `${d}d ago`;
  const h = Math.floor(diff / 3600000);
  if (h > 0) return `${h}h ago`;
  const m = Math.floor(diff / 60000);
  return m > 0 ? `${m}m ago` : "just now";
};

const sourceLabel: Record<string, string> = {
  recharge: "INR recharge",
  crypto: "Crypto recharge",
  payout: "Payout",
};

export const AffiliateSheet: React.FC<Props> = ({ open, onClose }) => {
  const [tab, setTab] = React.useState<Tab>("rewards");
  const [stats, setStats] = React.useState<StatsData | null>(null);
  const [users, setUsers] = React.useState<ReferralUser[] | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [copied, setCopied] = React.useState(false);

  // Build referral link
  const myName = (() => {
    try {
      const raw = localStorage.getItem(TOKEN_KEY);
      if (!raw) return "";
      const parts = raw.split(".");
      if (parts.length < 2) return "";
      const payload = JSON.parse(atob(parts[1]));
      return payload.userName || "";
    } catch {
      return "";
    }
  })();

  const origin =
    typeof window !== "undefined"
      ? `${window.location.protocol}//${window.location.host}`
      : "";
  const tgBotUsername =
    typeof window !== "undefined"
      ? ((window as any).Telegram?.WebApp?.initDataUnsafe?.bot?.username ||
          (window as any).__TG_BOT_USERNAME__ ||
          "")
      : "";
  const refLink =
    tgBotUsername && myName
      ? `https://t.me/${tgBotUsername}?start=ref_${encodeURIComponent(myName)}`
      : myName
      ? `${origin}/?ref=${encodeURIComponent(myName)}`
      : origin;

  const loadStats = React.useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const r = await fetch(`${apiBase}/api/affiliate/stats`, {
        headers: authHeaders(),
      });
      const j = await r.json();
      if (j.status) setStats(j.data);
      else setError(j.message || "Failed to load stats");
    } catch {
      setError("Network error");
    } finally {
      setLoading(false);
    }
  }, []);

  const loadUsers = React.useCallback(async () => {
    if (users) return; // already fetched
    setLoading(true);
    setError(null);
    try {
      const r = await fetch(`${apiBase}/api/affiliate/referrals`, {
        headers: authHeaders(),
      });
      const j = await r.json();
      if (j.status) setUsers(j.data);
      else setError(j.message || "Failed to load referrals");
    } catch {
      setError("Network error");
    } finally {
      setLoading(false);
    }
  }, [users]);

  React.useEffect(() => {
    if (!open) return;
    loadStats();
  }, [open, loadStats]);

  React.useEffect(() => {
    if (!open || tab !== "users") return;
    loadUsers();
  }, [open, tab, loadUsers]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(refLink);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      const ta = document.createElement("textarea");
      ta.value = refLink;
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand("copy"); setCopied(true); } catch { /* ignore */ }
      document.body.removeChild(ta);
      setTimeout(() => setCopied(false), 1800);
    }
  };

  if (!open) return null;

  return (
    <div className="mobile-modal-overlay affiliate-overlay" onClick={onClose}>
      <div
        className="mobile-modal affiliate-sheet"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="affiliate-header">
          <div className="affiliate-title">
            <span className="affiliate-icon">🤝</span>
            Affiliate Dashboard
          </div>
          <button className="affiliate-close" onClick={onClose} aria-label="Close">✕</button>
        </div>

        {/* Referral link */}
        <div className="affiliate-link-block">
          <div className="affiliate-link-label">Your referral link</div>
          <div className="affiliate-link-row">
            <input
              className="share-link-input affiliate-link-input"
              type="text"
              value={refLink}
              readOnly
              onFocus={(e) => e.currentTarget.select()}
              aria-label="Referral link"
            />
            <button className="share-copy-btn" onClick={copy}>
              {copied ? "✓" : "Copy"}
            </button>
          </div>
          {stats && (
            <div className="affiliate-reward-note">
              ₹{fmt(stats.rewardPerEvent)} earned for each friend who recharges
            </div>
          )}
        </div>

        {/* Stats cards */}
        {loading && !stats && (
          <div className="affiliate-loading">Loading…</div>
        )}
        {error && (
          <div className="affiliate-error">{error}</div>
        )}
        {stats && (
          <div className="affiliate-stats-grid">
            <div className="affiliate-stat-card">
              <div className="affiliate-stat-value">{stats.totalReferrals}</div>
              <div className="affiliate-stat-label">Friends referred</div>
            </div>
            <div className="affiliate-stat-card earned">
              <div className="affiliate-stat-value">₹{fmt(stats.totalEarned)}</div>
              <div className="affiliate-stat-label">Total earned</div>
            </div>
            <div className="affiliate-stat-card">
              <div className="affiliate-stat-value">{stats.totalRewardEvents}</div>
              <div className="affiliate-stat-label">Reward events</div>
            </div>
            <div className="affiliate-stat-card">
              <div className="affiliate-stat-value">₹{fmt(stats.totalRefereeDeposited)}</div>
              <div className="affiliate-stat-label">Friends deposited</div>
            </div>
          </div>
        )}

        {/* Tab bar */}
        <div className="affiliate-tabs">
          <button
            className={`affiliate-tab ${tab === "rewards" ? "active" : ""}`}
            onClick={() => setTab("rewards")}
          >
            Recent Rewards
          </button>
          <button
            className={`affiliate-tab ${tab === "users" ? "active" : ""}`}
            onClick={() => setTab("users")}
          >
            My Referrals
          </button>
        </div>

        {/* Tab content */}
        <div className="affiliate-list">
          {tab === "rewards" && stats && (
            stats.recentRewards.length === 0 ? (
              <div className="affiliate-empty">
                No rewards yet — share your link to get started!
              </div>
            ) : (
              stats.recentRewards.map((r, i) => (
                <div key={i} className="affiliate-row">
                  <div className="affiliate-row-left">
                    <div className="affiliate-row-name">{r.referee}</div>
                    <div className="affiliate-row-meta">
                      {sourceLabel[r.sourceType] ?? r.sourceType} · ₹{fmt(r.refereeAmount)} deposit
                    </div>
                  </div>
                  <div className="affiliate-row-right">
                    <div className="affiliate-row-earned">+₹{fmt(r.amount)}</div>
                    <div className="affiliate-row-time">{timeAgo(r.createdAt)}</div>
                  </div>
                </div>
              ))
            )
          )}

          {tab === "users" && (
            loading && !users ? (
              <div className="affiliate-loading">Loading…</div>
            ) : users && users.length === 0 ? (
              <div className="affiliate-empty">
                No referrals yet — share your link!
              </div>
            ) : users ? (
              users.map((u, i) => (
                <div key={i} className="affiliate-row">
                  <div className="affiliate-row-left">
                    <div className="affiliate-row-name">{u.userName}</div>
                    <div className="affiliate-row-meta">
                      Joined {timeAgo(u.joinedAt)}
                      {u.rewardCount > 0
                        ? ` · ${u.rewardCount} recharge${u.rewardCount > 1 ? "s" : ""}`
                        : " · no deposits yet"}
                    </div>
                  </div>
                  <div className="affiliate-row-right">
                    <div className="affiliate-row-earned">
                      {u.myEarnedFromUser > 0
                        ? `+₹${fmt(u.myEarnedFromUser)}`
                        : "—"}
                    </div>
                    {u.totalDeposited > 0 && (
                      <div className="affiliate-row-time">
                        ₹{fmt(u.totalDeposited)} deposited
                      </div>
                    )}
                  </div>
                </div>
              ))
            ) : null
          )}
        </div>

        {/* Promo tip */}
        <div className="affiliate-promo-tip">
          💡 每帶一個充值好友，你固定賺 ₹100！分享到 Telegram 群組，越多越好
        </div>
      </div>
    </div>
  );
};
