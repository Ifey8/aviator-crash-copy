import React from "react";
import Context from "../../context";
import { MobileHeader } from "./MobileHeader";
import { HistoryBar } from "./HistoryBar";
import { GameCanvas } from "./GameCanvas";
import { BetCard } from "./BetCard";
import { BetsListSheet } from "./BetsListSheet";
import "./mobile.scss";
import "./luxe.scss";

const useTelegramTheme = () => {
  React.useEffect(() => {
    const tg = (window as any).Telegram?.WebApp;
    if (!tg) return;
    try {
      tg.ready?.();
      tg.expand?.();
      tg.setHeaderColor?.("#0d1320");
      tg.setBackgroundColor?.("#0d1320");
      const tp = tg.themeParams || {};
      const root = document.documentElement;
      if (tp.bg_color) root.style.setProperty("--tg-bg", tp.bg_color);
      if (tp.text_color) root.style.setProperty("--tg-text", tp.text_color);
    } catch {
      // no-op outside Telegram
    }
  }, []);
};

export const MobileApp: React.FC = () => {
  useTelegramTheme();
  const { rechargeState, errorBackend, platformLoading } = React.useContext(Context);
  const [, setMenuOpen] = React.useState(false);

  return (
    <div className="mobile-app">
      {/* Ambient drifting gold dust — pure CSS, 10 specks, behind everything. */}
      <div className="luxe-dust" aria-hidden="true">
        <span /><span /><span /><span /><span />
        <span /><span /><span /><span /><span />
      </div>
      <MobileHeader onOpenMenu={() => setMenuOpen(true)} />
      <main className="mobile-main">
        <HistoryBar />
        <GameCanvas />
        <div className="bet-cards-grid">
          <BetCard side="f" />
          <BetCard side="s" />
        </div>
        <BetsListSheet />
      </main>

      {rechargeState && (
        <div className="mobile-modal-overlay">
          <div className="mobile-modal">
            <h3>Insufficient balance</h3>
            <p>You need at least 1 to play. Top up to continue.</p>
            <button className="modal-cta" onClick={() => window.location.reload()}>
              Reload
            </button>
          </div>
        </div>
      )}

      {errorBackend && (
        <div className="connection-toast">⚠ Connection lost — reconnecting…</div>
      )}

      {platformLoading && (
        <div className="mobile-loader">
          <div className="mobile-loader-spinner" />
        </div>
      )}
    </div>
  );
};

export default MobileApp;
