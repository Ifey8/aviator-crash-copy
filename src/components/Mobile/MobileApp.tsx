import React from "react";
import Context from "../../context";
import { MobileHeader } from "./MobileHeader";
import { HistoryBar } from "./HistoryBar";
import { GameCanvas } from "./GameCanvas";
import { BetCard } from "./BetCard";
import { BetsListSheet } from "./BetsListSheet";
import { CoinFxLayer } from "./CoinFxLayer";
import { RechargeSheet } from "./RechargeSheet";
import { ShareSheet } from "./ShareSheet";
import "./mobile.scss";
import "./recharge.scss";
// luxe.scss is imported from src/app.tsx as the LAST stylesheet so its
// theme overrides win the cascade. Don't re-import here — webpack dedup
// would lock in the earliest position and let auth.scss override luxe.

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
  const [rechargeOpen, setRechargeOpen] = React.useState(false);
  const [shareOpen, setShareOpen] = React.useState(false);

  return (
    <div className="mobile-app">
      {/* Ambient drifting gold dust — pure CSS, 10 specks, behind everything. */}
      <div className="luxe-dust" aria-hidden="true">
        <span /><span /><span /><span /><span />
        <span /><span /><span /><span /><span />
      </div>
      <MobileHeader
        onOpenMenu={() => setShareOpen(true)}
        onRecharge={() => setRechargeOpen(true)}
      />
      <main className="mobile-main">
        <HistoryBar />
        <GameCanvas />
        <div className="bet-cards-grid">
          <BetCard side="f" />
          <BetCard side="s" />
        </div>
        <BetsListSheet />
      </main>

      {/* Viewport-fixed gold-coin animation between header balance and plane.
          Spans across header + canvas, so it lives outside <main>. */}
      <CoinFxLayer />

      <RechargeSheet open={rechargeOpen} onClose={() => setRechargeOpen(false)} />

      <ShareSheet open={shareOpen} onClose={() => setShareOpen(false)} />

      {rechargeState && !shareOpen && !rechargeOpen && (
        <div className="mobile-modal-overlay">
          <div className="mobile-modal">
            <h3>Out of balance</h3>
            <p>
              Invite friends to recharge — get <strong>₹100</strong> for each
              one. Or top up your own balance to keep playing.
            </p>
            <div className="modal-cta-row">
              <button
                className="modal-cta share-first"
                onClick={() => setShareOpen(true)}
              >
                Share &amp; earn ₹100
              </button>
              <button
                className="modal-cta secondary"
                onClick={() => setRechargeOpen(true)}
              >
                Top up
              </button>
            </div>
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
