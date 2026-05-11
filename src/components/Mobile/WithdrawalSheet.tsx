import React from "react";
import Context from "../../context";
import { config } from "../../config";
import { useT } from "../../i18n";

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
  bankEnabled?: boolean;
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
  const { t } = useT();
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
        if (j.status) {
          setQuote(j.data);
          // Snap selected tab to whichever channel is available so the user
          // doesn't see an empty form for a disabled method.
          if (j.data?.bankEnabled === false) setTab("usdt");
        } else setError(j.message);
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
      // pending / processing / manual_queue / review → stay in "pending" step,
      // status display updates automatically from setOrder above.
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
      setOrder({ ...order, status: "cancelled", failedReason: t("withdrawal.cancelled.by.you") });
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
        <h3>{t("withdrawal.title")}</h3>

        {step === "form" && (
          <>
            <div className="wd-balance-card">
              <div className="wd-balance-row">
                <span>{t("account.balance.total")}</span>
                <strong>₹{fmt(balance)}</strong>
              </div>
              <div className="wd-balance-row">
                <span>{t("account.balance.locked")}</span>
                <strong className="wd-locked">₹{fmt(wager)}</strong>
              </div>
              <div className="wd-balance-row wd-balance-withdrawable">
                <span>{t("account.balance.withdrawable")}</span>
                <strong>₹{fmt(withdrawable)}</strong>
              </div>
              {wager > 0 && (
                <div className="wd-hint">
                  {t("withdrawal.wagerHint")}
                </div>
              )}
            </div>

            <div className="wd-tabs">
              {/* Bank tab only when admin has the INR channel on. While off,
                  the route returns 403 — hiding the tab saves users the
                  detour of filling the form. */}
              {quote?.bankEnabled !== false && (
                <button
                  className={`wd-tab ${tab === "bank" ? "active" : ""}`}
                  onClick={() => setTab("bank")}
                >
                  {t("withdrawal.tab.bank")}
                </button>
              )}
              <button
                className={`wd-tab ${tab === "usdt" ? "active" : ""}`}
                onClick={() => setTab("usdt")}
              >
                {t("withdrawal.tab.usdt")}
              </button>
            </div>
            {quote?.bankEnabled === false && (
              <p className="wd-hint" style={{ marginTop: 0, opacity: 0.75 }}>
                {t("withdrawal.bankUnavailable")}
              </p>
            )}

            {tab === "bank" ? (
              <div className="wd-form">
                <label>
                  <span>{t("withdrawal.form.bankAccount")}</span>
                  <input
                    type="text"
                    inputMode="numeric"
                    placeholder={t("withdrawal.form.bankAccount.ph")}
                    value={bankAcct}
                    onChange={(e) => setBankAcct(e.target.value.replace(/\D/g, ""))}
                  />
                </label>
                <label>
                  <span>{t("withdrawal.form.ifsc")}</span>
                  <input
                    type="text"
                    placeholder={t("withdrawal.form.ifsc.ph")}
                    value={ifsc}
                    onChange={(e) => setIfsc(e.target.value.toUpperCase())}
                    maxLength={11}
                  />
                </label>
                <label>
                  <span>{t("withdrawal.form.holder")}</span>
                  <input
                    type="text"
                    placeholder={t("withdrawal.form.holder.ph")}
                    value={holder}
                    onChange={(e) => setHolder(e.target.value)}
                  />
                </label>
                <label>
                  <span>{t("withdrawal.form.amountInr")} — {t("withdrawal.cta.min")} ₹{minInr}</span>
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
                  <span>{t("withdrawal.form.trc20")}</span>
                  <input
                    type="text"
                    placeholder="T..."
                    value={trc20}
                    onChange={(e) => setTrc20(e.target.value.trim())}
                    maxLength={34}
                  />
                </label>
                <label>
                  <span>{t("withdrawal.form.amountUsdt")} — {t("withdrawal.cta.min")} ₹{minInr} (≈ {(minInr / fxRate).toFixed(2)} USDT)</span>
                  <input
                    type="text"
                    inputMode="decimal"
                    placeholder="10"
                    value={amountUsdt}
                    onChange={(e) => setAmountUsdt(e.target.value.replace(/[^\d.]/g, ""))}
                  />
                </label>
                <div className="wd-rate-note">
                  {t("withdrawal.rateLocked")} 1 USDT ≈ ₹{fxRate.toFixed(2)}
                </div>
              </div>
            )}

            <div className="wd-summary">
              <div className="wd-summary-row">
                <span>{t("withdrawal.summary.youReceive")}</span>
                <strong>
                  {tab === "bank" ? `₹${fmt(grossInr)}` : `${Number(amountUsdt || 0) || 0} USDT`}
                </strong>
              </div>
              <div className="wd-summary-row">
                <span>{t("withdrawal.summary.fee")} ({(feePct * 100).toFixed(1)}%)</span>
                <strong>₹{fmt(feeInr)}</strong>
              </div>
              <div className="wd-summary-row wd-summary-total">
                <span>{t("withdrawal.summary.total")}</span>
                <strong>₹{fmt(totalInr)}</strong>
              </div>
            </div>

            {error && <div className="wd-error">⚠ {error}</div>}

            <div className="wd-actions">
              <button className="wd-cancel" onClick={onClose}>{t("common.close")}</button>
              <button
                className="modal-cta wd-submit"
                onClick={submit}
                disabled={!formValid}
              >
                {totalInr > withdrawable
                  ? t("withdrawal.cta.insufficient")
                  : grossInr < minInr
                    ? `${t("withdrawal.cta.min")} ₹${minInr}`
                    : `${t("withdrawal.cta.withdraw")} ₹${fmt(grossInr)}`}
              </button>
            </div>
          </>
        )}

        {step === "submitting" && (
          <div className="wd-status">{t("withdrawal.submitting")}</div>
        )}

        {step === "pending" && order && (
          <div className="wd-status">
            <div className="wd-status-icon">{order.status === "review" ? "🔍" : "⏳"}</div>
            <h4>
              {order.status === "review"
                ? t("withdrawal.review.title")
                : t("withdrawal.queued.title")}
            </h4>
            <p>
              {order.status === "review" ? (
                <>
                  {order.method === "bank" ? t("withdrawal.method.bank") : t("withdrawal.method.usdt")}
                  {" "}<strong>{order.method === "bank" ? `₹${fmt(order.grossAmount)}` : `${order.grossAmount} USDT`}</strong>
                  {" "}{t("withdrawal.review.body")}
                </>
              ) : (
                <>
                  {order.method === "bank" ? t("withdrawal.method.bank") : t("withdrawal.method.usdt")}
                  {" "}<strong>₹{fmt(order.grossAmount)}</strong>
                  {" "}{t("withdrawal.queued.body")}
                </>
              )}
            </p>
            <p className="wd-status-meta">
              {t("withdrawal.orderMeta")}: {order.orderId.slice(0, 8)}… · {t("withdrawal.status")}: {order.status}
            </p>
            <div className="wd-actions">
              <button className="wd-cancel" onClick={cancelOrder}>{t("withdrawal.cancel")}</button>
              <button className="modal-cta" onClick={onClose}>{t("common.close")}</button>
            </div>
          </div>
        )}

        {step === "success" && order && (
          <div className="wd-status wd-status-success">
            <div className="wd-status-icon">✅</div>
            <h4>{t("withdrawal.successTitle")}</h4>
            <p>₹{fmt(order.grossAmount)} {t("withdrawal.successSub")}</p>
            {order.txHash && (
              <p className="wd-status-meta">TX: {order.txHash.slice(0, 16)}…</p>
            )}
            <button className="modal-cta" onClick={onClose}>{t("common.done")}</button>
          </div>
        )}

        {step === "failed" && order && (
          <div className="wd-status wd-status-failed">
            <div className="wd-status-icon">⚠</div>
            <h4>{t("withdrawal.failedTitle")} {order.status}</h4>
            <p>{order.failedReason || t("withdrawal.failed.default")}</p>
            <button className="modal-cta" onClick={onClose}>{t("common.close")}</button>
          </div>
        )}
      </div>
    </div>
  );
};
