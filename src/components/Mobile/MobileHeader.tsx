import React from "react";
import Context from "../../context";

export const MobileHeader: React.FC<{ onOpenMenu: () => void }> = ({ onOpenMenu }) => {
  const { userInfo, errorBackend } = React.useContext(Context);
  const balance = Number(userInfo?.balance || 0);
  const currency = userInfo?.currency || "INR";
  return (
    <header className="mobile-header">
      <div className="mobile-header-brand">
        <span className="mobile-header-logo" aria-label="Crash Plane">
          <svg width="22" height="14" viewBox="0 0 22 14" aria-hidden="true">
            <path
              d="M2 8 L10 4 L20 6 L18 8 L13 9 L11 12 L9 9 Z"
              fill="#ff5468"
              stroke="#5a0815"
              strokeWidth="0.6"
            />
          </svg>
        </span>
        <span className="mobile-header-name">CRASH PLANE</span>
        {errorBackend && <span className="mobile-header-offline">offline</span>}
      </div>
      <div className="mobile-header-right">
        <div className="mobile-header-balance">
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
