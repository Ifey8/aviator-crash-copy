import crypto from "crypto";
import { PaymentProvider, CreateOrderInput, CreateOrderResult, WebhookVerifyResult } from "../types";
import { config } from "../../config";

/**
 * RazorpayProvider — scaffolding for India's Razorpay payment gateway.
 *
 * STATUS: skeleton — wire up when you have:
 *   • RAZORPAY_KEY_ID         (public, sent to frontend Checkout SDK)
 *   • RAZORPAY_KEY_SECRET     (private, used for HTTP Basic auth + HMAC)
 *   • RAZORPAY_WEBHOOK_SECRET (private, HMAC for webhook signature)
 *
 * Razorpay flow (Standard Checkout):
 *   1. POST https://api.razorpay.com/v1/orders → returns { id, status, ... }
 *      Send: { amount: paise, currency: "INR", receipt: orderId, notes }
 *      Auth: HTTP Basic (key_id : key_secret)
 *   2. Frontend opens Razorpay Checkout JS with that order id; user pays.
 *   3. Razorpay POSTs to webhook URL with X-Razorpay-Signature header.
 *      Verify: HMAC-SHA256(webhook_secret, raw_body) === signature
 *
 * Until creds are configured, createOrder throws — the registry should NOT
 * register this provider unless RAZORPAY_KEY_ID is present.
 */
export class RazorpayProvider implements PaymentProvider {
  readonly name = "razorpay";
  readonly isProduction = true;

  private get keyId(): string { return process.env.RAZORPAY_KEY_ID || ""; }
  private get keySecret(): string { return process.env.RAZORPAY_KEY_SECRET || ""; }
  private get webhookSecret(): string { return process.env.RAZORPAY_WEBHOOK_SECRET || ""; }

  async createOrder(input: CreateOrderInput): Promise<CreateOrderResult> {
    if (!this.keyId || !this.keySecret) {
      throw new Error("Razorpay not configured (set RAZORPAY_KEY_ID / RAZORPAY_KEY_SECRET)");
    }
    const auth = Buffer.from(`${this.keyId}:${this.keySecret}`).toString("base64");
    const res = await fetch("https://api.razorpay.com/v1/orders", {
      method: "POST",
      headers: {
        Authorization: `Basic ${auth}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        amount: Math.round(input.amount * 100), // paise
        currency: input.currency,
        receipt: input.orderId,
        notes: { userName: input.userName, internalOrderId: input.orderId },
      }),
    });
    if (!res.ok) throw new Error(`Razorpay createOrder failed: ${res.status}`);
    const data = await res.json() as { id: string };
    // Frontend will use the Razorpay Checkout SDK directly. Until we wire that
    // up, return a placeholder paymentUrl pointing to a frontend handler.
    const base = config.frontendUrl?.replace(/\/$/, "") || "";
    return {
      paymentUrl: `${base}/pay/razorpay?rzpOrderId=${data.id}&keyId=${this.keyId}`,
      providerRef: data.id,
    };
  }

  verifyWebhook(headers: Record<string, string | string[] | undefined>, rawBody: string): WebhookVerifyResult {
    if (!this.webhookSecret) return { ok: false, providerRef: "", status: "failed" };
    const sig = String(headers["x-razorpay-signature"] || "");
    const expected = crypto.createHmac("sha256", this.webhookSecret).update(rawBody).digest("hex");
    if (sig !== expected) return { ok: false, providerRef: "", status: "failed" };
    try {
      const body = JSON.parse(rawBody);
      const event = body.event as string;
      const order = body.payload?.payment?.entity?.order_id || body.payload?.order?.entity?.id || "";
      if (event === "payment.captured") {
        return { ok: true, providerRef: order, status: "paid", raw: body };
      }
      if (event === "payment.failed") {
        return { ok: true, providerRef: order, status: "failed", failedReason: body.payload?.payment?.entity?.error_description, raw: body };
      }
      return { ok: false, providerRef: order, status: "failed" };
    } catch {
      return { ok: false, providerRef: "", status: "failed" };
    }
  }
}
