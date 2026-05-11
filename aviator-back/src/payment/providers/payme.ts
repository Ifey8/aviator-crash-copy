import {
  PaymentProvider,
  CreateOrderInput,
  CreateOrderResult,
  WebhookVerifyResult,
} from "../types";
import { tryGetSetting } from "../../settings";
import { paymeSignedBody, paymeVerifyWebhook } from "./paymeSign";

/**
 * PaymeProvider — Indian payment gateway adapter.
 *
 * Doc: https://tasteful-freeze-313.notion.site/Payme-API-Doc-...
 *
 * Lifecycle:
 *   createOrder() POSTs /api/payin → returns pay_url for the user.
 *   The user pays, Payme POSTs /webhook (configured via notify_url) with
 *   `{ sign, transdata: {...} }`. verifyWebhook() validates the MD5 sig
 *   and maps transdata.order_status → "paid" | "failed".
 *
 * Config (admin Settings → Payme group):
 *   • paymeApiBase        — base URL (e.g. https://api.cowpay.io)
 *   • paymeMerchantCode   — merchant_code
 *   • paymeSecretKey      — MD5 sign key
 *   • paymePayinPayType   — india-native / india-upi / india-qr / india-pwallet
 *
 * Country is hard-coded "IN" — this provider is only registered for India.
 */
export class PaymeProvider implements PaymentProvider {
  readonly name = "payme";
  readonly isProduction = true;

  async createOrder(input: CreateOrderInput): Promise<CreateOrderResult> {
    const apiBase = String(tryGetSetting("paymeApiBase", "")).trim().replace(/\/$/, "");
    const merchantCode = String(tryGetSetting("paymeMerchantCode", "")).trim();
    const secretKey = String(tryGetSetting("paymeSecretKey", "")).trim();
    const payType = String(tryGetSetting("paymePayinPayType", "india-native")).trim();

    if (!apiBase || !merchantCode || !secretKey) {
      throw new Error("Payme not fully configured — set apiBase / merchantCode / secretKey in admin Settings");
    }

    const fields = {
      merchant_code: merchantCode,
      country_code: "IN",
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
    // Payme uses status:true + code:"0" (string!) for success. Some integrations
    // return numeric 0 — accept either.
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
    const secretKey = String(tryGetSetting("paymeSecretKey", "")).trim();
    if (!secretKey) {
      return { ok: false, providerRef: "", status: "failed", failedReason: "Payme not configured" };
    }
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
    // Payme states: paying | success | failed
    let status: "paid" | "failed";
    if (orderStatus === "success") status = "paid";
    else if (orderStatus === "failed") status = "failed";
    else {
      // "paying" — webhook fired prematurely; treat as not-yet-final and
      // tell the caller we don't have a definitive outcome.
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
}
