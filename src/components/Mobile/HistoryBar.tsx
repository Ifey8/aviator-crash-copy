import React from "react";
import Context from "../../context";

const colorFor = (m: number): string => {
  if (m < 2) return "var(--crash-blue)";
  if (m < 10) return "var(--crash-purple)";
  return "var(--crash-gold)";
};

export const HistoryBar: React.FC = () => {
  const { history } = React.useContext(Context);
  const list = (history as number[]) || [];
  return (
    <div className="history-bar-mobile" role="list">
      {list.slice(0, 30).map((m, i) => (
        <span
          key={`${i}-${m}`}
          className="history-chip"
          style={{ color: colorFor(m), borderColor: colorFor(m) }}
          role="listitem"
        >
          {m.toFixed(2)}x
        </span>
      ))}
    </div>
  );
};
