import React from "react";
import Context from "../../context";
import { config } from "../../config";

/**
 * WithdrawalSheet — bottom sheet for cashing out balance via:
 *   • Bank   (Indian bank transfer: account + IFSC + holder name)
 *   • USDT   (TRC20 address, paid from server hot wallet)
 *
 * Server-side rules surfaced in the UI:
 *   1. Withdrawable = balance − wagerRequired (recharge playthrough lock).
 *   2. Min withdrawal = settings.withdrawalMinInr (₹300 default).
 *   3. Fee on top: gross + (gross × feePct) is debited from balance.
 *   4. One pending order per user at a time.
 *
 * Real-time updates via socket "withdrawalUpdate" event mirror the
 * RechargeSheet pattern — admin force-paid / force-failed lands here.
 */

type Tab = "bank" | "usdt";
type Step = "form" | "submitting" | "pending" | "success" | "failed";

interface QuoteData {
  balance: number;
  wagerRequired: number;
  withdrawable: number;
  feePct: number;
  minInr: number;
  maxGrossInr: number;
  usdtInrRate: number | null;
}

interface OrderData {
  orderId: string;
  method: "bank" | "usdt";
  status: string;
  grossAmount: number;
  feeAmount: number;
  totalDebitInr: number;
  failedReason?: string;
  txHash?: string;
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

const fmt = (n: number) =>
  n.toLocaleString("en-IN", { maximumFractionDigits: 2, minimumFractionDigits: 2 });

export const WithdrawalSheet: React.FC<Props> = ({ open, onClose }) => {
  const ctx = React.useContext(Context);
  const sock = (ctx as any).socket;

  const [tab, setTab] = React.useState<Tab>("bank");
  const [step, setStep] = React.useState<Step>("form");
  const [quote, setQuote] = React.useState<QuoteData | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [order, setOrder] = React.useState<OrderData | null>(null);

  // Bank form
  const [bankAcct, setBankAcct] = React.useState("");
  const [ifsc, setIfsc] = React.useState("");
  const [holder, setHolder] = React.useState("");
  const [amountInr, setAmountInr] = React.useState<string>("");

  // USDT form
  const [trc20, setTrc20] = React.useState("");
  const [amountUsdt, setAmountUsdt] = React.useState<string>("");

  // Refresh quote whenever sheet opens or balance/wager moves.
  React.useEffect(() => {
    if (!open) return;
    let cancelled = false;
    const load = async () => {
      try {
        const r = await fetch(`${apiBase}/withdrawal/quote`, { headers: authHeaders() });
        const j = await r.json();
        if (cancelled) return;
        if (j.status) setQuote(j.data);
        else setError(j.message);
      } catch (e) {
        if (!cancelled) setError((e as Error).message);
      }
    };
    load();
    return () => { cancelled = true; };
  }, [open, ctx.userInfo?.balance, (ctx.userInfo as any)?.wagerRequired]);

  // Reset on close
  React.useEffect(() => {
    if (!open) {
      setStep("form");
      setOrder(null);
      setError(null);
    }
  }, [open]);

  // Socket push — reflects admin mark-paid / mark-failed in real time
  React.useEffect(() => {
    if (!sock || !order) return;
    const onUpdate = (msg: { orderId: string; status: string; failedReason?: string; txHash?: string }) => {
      if (msg.orderId !== order.orderId) return;
      setOrder((o) => (o ? { ...o, ...msg } : o));
      if (msg.status === "paid") setStep("success");
      else if (msg.status === "failed" || msg.status === "cancelled") setStep("failed");
    };
    sock.on("withdrawalUpdate", onUpdate);
    return () => { sock.off("withdrawalUpdate", onUpdate); };
  }, [sock, order]);

  if (!open) return null;

  const submit = async () => {
    setError(null);
    setStep("submitting");
    try {
      const body: any = { method: tab };
      if (tab === "bank") {
        body.amount = Number(amountInr);
        body.bankAccount = bankAcct.trim();
        body.ifsc = ifsc.trim().toUpperCase();
        body.holderName = holder.trim();
      } else {
        body.amount = Number(amountUsdt);
        body.trc20Address = trc20.trim();
      }
      const res = await fetch(`${apiBase}/withdrawal/create`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify(body),
      });
      const j = await res.json();
      if (!res.ok || !j.status) {
        setError(j.message || "Failed");
        setStep("form");
        return;
      }
      setOrder(j.data);
      setStep("pending");
    } catch (e) {
      setError((e as Error).message);
      setStep("form");
    }
  };

