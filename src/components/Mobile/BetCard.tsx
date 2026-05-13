import React from "react";
import Context, { callCashOut } from "../../context";
import { useT } from "../../i18n";

type Side = "f" | "s";

interface Props {
  side: Side;
}

const QUICK_AMOUNTS = [10, 50, 100, 500];

export const BetCard: React.FC<Props> = ({ side }) => {
  const ctx = React.useContext(Context);
  const { t } = useT();
  const userInfo = ctx.userInfo;
  const sideInfo = userInfo[side];
  const phase = ctx.GameState;

  const [mode, setMode] = React.useState<"bet" | "auto">("bet");
  const [amount, setAmount] = React.useState<number>(sideInfo.betAmount || 10);
  const [autoTarget, setAutoTarget] = React.useState<number>(sideInfo.target || 2);
  // Track which quick-amount button was last tapped. Same button = +=,
  // different button = reset to that amount as if first click.
  const [lastQuickClick, setLastQuickClick] = React.useState<number | null>(null);
  // Pre-bet: queue a bet during PLAYING (after cashout) → auto-fire on
  // next BET phase. Lets users set up their next wager without waiting.
  const [pendingBet, setPendingBet] = React.useState<{ amount: number; target: number; auto: boolean } | null>(null);

  const betted = side === "f" ? ctx.fbetted : ctx.sbetted;
  const cashouted = sideInfo.cashouted;
  const cashAmount = sideInfo.cashAmount || 0;
  // After cashout, unlock inputs so the user can configure next bet.
  const inputLocked = betted && !cashouted;

  const minBet = ctx.minBet ?? 1;
  const maxBet = ctx.maxBet ?? 1000;

  const setSafeAmount = (v: number) =>
    setAmount(Math.max(minBet, Math.min(maxBet, +v.toFixed(2))));

  // Quick-button click semantics:
  //   • First tap of a button → bet = button value
  //   • Same button tapped again → bet += button value (累加)
  //   • Different button → reset, that becomes the new "first tap"
  // Direct edits (input / +/- stepper) reset the last-clicked tracker.
  const onQuickClick = (v: number): void => {
    if (lastQuickClick === v) {
      setSafeAmount(amount + v);
    } else {
      setSafeAmount(v);
      setLastQuickClick(v);
    }
  };

  const placeBet = () => {
    if (phase !== "BET") return;
    if (amount > userInfo.balance) return;
    const isAuto = mode === "auto";
    const target = isAuto ? autoTarget : 2;
    const newSide = { ...sideInfo, betAmount: amount, target, auto: isAuto };

    // Both userInfo containers must reflect the new auto/target — the
    // BetCard reads the *standalone* userInfo (for the AUTO ON pill, the
    // CTA label, etc.), while the BET-phase auto-repeat handler in
    // context.tsx also reads it via setUserInfo's prev callback. Without
    // updating both, the auto loop silently never re-fires.
    ctx.update({ userInfo: { ...userInfo, [side]: newSide } });
    ctx.updateUserInfo({ [side]: newSide } as any);

    const sock = (ctx as any).socket;
    sock?.emit("playBet", { betAmount: amount, target, type: side, auto: isAuto });

    // Optimistic UI flag — server's myBetState/myInfo will confirm.
    ctx.updateUserBetState({ [`${side}betted`]: true } as any);
  };

  const cashOut = () => {
    callCashOut(Number((ctx.currentTarget as any) || 0), side);
  };

  const stopAuto = () => {
    // Flip auto off in BOTH containers (state.userInfo and standalone
    // userInfo) — the BET-phase auto-repeat reads the standalone one.
    const newSide = { ...sideInfo, auto: false };
    ctx.update({ userInfo: { ...userInfo, [side]: newSide } });
    ctx.updateUserInfo({ [side]: newSide } as any);
  };

  // Queue a bet for the next round (used after cashout during PLAYING).
  // Server only accepts bets in BET phase — this saves the intent locally
  // and auto-fires when the phase transitions.
  const queueBet = () => {
    const isAuto = mode === "auto";
    setPendingBet({ amount, target: isAuto ? autoTarget : 2, auto: isAuto });
  };

  const cancelQueue = () => setPendingBet(null);

  // Auto-fire pending bet when BET phase starts.
  React.useEffect(() => {
    if (phase !== "BET" || !pendingBet) return;
    // Phase just changed to BET and we have a queued bet — place it.
    const { amount: betAmt, target: tgt, auto: isAuto } = pendingBet;
    setPendingBet(null);
    if (betAmt > userInfo.balance) return; // balance insufficient

    const newSide = { ...sideInfo, betAmount: betAmt, target: tgt, auto: isAuto };
    ctx.update({ userInfo: { ...userInfo, [side]: newSide } });
    ctx.updateUserInfo({ [side]: newSide } as any);

    const sock = (ctx as any).socket;
    sock?.emit("playBet", { betAmount: betAmt, target: tgt, type: side, auto: isAuto });
    ctx.updateUserBetState({ [`${side}betted`]: true } as any);
  }, [phase]);

  // Clear pending bet when a new round resets the card state (betted goes
  // false on BET phase via the myInfo handler in context.tsx).
  React.useEffect(() => {
    if (!betted && !cashouted) setPendingBet(null);
  }, [betted, cashouted]);

  const autoOn = !!sideInfo.auto;

  // ---- CTA selection ----
  let cta: React.ReactNode;
  if (phase === "PLAYING" && betted && !cashouted) {
    cta = (
      <button className="bet-cta cta-cashout" onClick={cashOut}>
        <span className="cta-line-1">{t("cta.cashOut")}</span>
        <span className="cta-line-2">
          {(amount * Number((ctx.currentTarget as any) || 1)).toFixed(2)} INR
        </span>
      </button>
    );
  } else if (betted && !cashouted) {
    // Server already accepted the bet — no client-side cancel. Once placed,
    // the bet is locked until cashout (during PLAYING) or crash (settle).
    // Showing a CANCEL button here was misleading because cancelBet only
    // touched local state; the server-side wager + balance deduction stayed.
    cta = (
      <button className="bet-cta cta-waiting" disabled>
        <span className="cta-line-1">{t("cta.betPlaced")}</span>
        <span className="cta-line-2">{amount.toFixed(2)} INR</span>
      </button>
    );
  } else if (cashouted) {
    if (pendingBet) {
      // Bet queued for next round — show confirmation with cancel option
      cta = (
        <button className="bet-cta cta-queued" onClick={cancelQueue}>
          <span className="cta-line-1">{t("cta.queued")}</span>
          <span className="cta-line-2">
            {pendingBet.amount.toFixed(2)} INR
            {pendingBet.auto && ` · @${pendingBet.target.toFixed(2)}x`}
          </span>
        </button>
      );
    } else {
      // Cashed out — let user prepare next bet
      cta = (
        <button className="bet-cta cta-next" onClick={queueBet}>
          <span className="cta-line-1">{t("cta.nextBet")}</span>
          <span className="cta-line-2">
            {amount.toFixed(2)} INR
            {mode === "auto" && ` · @${autoTarget.toFixed(2)}x`}
          </span>
        </button>
      );
    }
  } else {
    cta = (
      <button
        className={`bet-cta ${mode === "auto" ? "cta-bet-auto" : "cta-bet"}`}
        onClick={placeBet}
        disabled={phase !== "BET"}
      >
        <span className="cta-line-1">{mode === "auto" ? t("cta.autoBet") : t("cta.bet")}</span>
        <span className="cta-line-2">
          {amount.toFixed(2)} INR
          {mode === "auto" && ` · @${autoTarget.toFixed(2)}x`}
        </span>
      </button>
    );
  }

  return (
    <div className={`bet-card side-${side} ${mode === "auto" ? "auto-mode" : ""}`}>
      <div className="bet-card-tabs">
        <button
          className={`tab ${mode === "bet" ? "active" : ""}`}
          onClick={() => setMode("bet")}
          disabled={inputLocked}
        >
          {t("bet.tab.bet")}
        </button>
        <button
          className={`tab ${mode === "auto" ? "active" : ""}`}
          onClick={() => setMode("auto")}
          disabled={inputLocked}
        >
          {t("bet.tab.auto")}
        </button>
      </div>

      {/* Full-width stepper so the bet number gets real room.
          Layout was previously stepper + CTA in a 2-column grid which
          collapsed the input on small screens. */}
      <div className="amount-stepper full">
        <button
          type="button"
          className="step-btn"
          onClick={() => { setSafeAmount(amount - 1); setLastQuickClick(null); }}
          disabled={inputLocked}
          aria-label="decrease"
        >
          −
        </button>
        <input
          className="amount-input main"
          type="text"
          inputMode="decimal"
          value={amount.toFixed(2)}
          onChange={(e) => {
            const v = parseFloat(e.target.value.replace(/[^\d.]/g, ""));
            if (!isNaN(v)) { setSafeAmount(v); setLastQuickClick(null); }
          }}
          disabled={inputLocked}
          aria-label="bet amount"
        />
        <button
          type="button"
          className="step-btn"
          onClick={() => { setSafeAmount(amount + 1); setLastQuickClick(null); }}
          disabled={inputLocked}
          aria-label="increase"
        >
          +
        </button>
      </div>

      <div className="quick-amounts">
        {QUICK_AMOUNTS.map((v) => (
          <button
            key={v}
            className={`quick-amount-btn ${lastQuickClick === v ? "last" : ""}`}
            onClick={() => onQuickClick(v)}
            disabled={inputLocked}
          >
            {v}
          </button>
        ))}
      </div>

      {mode === "auto" && (
        <div className="auto-target-row">
          <div className="auto-target-caption">{t("bet.autoTarget")}</div>
          <div className="amount-stepper compact">
            <button
              className="step-btn"
              onClick={() => setAutoTarget(Math.max(1.01, +(autoTarget - 0.1).toFixed(2)))}
              disabled={inputLocked}
              aria-label="decrease target"
            >
              −
            </button>
            <input
              className="amount-input compact"
              type="text"
              inputMode="decimal"
              value={`${autoTarget.toFixed(2)}x`}
              onChange={(e) => {
                const v = parseFloat(e.target.value.replace(/[^\d.]/g, ""));
                if (!isNaN(v)) setAutoTarget(Math.max(1.01, v));
              }}
              disabled={inputLocked}
              aria-label="auto cashout target"
            />
            <button
              className="step-btn"
              onClick={() => setAutoTarget(+(autoTarget + 0.1).toFixed(2))}
              disabled={inputLocked}
              aria-label="increase target"
            >
              +
            </button>
          </div>
        </div>
      )}

      <div className="bet-cta-row">{cta}</div>

      {autoOn && (
        <button className="auto-on-pill" onClick={stopAuto} type="button">
          <span className="dot" />
          {t("auto.on")} · @{(sideInfo.target || autoTarget).toFixed(2)}x
          <span className="stop-x">{t("auto.stop")}</span>
        </button>
      )}
    </div>
  );
};
