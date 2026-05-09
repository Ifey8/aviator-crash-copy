import React from "react";
import Context from "../../context";

const tierFor = (m: number): "low" | "mid" | "high" =>
  m < 2 ? "low" : m < 10 ? "mid" : "high";

export const HistoryBar: React.FC = () => {
  const { history } = React.useContext(Context);
  const list = (history as number[]) || [];
  return (
    <div className="history-bar-mobile" role="list">
      {list.slice(0, 30).map((m, i) => (
        <span
          key={`${i}-${m}`}
          className="history-chip"
          data-tier={tierFor(m)}
          role="listitem"
        >
          {m.toFixed(2)}x
        </span>
      ))}
    </div>
  );
};