  const cancelOrder = async () => {
    if (!order) return;
    try {
      await fetch(`${apiBase}/withdrawal/cancel/${order.orderId}`, {
        method: "POST",
        headers: authHeaders(),
      });
      setStep("failed");
      setOrder({ ...order, status: "cancelled", failedReason: "Cancelled by you" });
    } catch (e) { /* ignore */ }
  };

  // ----- Derived values -----
  const feePct = quote?.feePct ?? 0.05;
  const fxRate = quote?.usdtInrRate ?? 83;

  const grossInr = tab === "bank"
    ? +Number(amountInr || 0).toFixed(2)
    : +(Number(amountUsdt || 0) * fxRate).toFixed(2);
  const feeInr = +(grossInr * feePct).toFixed(2);
  const totalInr = +(grossInr + feeInr).toFixed(2);

  const balance = quote?.balance ?? 0;
  const withdrawable = quote?.withdrawable ?? 0;
  const wager = quote?.wagerRequired ?? 0;
  const minInr = quote?.minInr ?? 300;

  const ifscValid = /^[A-Z]{4}0[A-Z0-9]{6}$/.test(ifsc.trim().toUpperCase());
  const acctValid = /^\d{9,18}$/.test(bankAcct.replace(/\s/g, ""));
  const holderValid = /^[A-Za-z .'-]{2,60}$/.test(holder.trim());
  const trc20Valid = /^T[1-9A-HJ-NP-Za-km-z]{33}$/.test(trc20.trim());

  const formValid =
    tab === "bank"
      ? acctValid && ifscValid && holderValid && grossInr >= minInr && totalInr <= withdrawable
      : trc20Valid && grossInr >= minInr && totalInr <= withdrawable && Number(amountUsdt) > 0;

  return (
    <div className="mobile-modal-overlay" onClick={onClose}>
      <div className="mobile-modal withdrawal-sheet" onClick={(e) => e.stopPropagation()}>
        <h3>Withdraw funds</h3>

        {step === "form" && (
          <>
            <div className="wd-balance-card">
              <div className="wd-balance-row">
                <span>Total balance</span>
                <strong>₹{fmt(balance)}</strong>
              </div>
              <div className="wd-balance-row">
                <span>Locked (playthrough)</span>
                <strong className="wd-locked">₹{fmt(wager)}</strong>
              </div>
              <div className="wd-balance-row wd-balance-withdrawable">
                <span>Withdrawable</span>
                <strong>₹{fmt(withdrawable)}</strong>
              </div>
              {wager > 0 && (
                <div className="wd-hint">
                  Recharges must be wagered through before they can be withdrawn.
                  Place ₹{fmt(wager)} more in bets to unlock the rest.
                </div>
              )}
            </div>

            <div className="wd-tabs">
              <button
                className={`wd-tab ${tab === "bank" ? "active" : ""}`}
                onClick={() => setTab("bank")}
              >
                Bank (INR)
              </button>
              <button
                className={`wd-tab ${tab === "usdt" ? "active" : ""}`}
                onClick={() => setTab("usdt")}
              >
                USDT (TRC20)
              </button>
            </div>

            {tab === "bank" ? (
              <div className="wd-form">
                <label>
                  <span>Account number</span>
                  <input
                    type="text"
                    inputMode="numeric"
                    placeholder="9-18 digits"
                    value={bankAcct}
                    onChange={(e) => setBankAcct(e.target.value.replace(/\D/g, ""))}
                  />
                </label>
                <label>
                  <span>IFSC code</span>
                  <input
                    type="text"
                    placeholder="e.g. SBIN0001234"
                    value={ifsc}
                    onChange={(e) => setIfsc(e.target.value.toUpperCase())}
                    maxLength={11}
                  />
                </label>
                <label>
                  <span>Holder name (as on bank record)</span>
                  <input
                    type="text"
                    placeholder="Full name"
                    value={holder}
                    onChange={(e) => setHolder(e.target.value)}
                  />
                </label>
                <label>
                  <span>Amount (INR) — min ₹{minInr}</span>
                  <input
                    type="text"
                    inputMode="decimal"
                    placeholder="500"
                    value={amountInr}
                    onChange={(e) => setAmountInr(e.target.value.replace(/[^\d.]/g, ""))}
                  />
                </label>
              </div>
            ) : (
              <div className="wd-form">
                <label>
                  <span>TRC20 USDT address</span>
                  <input
                    type="text"
                    placeholder="T..."
                    value={trc20}
                    onChange={(e) => setTrc20(e.target.value.trim())}
                    maxLength={34}
                  />
                </label>
                <label>
                  <span>Amount (USDT) — min ₹{minInr} (≈ {(minInr / fxRate).toFixed(2)} USDT)</span>
                  <input
                    type="text"
                    inputMode="decimal"
                    placeholder="10"
                    value={amountUsdt}
                    onChange={(e) => setAmountUsdt(e.target.value.replace(/[^\d.]/g, ""))}
                  />
                </label>
                <div className="wd-rate-note">
                  Rate locked at submit: 1 USDT ≈ ₹{fxRate.toFixed(2)}
                </div>
              </div>
            )}

            <div className="wd-summary">
              <div className="wd-summary-row">
                <span>You receive</span>
                <strong>
                  {tab === "bank" ? `₹${fmt(grossInr)}` : `${Number(amountUsdt || 0) || 0} USDT`}
                </strong>
              </div>
              <div className="wd-summary-row">
                <span>Fee ({(feePct * 100).toFixed(1)}%)</span>
                <strong>₹{fmt(feeInr)}</strong>
              </div>
              <div className="wd-summary-row wd-summary-total">
                <span>Total deducted from balance</span>
                <strong>₹{fmt(totalInr)}</strong>
              </div>
            </div>

            {error && <div className="wd-error">⚠ {error}</div>}

            <div className="wd-actions">
              <button className="wd-cancel" onClick={onClose}>Close</button>
              <button
                className="modal-cta wd-submit"
                onClick={submit}
                disabled={!formValid}
              >
                {totalInr > withdrawable
                  ? "Insufficient withdrawable"
                  : grossInr < minInr
                    ? `Min ₹${minInr}`
                    : `Withdraw ₹${fmt(grossInr)}`}
              </button>
            </div>
          </>
        )}

        {step === "submitting" && (
          <div className="wd-status">Submitting…</div>
        )}

        {step === "pending" && order && (
          <div className="wd-status">
            <div className="wd-status-icon">⏳</div>
            <h4>Withdrawal queued</h4>
            <p>
              Your {order.method === "bank" ? "bank transfer" : "USDT withdrawal"} of
              {" "}<strong>₹{fmt(order.grossAmount)}</strong>
              {" "}is being processed.
            </p>
            <p className="wd-status-meta">
              Order: {order.orderId.slice(0, 8)}… · Status: {order.status}
            </p>
            <div className="wd-actions">
              <button className="wd-cancel" onClick={cancelOrder}>Cancel withdrawal</button>
              <button className="modal-cta" onClick={onClose}>Close</button>
            </div>
          </div>
        )}

        {step === "success" && order && (
          <div className="wd-status wd-status-success">
            <div className="wd-status-icon">✅</div>
            <h4>Withdrawal complete</h4>
            <p>₹{fmt(order.grossAmount)} sent successfully.</p>
            {order.txHash && (
              <p className="wd-status-meta">TX: {order.txHash.slice(0, 16)}…</p>
            )}
            <button className="modal-cta" onClick={onClose}>Done</button>
          </div>
        )}

        {step === "failed" && order && (
          <div className="wd-status wd-status-failed">
            <div className="wd-status-icon">⚠</div>
            <h4>Withdrawal {order.status}</h4>
            <p>{order.failedReason || "The provider rejected this withdrawal. Your balance has been refunded."}</p>
            <button className="modal-cta" onClick={onClose}>Close</button>
          </div>
        )}
      </div>
    </div>
  );
};
