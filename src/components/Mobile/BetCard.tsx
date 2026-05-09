import React from "react";
import Context, { callCashOut } from "../../context";

type Side = "f" | "s";

interface Props {
  side: Side;
}

const QUICK_AMOUNTS = [10, 50, 100, 500];

export const BetCard: React.FC<Props> = ({ side }) => {
  const ctx = React.useContext(Context);
  const userInfo = ctx.userInfo;
  const sideInfo = userInfo[side];
  const phase = ctx.GameState;

  const [mode, setMode] = React.useState<"bet" | "auto">("bet");
  const [amount, setAmount] = React.useState<number>(sideInfo.betAmount || 10);
  const [autoTarget, setAutoTarget] = React.useState<number>(sideInfo.target || 2);

  const betted = side === "f" ? ctx.fbetted : ctx.sbetted;
  const cashouted = sideInfo.cashouted;
  const cashAmount = sideInfo.cashAmount || 0;

  const minBet = ctx.minBet ?? 1;
  const maxBet = ctx.maxBet ?? 1000;

  const setSafeAmount = (v: number) => setAmount(Math.max(minBet, Math.min(maxBet, +v.toFixed(2))));

  const placeBet = () => {
    if (phase !== "BET") return;
    if (amount > userInfo.balance) {
      // surfaced via toast by error event; just no-op locally
    }
    ctx.update({
      userInfo: {
        ...userInfo,
        [side]: {
          ...sideInfo,
          betAmount: amount,
          target: mode === "auto" ? autoTarget : 2,
          auto: mode === "auto",
        },
      },
    });
    ctx.updateUserBetState({ [`${side}betState`]: true } as any);
  };

  const cancelBet = () => {
    ctx.updateUserBetState({ [`${side}betState`]: false, [`${side}betted`]: false } as any);
  };

  const cashOut = () => {
    callCashOut(Number((ctx.currentTarget as any) || 0), side);
  };

  // Render state machine
  let body: React.ReactNode;
  if (phase === "PLAYING" && betted && !cashouted) {
    body = (
      <button className="bet-cta cta-cashout" onClick={cashOut}>
        <span className="cta-line-1">CASH OUT</span>
        <span className="cta-line-2">
          {(amount * Number((ctx.currentTarget as any) || 1)).toFixed(2)} INR
        </span>
      </button>
    );
  } else if (betted && !cashouted) {
    body = (
      <button className="bet-cta cta-cancel" onClick={cancelBet}>
        <span className="cta-line-1">CANCEL</span>
        <span className="cta-line-2">{amount.toFixed(2)} INR</span>
      </button>
    );
  } else if (cashouted) {
    body = (
      <button className="bet-cta cta-won" disabled>
        <span className="cta-line-1">CASHED OUT</span>
        <span className="cta-line-2">+{cashAmount.toFixed(2)} INR</span>
      </button>
    );
  } else {
    body = (
      <button className="bet-cta cta-bet" onClick={placeBet} disabled={phase !== "BET"}>
        <span className="cta-line-1">BET</span>
        <span className="cta-line-2">{amount.toFixed(2)} INR</span>
      </button>
    );
  }

  return (
    <div className={`bet-card side-${side}`}>
      <div className="bet-card-tabs">
        <button
          className={`tab ${mode === "bet" ? "active" : ""}`}
          onClick={() => setMode("bet")}
          disabled={betted}
        >
          Bet
        </button>
        <button
          className={`tab ${mode === "auto" ? "active" : ""}`}
          onClick={() => setMode("auto")}
          disabled={betted}
        >
          Auto
        </button>
      </div>

      <div className="bet-card-row">
        <div className="amount-stepper">
          <button
            className="step-btn"
            onClick={() => setSafeAmount(amount - 1)}
            disabled={betted}
            aria-label="decrease"
          >
            −
          </button>
          <input
            className="amount-input"
            type="number"
            inputMode="decimal"
            value={amount}
            onChange={(e) => setSafeAmount(Number(e.target.value))}
            disabled={betted}
            min={minBet}
            max={maxBet}
            step="1"
          />
          <button
            className="step-btn"
            onClick={() => setSafeAmount(amount + 1)}
            disabled={betted}
            aria-label="increase"
          >
            +
          </button>
        </div>
        {body}
      </div>

      <div className="quick-amounts">
        {QUICK_AMOUNTS.map((v) => (
          <button
            key={v}
            className="quick-amount-btn"
            onClick={() => setSafeAmount(v)}
            disabled={betted}
          >
            {v}
          </button>
        ))}
      </div>

      {mode === "auto" && (
        <div className="auto-target-row">
          <span>Auto cash out at</span>
          <div className="amount-stepper compact">
            <button
              className="step-btn"
              onClick={() => setAutoTarget(Math.max(1.01, +(autoTarget - 0.1).toFixed(2)))}
              disabled={betted}
            >
              −
            </button>
            <input
              className="amount-input compact"
              type="number"
              inputMode="decimal"
              step="0.1"
              min={1.01}
              value={autoTarget}
              onChange={(e) => setAutoTarget(Math.max(1.01, Number(e.target.value)))}
              disabled={betted}
            />
            <button
              className="step-btn"
              onClick={() => setAutoTarget(+(autoTarget + 0.1).toFixed(2))}
              disabled={betted}
            >
              +
            </button>
          </div>
          <span className="x-suffix">x</span>
        </div>
      )}
    </div>
  );
};
