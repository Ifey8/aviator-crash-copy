import React from "react";
import Context from "../../context";
import { config } from "../../config";
import { CryptoPayPanel } from "./CryptoPayPanel";
import { useT } from "../../i18n";

/**
 * RechargeSheet — bottom sheet for topping up balance via a payment provider.
 *
 * Step machine:
 *   picker   → user picks amount + provider
 *   creating → POSTing /api/recharge/create
 *   pending  → order open at provider; we poll /status + listen on socket
 *   success  → order paid (+balance credited server-side via myInfo)
 *   failed   → cancelled / expired / failed
 *
 * Two channels close the loop after the user pays:
 *   1. Socket "rechargeUpdate" event — pushed by backend the moment the
 *      provider's webhook fires. Instant feedback if the user is online.
 *   2. Polling /api/recharge/status every 2s as a fallback (also lets us
 *      detect expiry without waiting for the provider).
 *
 * On dev (mock provider) the paymentUrl points to /mock-pay where a fake
 * PAY button hits POST /api/recharge/mock-pay/:orderId and the same socket
 * event fires.
 */

// Same presets for both UPI/Cards and USDT paths — CryptoPayPanel
// converts to USDT at the locked fxRate when the user picks INR.
const PRESETS = [100, 500, 1000, 2000, 5000, 10000, 20000, 30000, 50000];

type PayMethod = "fiat" | "crypto";
type Step = "picker" | "creating" | "pending" | "success" | "failed" | "crypto";

interface OrderData {
  orderId: string;
  amount: number;
  paymentUrl: string;
  status: string;
  expiresAt: string;
  paidAt?: string;
}

interface Props {
  open: boolean;
  onClose: () => void;
}

const TOKEN_KEY = "aviator_token";
const apiBase = config.api;

const authHeaders = (): Record<string, string> => {
  const t = localStorage.getItem(TOKEN_KEY);
  return t ? { Authorization: `Bearer ${t}` } : {};
};

