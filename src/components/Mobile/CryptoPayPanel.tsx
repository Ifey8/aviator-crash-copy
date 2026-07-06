import React from "react";
import { QRCodeSVG } from "qrcode.react";
import Context from "../../context";
import { config } from "../../config";

/**
 * CryptoPayPanel — sub-flow inside RechargeSheet for USDT-TRC20 recharge.
 *
 * Flow:
 *   picker → POST /api/crypto/create
 *           ↓ pending: render QR + receiver address + countdown + amount
 *           ↓ user transfers EXACTLY amountUsdt USDT to receiver
 *           ↓ backend watcher polls TronGrid → matches tx → credits balance
 *           ↓ socket "rechargeUpdate" pushes status:paid → success
 *
 * Rendering uses qrcode.react (SVG, ~10kb gz). Two channels track status:
 *   1. socket "rechargeUpdate" event (instant)
 *   2. polling /api/crypto/status every 5s as fallback
 */

interface CryptoOrder {
  orderId: string;
  amountUsdt: number;        // recommended (informational only)
  amountInr: number;         // recommended (informational only)
  fxRate: number;
  network: string;
  /** Per-order unique deposit address derived from server HD master seed. */
  depositAddress: string;
  contractAddress: string;
  status: string;
  txHash?: string;
  /** What the user actually transferred (filled when paid). */
  actualUsdt?: number;
  actualInr?: number;
  expiresAt: string;
  paidAt?: string;
  rateSource?: string;
  minUsdt?: number;
}

interface Props {
  /** Last INR amount picked in the parent picker — converted to USDT here. */
  amountInr: number;
  /** "tron" or an EVM chain key ("polygon"|"bsc"|"ethereum"). */
  network: string;
  /** Closes the whole sheet. */
  onDone: () => void;
  /** Triggers the parent to go back to picker step. */
  onRetry: () => void;
}

const TOKEN_KEY = "aviator_token";
const apiBase = config.api;

const authHeaders = (): Record<string, string> => {
  const t = localStorage.getItem(TOKEN_KEY);
  return t ? { Authorization: `Bearer ${t}` } : {};
};

type Step = "creating" | "pending" | "success" | "failed";

