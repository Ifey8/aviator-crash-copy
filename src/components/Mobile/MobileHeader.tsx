import React from "react";
import Context from "../../context";
import { Plane } from "./Plane";

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

export const MobileHeader: React.FC<{ onOpenMenu: () => void }> = ({ onOpenMenu }) => {
  const { userInfo, errorBackend } = React.useContext(Context);
  const balanceServer = Number(userInfo?.balance || 0);
  const balance = useDisplayBalance(balanceServer);
  const currency = userInfo?.currency || "INR";
  return (
    <header className="mobile-header">
      <div className="mobile-header-brand">
        <span className="mobile-header-logo" aria-label="Aviator Plane">
          <Plane size={28} static halo={false} />
        </span>
        <span className="mobile-header-name">AVIATOR</span>
        {errorBackend && <span className="mobile-header-offline">offline</span>}
      </div>
      <div className="mobile-header-right">
        <div className="mobile-header-balance" data-fx="balance">
          <span className="balance-amount">{balance.toFixed(2)}</span>
          <span className="balance-currency">{currency}</span>
        </div>
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
