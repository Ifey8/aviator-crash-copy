import React from "react";
import Context from "../../context";

type Tab = "all" | "my" | "top";

const colorFor = (m: number): string => {
  if (m < 2) return "var(--crash-blue)";
  if (m < 10) return "var(--crash-purple)";
  return "var(--crash-gold)";
};

const maskName = (n: string): string => {
  if (!n) return "***";
  if (n.length <= 4) return n[0] + "***";
  return n.slice(0, 2) + "***" + n.slice(-1);
};

export const BetsListSheet: React.FC = () => {
  const { bettedUsers, history, userInfo } = React.useContext(Context);
  const [tab, setTab] = React.useState<Tab>("all");

  const all = (bettedUsers as any[]) || [];

  const myBets = all.filter((b) => b?.userName === userInfo?.userName);

  const top = ((history as number[]) || [])
    .map((m, i) => ({ multiplier: m, idx: i }))
    .sort((a, b) => b.multiplier - a.multiplier)
    .slice(0, 20);

  const renderRow = (b: any, key: string | number) => {
    const m = b.cashOutAt || 0;
    return (
      <div key={key} className={`bets-row ${b.cashouted ? "cashed" : ""}`}>
        <span className="bets-row-user">{maskName(b.userName)}</span>
        <span className="bets-row-bet">{Number(b.betAmount).toFixed(2)}</span>
        <span className="bets-row-mult" style={{ color: m ? colorFor(m) : undefined }}>
          {m ? `${m.toFixed(2)}x` : "—"}
        </span>
        <span className="bets-row-cash">
          {b.cashouted ? Number(b.cashAmount).toFixed(2) : "—"}
        </span>
      </div>
    );
  };

  return (
    <section className="bets-list-sheet">
      <div className="bets-list-tabs">
        <button className={`bets-tab ${tab === "all" ? "active" : ""}`} onClick={() => setTab("all")}>
          All Bets <span className="bets-tab-count">{all.length}</span>
        </button>
        <button className={`bets-tab ${tab === "my" ? "active" : ""}`} onClick={() => setTab("my")}>
          My Bets
        </button>
        <button className={`bets-tab ${tab === "top" ? "active" : ""}`} onClick={() => setTab("top")}>
          Top
        </button>
      </div>

      <div className="bets-list-header">
        {tab === "top" ? (
          <>
            <span>Round</span>
            <span />
            <span>Crash</span>
            <span />
          </>
        ) : (
          <>
            <span>User</span>
            <span>Bet</span>
            <span>X</span>
            <span>Cash out</span>
          </>
        )}
      </div>

      <div className="bets-list-scroll">
        {tab === "all" && all.length === 0 && <div className="bets-list-empty">No bets in this round yet</div>}
        {tab === "all" && all.map((b, i) => renderRow(b, i))}
        {tab === "my" && myBets.length === 0 && <div className="bets-list-empty">No bets yet</div>}
        {tab === "my" && myBets.map((b, i) => renderRow(b, i))}
        {tab === "top" && top.length === 0 && <div className="bets-list-empty">No history</div>}
        {tab === "top" &&
          top.map((t) => (
            <div key={t.idx} className="bets-row">
              <span className="bets-row-user">#{t.idx + 1}</span>
              <span />
              <span className="bets-row-mult" style={{ color: colorFor(t.multiplier) }}>
                {t.multiplier.toFixed(2)}x
              </span>
              <span />
            </div>
          ))}
      </div>
    </section>
  );
};
