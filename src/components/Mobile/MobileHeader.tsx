import React from "react";
import Context from "../../context";
import { useT } from "../../i18n";
import * as Sounds from "./sounds";

/**
 * Defer the displayed balance so it changes WHEN coins reach their target,
 * not when the server updates state.
 *
 *   • bet placed   → coin animation: balance → plane (~800ms total)
 *                    real balance has decreased; display lags 800ms.
 *   • cashed out   → coin animation fires 850ms later, then flies for ~850ms
 *                    real balance has increased; display lags 1700ms.
 *
 * Initial server load snaps immediately so users don't wait 1.7s on login.
 * Direction-only signal — no need to know "why" balance changed.
 */
const DELAY_DECREASE_MS = 800;
const DELAY_INCREASE_MS = 1700;

const useDisplayBalance = (real: number): number => {
  const [display, setDisplay] = React.useState(real);
  const prevRef = React.useRef<number | null>(null);
  React.useEffect(() => {
    if (prevRef.current === null) {
      // Wait for the first non-zero value before declaring "initialized" so
      // a recharge from 0 still snaps. Login balance might legitimately be 0
      // for a brand-new user — in that case the next change (recharge) will
      // animate, which is acceptable (no coin animation either way).
      if (real !== 0) {
        prevRef.current = real;
        setDisplay(real);
      }
      return;
    }
    if (real === prevRef.current) return;
    const decreased = real < prevRef.current;
    prevRef.current = real;
    const t = setTimeout(
      () => setDisplay(real),
      decreased ? DELAY_DECREASE_MS : DELAY_INCREASE_MS,
    );
    return () => clearTimeout(t);
  }, [real]);
  return display;
};

interface HeaderProps {
  onOpenMenu: () => void;
  onRecharge?: () => void;
  onShare?: () => void;
  onOpenAccount?: () => void;
}

export const MobileHeader: React.FC<HeaderProps> = ({ onOpenMenu, onRecharge, onShare, onOpenAccount }) => {
  const { userInfo, errorBackend } = React.useContext(Context);
  const { t } = useT();
  const balanceServer = Number(userInfo?.balance || 0);
  const balance = useDisplayBalance(balanceServer);
  const currency = userInfo?.currency || "INR";
  const [muted, setMuted] = React.useState(Sounds.isMuted());
  const toggleMute = () => {
    const now = Sounds.toggleMute();
    setMuted(now);
    if (!now) Sounds.buttonClick(); // audible feedback when unmuting
  };
  return (
    <header className="mobile-header">
      <div className="mobile-header-brand">
        <button
          className={`mobile-header-sound ${muted ? "muted" : ""}`}
          onClick={toggleMute}
          aria-label={muted ? "Unmute sounds" : "Mute sounds"}
          type="button"
        >
          {muted ? (
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" fill="currentColor" stroke="none" opacity="0.35" />
              <line x1="23" y1="9" x2="17" y2="15" />
              <line x1="17" y1="9" x2="23" y2="15" />
            </svg>
          ) : (
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" fill="currentColor" stroke="none" opacity="0.35" />
              <path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
              <path d="M19.07 4.93a10 10 0 0 1 0 14.14" />
            </svg>
          )}
        </button>
        <button
          className="mobile-header-brand-btn"
          onClick={onOpenAccount}
          aria-label="My account"
          type="button"
        >
          <span className="mobile-header-name">AVIATOR</span>
          {errorBackend && <span className="mobile-header-offline">{t("header.offline")}</span>}
        </button>
      </div>
      <div className="mobile-header-right">
        <div className="mobile-header-balance" data-fx="balance">
          <span className="balance-amount">{balance.toFixed(2)}</span>
          <span className="balance-currency">{currency}</span>
        </div>
        {onRecharge && (
          <button
            className="mobile-header-recharge"
            onClick={onRecharge}
            aria-label="Top up balance"
          >
            {t("header.add")}
          </button>
        )}
        {onShare && (
          <button
            className="mobile-header-share-btn"
            onClick={onShare}
            aria-label="Share & earn"
          >
            🎁 {t("header.share")}
          </button>
        )}
        <button className="mobile-header-menu" onClick={onOpenMenu} aria-label="menu">
          <svg width="20" height="20" viewBox="0 0 20 20">
            <circle cx="4" cy="10" r="1.5" fill="currentColor" />
            <circle cx="10" cy="10" r="1.5" fill="currentColor" />
            <circle cx="16" cy="10" r="1.5" fill="currentColor" />
          </svg>
        </button>
      </div>
    </header>
  );
};