export const RechargeSheet: React.FC<Props> = ({ open, onClose }) => {
  const ctx = React.useContext(Context);
  const { t } = useT();
  const sock = (ctx as any).socket;

  const [step, setStep] = React.useState<Step>("picker");
  const [amount, setAmount] = React.useState<number>(500);
  const [method, setMethod] = React.useState<PayMethod>("fiat");
  const [order, setOrder] = React.useState<OrderData | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  // inrEnabled: backend admin Setting. Default null = still loading; default
  // to false when the call fails so we don't show a tab that returns 403.
  const [inrEnabled, setInrEnabled] = React.useState<boolean | null>(null);

  // Fetch channel availability whenever the sheet opens (it can change
  // mid-session when admin flips the toggle). Once loaded, prefer crypto
  // automatically if INR is off so the user doesn't see an empty picker.
  React.useEffect(() => {
    if (!open) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`${apiBase}/recharge/config`, { headers: authHeaders() });
        const json = await res.json();
        if (cancelled) return;
        const inr = !!json?.data?.inrEnabled;
        setInrEnabled(inr);
        if (!inr) setMethod("crypto");
      } catch {
        if (!cancelled) {
          setInrEnabled(false);
          setMethod("crypto");
        }
      }
    })();
    return () => { cancelled = true; };
  }, [open]);

  // Reset on close so re-opening starts clean.
  // method is NOT reset here — the open-effect above sets it based on
  // current inrEnabled value, so we don't flash an INR tab that's about
  // to be hidden.
  React.useEffect(() => {
    if (!open) {
      setStep("picker");
      setOrder(null);
      setError(null);
    }
  }, [open]);

  // Channel 1: socket push from backend
  React.useEffect(() => {
    if (!sock || !order) return;
    const onUpdate = (msg: { orderId: string; status: string }) => {
      if (msg.orderId !== order.orderId) return;
      if (msg.status === "paid") setStep("success");
      else if (msg.status === "failed" || msg.status === "expired" || msg.status === "cancelled") setStep("failed");
      setOrder((o) => (o ? { ...o, status: msg.status } : null));
    };
    sock.on("rechargeUpdate", onUpdate);
    return () => sock.off("rechargeUpdate", onUpdate);
  }, [sock, order]);

  // Channel 2: polling fallback
  React.useEffect(() => {
    if (step !== "pending" || !order) return;
    let cancelled = false;
    const tick = async () => {
      try {
        const res = await fetch(`${apiBase}/recharge/status/${order.orderId}`, {
          headers: authHeaders(),
        });
        const json = await res.json();
        if (cancelled) return;
        if (json.status && json.data) {
          const s = json.data.status;
          setOrder((o) => (o ? { ...o, status: s } : null));
          if (s === "paid") setStep("success");
          else if (s !== "pending") setStep("failed");
        }
      } catch {
        /* ignore network blips, next tick will retry */
      }
    };
    const iv = setInterval(tick, 2000);
    return () => {
      cancelled = true;
      clearInterval(iv);
    };
  }, [step, order]);

  const handleConfirm = async (): Promise<void> => {
    if (amount <= 0) {
      setError(t("recharge.error.amount"));
      return;
    }
    if (method === "crypto") {
      // Crypto path is handled by CryptoPayPanel as a separate step.
      // It owns its own create/poll/socket logic since the flow differs
      // (no payment URL to open — user transfers from their own wallet).
      setStep("crypto");
      return;
    }
    setStep("creating");
    setError(null);
    try {
      const res = await fetch(`${apiBase}/recharge/create`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({ amount }),
      });
      const json = await res.json();
      if (!json.status) {
        setError(json.message || t("recharge.error.create"));
        setStep("picker");
        return;
      }
      const o: OrderData = {
        orderId: json.data.orderId,
        amount: json.data.amount,
        paymentUrl: json.data.paymentUrl,
        status: json.data.status,
        expiresAt: json.data.expiresAt,
      };
      setOrder(o);
      setStep("pending");
      // Auto-open the provider's payment URL in a new tab.
      window.open(o.paymentUrl, "_blank", "noopener,noreferrer");
    } catch {
      setError(t("recharge.error.network"));
      setStep("picker");
    }
  };

  const handleCancel = async (): Promise<void> => {
    if (order && order.status === "pending") {
      try {
        await fetch(`${apiBase}/recharge/cancel/${order.orderId}`, {
          method: "POST",
          headers: authHeaders(),
        });
      } catch {/* best-effort */}
    }
    onClose();
  };

  if (!open) return null;

  return (
    <div className="rs-backdrop" onClick={onClose}>
      <div className="rs-sheet" onClick={(e) => e.stopPropagation()}>
        <div className="rs-handle" />
        <button className="rs-close" onClick={onClose} aria-label="close">×</button>

        {step === "picker" && (
          <div className="rs-picker">
            <h3 className="rs-title">{t("recharge.title")}</h3>
            <p className="rs-sub">{t("recharge.sub")}</p>

            {/* Pay-method selector — fiat (UPI/cards via mock provider) vs
                crypto (USDT-TRC20 on TRON). The chosen method changes how
                Continue routes; amount stays the same in INR. */}
            <div className="rs-method-tabs">
              {/* INR tab only shown when admin has enabled the channel.
                  Until a real payment provider is wired in, the route
                  returns 403 and we'd just frustrate users. */}
              {inrEnabled !== false && (
                <button
                  type="button"
                  className={`rs-method ${method === "fiat" ? "active" : ""}`}
                  onClick={() => setMethod("fiat")}
                  disabled={inrEnabled === null}
                >
                  <span className="rs-method-name">{t("recharge.method.fiat")}</span>
                  <span className="rs-method-sub">{t("recharge.method.fiat.sub")}</span>
                </button>
              )}
              <button
                type="button"
                className={`rs-method ${method === "crypto" ? "active" : ""}`}
                onClick={() => setMethod("crypto")}
              >
                <span className="rs-method-name">{t("recharge.method.crypto")}</span>
                <span className="rs-method-sub">{t("recharge.method.crypto.sub")}</span>
              </button>
            </div>
            {inrEnabled === false && (
              <p className="rs-fine" style={{ marginTop: -4, opacity: 0.7 }}>
                {t("recharge.inrUnavailable")}
              </p>
            )}

            <div className="rs-presets">
              {PRESETS.map((p) => (
                <button
                  key={p}
                  className={`rs-chip ${amount === p ? "active" : ""}`}
                  onClick={() => setAmount(p)}
                >
                  ₹{p.toLocaleString("en-IN")}
                </button>
              ))}
            </div>
            <button className="rs-cta" onClick={handleConfirm}>
              {t("recharge.continue")} · ₹{amount.toLocaleString("en-IN")}{method === "crypto" ? " · USDT" : ""}
            </button>
            {error && <div className="rs-error">{error}</div>}
            <p className="rs-fine">
              {method === "crypto" ? t("recharge.fine.crypto") : t("recharge.fine.fiat")}
            </p>
          </div>
        )}

        {step === "crypto" && (
          <CryptoPayPanel
            amountInr={amount}
            onDone={onClose}
            onRetry={() => setStep("picker")}
          />
        )}

        {step === "creating" && (
          <div className="rs-loader">
            <div className="rs-spinner" />
            <p>{t("recharge.creating")}</p>
          </div>
        )}

        {step === "pending" && order && (
          <div className="rs-pending">
            <h3 className="rs-title">{t("recharge.pendingTitle")}</h3>
            <div className="rs-amount-big">₹{order.amount.toLocaleString("en-IN")}</div>
            <a
              href={order.paymentUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="rs-cta"
            >
              {t("recharge.openPaymentPage")}
            </a>
            <p className="rs-hint">{t("recharge.pendingHint")}</p>
            <ExpiryCountdown
              expiresAt={order.expiresAt}
              onExpire={() => setStep("failed")}
              labelExpiresIn={t("recharge.expiresIn")}
            />
            <button className="rs-link" onClick={handleCancel}>
              {t("recharge.cancelOrder")}
            </button>
          </div>
        )}

        {step === "success" && order && (
          <div className="rs-success">
            <div className="rs-check">✓</div>
            <h3 className="rs-title">{t("recharge.successTitle")}</h3>
            <p className="rs-sub">+₹{order.amount.toLocaleString("en-IN")} {t("recharge.successSub")}</p>
            <button className="rs-cta" onClick={onClose}>{t("common.done")}</button>
          </div>
        )}

        {step === "failed" && (
          <div className="rs-failed">
            <div className="rs-x">×</div>
            <h3 className="rs-title">{t("recharge.failedTitle")}</h3>
            <p className="rs-sub">
              {order?.status === "expired" ? t("recharge.failed.expired") :
               order?.status === "cancelled" ? t("recharge.failed.cancelled") :
               t("recharge.failed.provider")}
            </p>
            <button className="rs-cta" onClick={() => { setStep("picker"); setOrder(null); }}>
              {t("common.tryAgain")}
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

const ExpiryCountdown: React.FC<{ expiresAt: string; onExpire: () => void; labelExpiresIn: string }> = ({
  expiresAt,
  onExpire,
  labelExpiresIn,
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
    <div className="rs-countdown">
      {labelExpiresIn} <span>{m}:{s.toString().padStart(2, "0")}</span>
    </div>
  );
};

export default RechargeSheet;
