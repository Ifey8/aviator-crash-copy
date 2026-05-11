import {
  PaymentProvider,
  CreateOrderInput,
  CreateOrderResult,
  WebhookVerifyResult,
  QueryOrderStatusInput,
  QueryOrderStatusResult,
} from "../types";
import { ChannelConfig } from "../catalog";
import { paymeSignedBody, paymeVerifyWebhook } from "./paymeSign";

/**
 * PaymeProvider — Indian payment gateway adapter (payin).
 *
 * Doc: https://tasteful-freeze-313.notion.site/Payme-API-Doc-...
 *
 * Lifecycle:
 *   createOrder() POSTs /api/payin → returns pay_url for the user.
 *   The user pays, Payme POSTs the webhook URL we provided (notify_url)
 *   with `{ sign, transdata: {...} }`. verifyWebhook() validates the MD5
 *   sig and maps transdata.order_status → "paid" | "failed".
 *
 * Config — from channel.credentials + channel.params:
 *   credentials.apiBase        — base URL (e.g. https://api.cowpay.io)
 *   credentials.merchantCode   — merchant_code
 *   credentials.secretKey      — MD5 sign key
 *   params.payinPayType        — india-native / india-upi / india-qr / india-pwallet
 *   params.country             — "IN" (default) or "ID"
 *
 * Country code defaults to "IN" for backward compat with the previous
 * single-channel impl. Set params.country to "ID" for Indonesia channels.
 */
export class PaymeProvider implements PaymentProvider {
  readonly name: string;
  readonly isProduction = true;

  constructor(private readonly cfg: ChannelConfig) {
    this.name = `payme:${cfg.channelCode}`;
  }

  private getCreds() {
    const c = this.cfg.credentials || {};
    const apiBase = String(c.apiBase || "").trim().replace(/\/$/, "");
    const merchantCode = String(c.merchantCode || "").trim();
    const secretKey = String(c.secretKey || "").trim();
    if (!apiBase || !merchantCode || !secretKey) {
      throw new Error(
        `Payme channel ${this.cfg.channelCode} missing credentials (apiBase / merchantCode / secretKey)`,
      );
    }
    return { apiBase, merchantCode, secretKey };
  }

  async createOrder(input: CreateOrderInput): Promise<CreateOrderResult> {
    const { apiBase, merchantCode, secretKey } = this.getCreds();
    const payType = String(this.cfg.params?.payinPayType || "india-native").trim();
    const country = String(this.cfg.params?.country || "IN").trim().toUpperCase();

    const fields = {
      merchant_code: merchantCode,
      country_code: country,
      order_no: input.orderId,
      // Payme expects 2-decimal string per the doc example ("100.00")
      order_amount: input.amount.toFixed(2),
      pay_type: payType,
      notify_url: input.webhookUrl,
      return_url: input.returnUrl,
    };
    const body = paymeSignedBody(fields, secretKey);

    const url = `${apiBase}/api/payin`;
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`Payme /api/payin HTTP ${res.status}: ${text.slice(0, 200)}`);
    }
    const json = (await res.json()) as Record<string, unknown>;
    const ok = json.status === true && (json.code === "0" || json.code === 0);
    if (!ok) {
      throw new Error(`Payme /api/payin error: ${String(json.message || json.code || "unknown")}`);
    }
    const payUrl = String(json.pay_url || "");
    const platOrderNo = String(json.plat_order_no || "");
    if (!payUrl || !platOrderNo) {
      throw new Error("Payme /api/payin missing pay_url or plat_order_no");
    }
    return {
      paymentUrl: payUrl,
      providerRef: platOrderNo,
    };
  }

  verifyWebhook(
    _headers: Record<string, string | string[] | undefined>,
    rawBody: string,
  ): WebhookVerifyResult {
    const { secretKey } = this.getCreds();
    let envelope: { sign?: string; transdata?: Record<string, unknown> } | null = null;
    try {
      envelope = JSON.parse(rawBody);
    } catch {
      return { ok: false, providerRef: "", status: "failed", failedReason: "Bad JSON" };
    }
    if (!paymeVerifyWebhook(envelope, secretKey)) {
      return { ok: false, providerRef: "", status: "failed", failedReason: "Bad signature" };
    }
    const td = envelope!.transdata!;
    const providerRef = String(td.plat_order_no || "");
    const orderStatus = String(td.order_status || "");
    let status: "paid" | "failed";
    if (orderStatus === "success") status = "paid";
    else if (orderStatus === "failed") status = "failed";
    else {
      return { ok: false, providerRef, status: "failed", failedReason: `Non-final status: ${orderStatus}`, raw: td };
    }
    return {
      ok: true,
      providerRef,
      status,
      raw: td,
      failedReason: status === "failed" ? String(td.message || "Provider reported failure") : undefined,
    };
  }

  /**
   * Backstop poll. POSTs /api/payinOrderQuery with the merchant order_no.
   * Returns "pending" / "paid" / "failed" / "unknown". The orderWatcher
   * uses this when a webhook hasn't arrived within the polling interval.
   */
  async queryOrderStatus(input: QueryOrderStatusInput): Promise<QueryOrderStatusResult> {
    let creds;
    try {
      creds = this.getCreds();
    } catch (e) {
      return { status: "unknown", failedReason: (e as Error).message };
    }
    const country = String(this.cfg.params?.country || "IN").trim().toUpperCase();
    const body = paymeSignedBody({
      merchant_code: creds.merchantCode,
      country_code: country,
      order_no: input.orderId,
    }, creds.secretKey);
    let json: Record<string, unknown>;
    try {
      const res = await fetch(`${creds.apiBase}/api/payinOrderQuery`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(10_000),
      });
      json = (await res.json()) as Record<string, unknown>;
    } catch (e) {
      return { status: "unknown", failedReason: `Network: ${(e as Error).message}` };
    }
    const ok = json.status === true && (json.code === "0" || json.code === 0);
    if (!ok) {
      // Provider says order doesn't exist → treat as unknown (we'll retry)
      return { status: "unknown", failedReason: String(json.message || json.code || "query failed"), raw: json };
    }
    const orderStatus = String(json.order_status || "");
    const providerRef = String(json.plat_order_no || "") || undefined;
    if (orderStatus === "success") return { status: "paid", providerRef, raw: json };
    if (orderStatus === "failed") return { status: "failed", providerRef, raw: json, failedReason: String(json.message || "Failed") };
    if (orderStatus === "paying") return { status: "pending", providerRef, raw: json };
    return { status: "unknown", providerRef, raw: json };
  }
}

