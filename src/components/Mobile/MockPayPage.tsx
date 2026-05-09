import React from "react";
import { config } from "../../config";

/**
 * MockPayPage — fake "bank/UPI" page for the mock payment provider in dev.
 *
 * Reached via `paymentUrl: ${frontendUrl}/mock-pay?orderId=...&amount=...`.
 * Shows a green PAY button that hits the dev-only endpoint
 * `POST /api/recharge/mock-pay/:orderId` and then closes the tab (so the
 * main app's polling/socket picks up the paid status).
 *
 * NOT FOR PRODUCTION — the route only renders if the URL has `?orderId=`,
 * and the backend mock-pay endpoint is gated by ALLOW_DEV_AUTH.
 */
const apiBase = config.api;

export const MockPayPage: React.FC = () => {
  const params = new URLSearchParams(window.location.search);
  const orderId = params.get("orderId") || "";
  const amount = Number(params.get("amount") || 0);

  const [paying, setPaying] = React.useState(false);
  const [done, setDone] = React.useState<"paid" | "error" | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  const handlePay = async (): Promise<void> => {
    setPaying(true);
    setError(null);
    try {
      const res = await fetch(`${apiBase}/recharge/mock-pay/${orderId}`, {
        method: "POST",
      });
      const json = await res.json();
      if (json.status) {
        setDone("paid");
        // Close the tab after a short pause so the user sees success.
        setTimeout(() => {
          if (window.opener) window.close();
        }, 1200);
      } else {
        setDone("error");
        setError(json.message || "Payment failed");
      }
    } catch {
      setDone("error");
      setError("Network error");
    } finally {
      setPaying(false);
    }
  };

  if (!orderId) {
    return (
      <div className="mock-pay">
        <div className="mock-pay-card">
          <h2>Invalid link</h2>
          <p>No orderId provided.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="mock-pay">
      <div className="mock-pay-card">
        <div className="mock-pay-bank">DEV · MOCK PAYMENT</div>
        <h2>Confirm payment</h2>
        <div className="mock-pay-amount">₹{amount.toLocaleString("en-IN")}</div>
        <div className="mock-pay-meta">
          <div><span>Order ID</span><b>{orderId.slice(0, 8)}…</b></div>
          <div><span>Method</span><b>UPI / NetBanking (sim.)</b></div>
        </div>
        {done === "paid" && (
          <div className="mock-pay-success">
            <div className="mock-pay-check">✓</div>
            <p>Payment successful</p>
            <p className="mock-pay-fine">You can close this tab.</p>
          </div>
        )}
        {done !== "paid" && (
          <button
            className="mock-pay-btn"
            disabled={paying}
            onClick={handlePay}
          >
            {paying ? "Processing…" : `Pay ₹${amount.toLocaleString("en-IN")}`}
          </button>
        )}
        {error && <div className="mock-pay-error">{error}</div>}
        <p className="mock-pay-fine">
          This is a simulated payment screen. In production this URL points to
          the real provider (Razorpay, etc).
        </p>
      </div>
    </div>
  );
};

export default MockPayPage;
