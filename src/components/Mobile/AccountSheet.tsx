import React from "react";
import Context from "../../context";
import { useAuth } from "../../auth/AuthProvider";

/**
 * AccountSheet — opens when the user taps the AVIATOR logo in the header.
 *
 * Shows:
 *   • Username + admin badge (if applicable)
 *   • Avatar
 *   • Total balance / Locked / Withdrawable breakdown
 *   • Phone (if password-registered)
 *   • Referrer (if any) + their referral code
 *   • Quick actions: Sign out
 *
 * Reads from useAuth() (server-validated profile via /me) AND ctx.userInfo
 * (live socket myInfo with fresh balance/wagerRequired).
 */
interface Props {
  open: boolean;
  onClose: () => void;
}

export const AccountSheet: React.FC<Props> = ({ open, onClose }) => {
  const { user, logout } = useAuth();
  const ctx = React.useContext(Context);

  if (!open || !user) return null;

  const balance = Number(ctx.userInfo?.balance ?? user.balance ?? 0);
  const wager = Number((ctx.userInfo as any)?.wagerRequired ?? 0);
  const withdrawable = Math.max(0, +(balance - wager).toFixed(2));

  const fmt = (n: number) =>
    n.toLocaleString("en-IN", { maximumFractionDigits: 2, minimumFractionDigits: 2 });

  return (
    <div className="mobile-modal-overlay" onClick={onClose}>
      <div
        className="mobile-modal account-sheet"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="account-header">
          <div className="account-avatar">
            <img src={`/avatars/${user.avatar || "av-1.png"}`} alt="" onError={(e) => {
              (e.currentTarget as HTMLImageElement).style.display = "none";
            }} />
          </div>
          <div className="account-name-block">
            <div className="account-name">
              {user.userName}
              {user.isAdmin && <span className="account-admin-badge">ADMIN</span>}
            </div>
            {user.phone && <div className="account-meta">{user.phone}</div>}
          </div>
        </div>

        <div className="account-balance-card">
          <div className="account-balance-row">
            <span>Total balance</span>
            <strong>₹{fmt(balance)}</strong>
          </div>
          <div className="account-balance-row">
            <span>Locked (playthrough)</span>
            <strong className="account-locked">₹{fmt(wager)}</strong>
          </div>
          <div className="account-balance-row account-balance-w">
            <span>Withdrawable</span>
            <strong>₹{fmt(withdrawable)}</strong>
          </div>
        </div>

        <div className="account-actions">
          {user.isAdmin && (
            <a className="account-link" href="/admin">⚙ Admin panel</a>
          )}
          <button
            className="account-logout"
            onClick={() => {
              if (window.confirm("Sign out?")) logout();
            }}
          >
            Sign out
          </button>
        </div>

        <button className="account-close" onClick={onClose}>Close</button>
      </div>
    </div>
  );
};