export const CryptoPayPanel: React.FC<Props> = ({ amountInr, network, onDone, onRetry }) => {
  const ctx = React.useContext(Context);
  const sock = (ctx as any).socket;

  const [step, setStep] = React.useState<Step>("creating");
  const [order, setOrder] = React.useState<CryptoOrder | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [copied, setCopied] = React.useState<string | null>(null);

  // 1) Create the order on mount
  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`${apiBase}/crypto/create`, {
          method: "POST",
          headers: { "Content-Type": "application/json", ...authHeaders() },
          body: JSON.stringify({ amountInr, network: network === "tron" ? undefined : network }),
        });
        const json = await res.json();
        if (cancelled) return;
        if (!json.status) {
          setError(json.message || "Failed to create order");
          setStep("failed");
          return;
        }
        setOrder(json.data);
        setStep("pending");
      } catch {
        if (!cancelled) {
          setError("Network error");
          setStep("failed");
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [amountInr, network]);

  // 2) Socket push from backend (instant on tx match)
  React.useEffect(() => {
    if (!sock || !order) return;
    const onUpdate = (msg: { orderId: string; status: string; source?: string }) => {
      if (msg.orderId !== order.orderId) return;
      if (msg.status === "paid") setStep("success");
      else if (msg.status === "expired" || msg.status === "cancelled" || msg.status === "failed") {
        setStep("failed");
      }
      setOrder((o) => (o ? { ...o, status: msg.status } : null));
    };
    sock.on("rechargeUpdate", onUpdate);
    return () => sock.off("rechargeUpdate", onUpdate);
  }, [sock, order]);

  // 3) Polling fallback every 5s
  React.useEffect(() => {
    if (step !== "pending" || !order) return;
    let stopped = false;
    const tick = async () => {
      try {
        const res = await fetch(`${apiBase}/crypto/status/${order.orderId}`, {
          headers: authHeaders(),
        });
        const json = await res.json();
        if (stopped || !json.status) return;
        const s = json.data.status;
        setOrder((o) => (o ? { ...o, status: s, txHash: json.data.txHash } : null));
        if (s === "paid") setStep("success");
        else if (s !== "pending") setStep("failed");
      } catch { /* retry next tick */ }
    };
    const iv = setInterval(tick, 5000);
    return () => {
      stopped = true;
      clearInterval(iv);
    };
  }, [step, order]);

  const cancelOrder = async (): Promise<void> => {
    if (order) {
      try {
        await fetch(`${apiBase}/crypto/cancel/${order.orderId}`, {
          method: "POST",
          headers: authHeaders(),
        });
      } catch { /* best-effort */ }
    }
    onDone();
  };

  const copyToClipboard = async (text: string, label: string): Promise<void> => {
    // navigator.clipboard requires a secure context AND focused document.
    // Fails silently in iframes (Telegram WebView, Claude Preview, etc), so
    // we always wire up the textarea+execCommand fallback. document.execCommand
    // is deprecated but still works everywhere as of 2026-05.
    let ok = false;
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
        ok = true;
      }
    } catch { /* fall through */ }
    if (!ok) {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.setAttribute("readonly", "");
      ta.style.position = "fixed";
      ta.style.top = "0";
      ta.style.left = "0";
      ta.style.width = "1px";
      ta.style.height = "1px";
      ta.style.opacity = "0";
      ta.style.pointerEvents = "none";
      document.body.appendChild(ta);
      ta.focus();
      ta.select();
      ta.setSelectionRange(0, text.length);
      try {
        ok = document.execCommand("copy");
      } catch {
        ok = false;
      }
      document.body.removeChild(ta);
    }
    if (ok) {
      setCopied(label);
      setTimeout(() => setCopied(null), 1500);
    } else {
      // Last resort: show a prompt the user can manually copy from.
      // eslint-disable-next-line no-alert
      window.prompt("Copy this:", text);
    }
  };

  if (step === "creating") {
    return (
      <div className="rs-loader">
        <div className="rs-spinner" />
        <p>Creating crypto order…</p>
      </div>
    );
  }

  if (step === "failed") {
    return (
      <div className="rs-failed">
        <div className="rs-x">×</div>
        <h3 className="rs-title">Order unsuccessful</h3>
        <p className="rs-sub">{error || (order?.status === "expired" ? "Order expired before payment." : "Payment did not complete.")}</p>
        <button className="rs-cta" onClick={onRetry}>Try again</button>
      </div>
    );
  }

  if (step === "success" && order) {
    const credited = order.actualInr ?? order.amountInr;
    const paidUsdt = order.actualUsdt ?? order.amountUsdt;
    return (
      <div className="rs-success">
        <div className="rs-check">✓</div>
        <h3 className="rs-title">Recharge complete</h3>
        <p className="rs-sub">
          +₹{credited.toLocaleString("en-IN", { maximumFractionDigits: 2 })} added
          to your balance
        </p>
        <p className="cp-paid-meta">
          {paidUsdt.toFixed(2)} USDT received @ {order.fxRate.toFixed(2)} INR/USDT
        </p>
        {order.txHash && (
          <p className="cp-txhash">tx: {order.txHash.slice(0, 12)}…{order.txHash.slice(-6)}</p>
        )}
        <button className="rs-cta" onClick={onDone}>Done</button>
      </div>
    );
  }

  if (!order) return null;

  // Pending — show QR + per-order deposit address + recommended amount.
  // User can pay ANY amount; we credit actual_received × locked rate.
  return (
    <div className="cp-pending">
      <div className="cp-network-badge">{order.network.toUpperCase()} · USDT</div>
      <h3 className="rs-title">Send USDT to deposit address</h3>

      <div className="cp-amount-row">
        <div className="cp-amount-usdt">
          <span className="cp-amount-num">{order.amountUsdt.toFixed(2)}</span>
          <span className="cp-amount-unit">USDT</span>
        </div>
        <div className="cp-amount-inr">
          ≈ ₹{order.amountInr.toLocaleString("en-IN")} <span className="cp-rate">@ {order.fxRate.toFixed(2)}</span>
        </div>
        <div className="cp-amount-hint">recommended · pay any amount, get equivalent INR</div>
      </div>

      <div className="cp-qr-wrap">
        <QRCodeSVG
          value={order.depositAddress}
          size={176}
          level="M"
          marginSize={2}
          bgColor="#fff5dc"
          fgColor="#1a0710"
        />
      </div>

      <div className="cp-field">
        <span className="cp-field-label">Deposit address (unique to this order)</span>
        <div className="cp-field-value">
          <code>{order.depositAddress}</code>
          <button
            className="cp-copy-btn"
            onClick={() => copyToClipboard(order.depositAddress, "address")}
            type="button"
          >
            {copied === "address" ? "✓ Copied" : "Copy"}
          </button>
        </div>
      </div>

      <div className="cp-field">
        <span className="cp-field-label">Recommended amount (USDT)</span>
        <div className="cp-field-value">
          <code>{order.amountUsdt.toFixed(2)}</code>
          <button
            className="cp-copy-btn"
            onClick={() => copyToClipboard(order.amountUsdt.toFixed(2), "amount")}
            type="button"
          >
            {copied === "amount" ? "✓ Copied" : "Copy"}
          </button>
        </div>
      </div>

      <ExpiryCountdown
        expiresAt={order.expiresAt}
        onExpire={() => setStep("failed")}
      />

      <p className="cp-warn">
        ⚠ Send <b>USDT</b> over the <b>{order.network}</b> network ONLY.
        This address is unique to your order — any USDT amount ≥ <b>{(order.minUsdt ?? 10)} USDT</b> credits
        you the equivalent INR at <b>{order.fxRate.toFixed(2)}</b>. Network transactions are final.
      </p>

      <button className="rs-link" onClick={cancelOrder}>Cancel order</button>
    </div>
  );
};

const ExpiryCountdown: React.FC<{ expiresAt: string; onExpire: () => void }> = ({
  expiresAt,
  onExpire,
}) => {
  const [now, setNow] = React.useState(Date.now());
  React.useEffect(() => {
    const iv = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(iv);
  }, []);
  const target = new Date(expiresAt).getTime();
  const remaining = Math.max(0, target - now);
  const fired = React.useRef(false);
  React.useEffect(() => {
    if (remaining === 0 && !fired.current) {
      fired.current = true;
      onExpire();
    }
  }, [remaining, onExpire]);
  const m = Math.floor(remaining / 60000);
  const s = Math.floor((remaining % 60000) / 1000);
  return (
    <div className="rs-countdown cp-countdown">
      Expires in <span>{m}:{s.toString().padStart(2, "0")}</span>
    </div>
  );
};

export default CryptoPayPanel;
