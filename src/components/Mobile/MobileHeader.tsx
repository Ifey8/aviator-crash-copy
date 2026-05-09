import React from "react";
import Context from "../../context";
import { Plane } from "./Plane";

export const MobileHeader: React.FC<{ onOpenMenu: () => void }> = ({ onOpenMenu }) => {
  const { userInfo, errorBackend } = React.useContext(Context);
  const balance = Number(userInfo?.balance || 0);
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
