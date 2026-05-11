import {
  PayoutProvider,
  PayoutCreateInput,
  PayoutCreateResult,
  PayoutWebhookResult,
} from "../payoutTypes";
import { tryGetSetting } from "../../settings";
import { paymeSignedBody, paymeVerifyWebhook } from "./paymeSign";

/**
 * PaymePayoutProvider — Indian bank/UPI payout via Payme /api/payout.
 *
 * Aviator's WithdrawalSheet collects bankAccount + IFSC + holderName, which
 * maps cleanly to Payme's india-bank flow:
 *   bank_code     = "india-bank"
 *   bank_card_no  = bankAccount
 *   ifsc          = ifsc
 *   bene_name     = holderName
 *
 * For UPI (bank_code="india-upi"), bank_card_no holds the UPI ID instead.
 * The current sheet doesn't ask for UPI separately — operator switches the
 * default via paymePayoutBankCode setting. Future work: add a UPI tab.
 *
 * Payme initial response is { code: 0, status: true, ... } meaning order
 * accepted. The actual money movement is confirmed via webhook with
 * order_status = "success" / "failed".
 *
 * Pay type for India payout is fixed "indiaCommon" per the doc.
 */
export class PaymePayoutProvider implements PayoutProvider {
  readonly name = "payme";

  async createPayout(input: PayoutCreateInput): Promise<PayoutCreateResult> {
    const apiBase = String(tryGetSetting("paymeApiBase", "")).trim().replace(/\/$/, "");
    const merchantCode = String(tryGetSetting("paymeMerchantCode", "")).trim();
    const secretKey = String(tryGetSetting("paymeSecretKey", "")).trim();
    const bankCode = String(tryGetSetting("paymePayoutBankCode", "india-bank")).trim();

    if (!apiBase || !merchantCode || !secretKey) {
      throw new Error("Payme not fully configured — set apiBase / merchantCode / secretKey in admin Settings");
    }
    if (input.method !== "bank") {
      // USDT goes through the on-chain hot wallet path, not Payme.
      throw new Error("Payme provider only handles bank payouts; usdt withdrawals use the on-chain path");
    }
    if (!input.bankAccount || !input.holderName) {
      throw new Error("Payme bank payout requires bankAccount + holderName");
    }
    // ifsc is required ONLY for india-bank, not for india-upi
    if (bankCode === "india-bank" && !input.ifsc) {
      throw new Error("Payme india-bank payout requires ifsc");
    }

    const fields: Record<string, unknown> = {
      merchant_code: merchantCode,
      country_code: "IN",
      order_no: input.orderId,
      order_amount: input.grossAmount.toFixed(2),
      pay_type: "indiaCommon",
      bank_code: bankCode,
      bank_card_no: input.bankAccount.trim(),
      bene_name: input.holderName.trim(),
      notify_url: payoutNotifyUrl(input.orderId),
    };
    if (input.ifsc) fields.ifsc = input.ifsc.trim().toUpperCase();
    const body = paymeSignedBody(fields, secretKey);

    const res = await fetch(`${apiBase}/api/payout`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`Payme /api/payout HTTP ${res.status}: ${text.slice(0, 200)}`);
    }
    const json = (await res.json()) as Record<string, unknown>;
    const ok = json.status === true && (json.code === "0" || json.code === 0);
    if (!ok) {
      throw new Error(`Payme /api/payout error: ${String(json.message || json.code || "unknown")}`);
    }
    const platOrderNo = String(json.plat_order_no || "");
    if (!platOrderNo) {
      throw new Error("Payme /api/payout missing plat_order_no");
    }
    // Doc state machine: order goes "payouting" first; webhook fires when
    // it settles. So initial status is processing, not paid.
    return {
      providerRef: platOrderNo,
      status: "processing",
      message: "Payout accepted by Payme; awaiting settlement webhook.",
    };
  }

  verifyWebhook(
    _headers: Record<string, unknown>,
    rawBody: string,
  ): PayoutWebhookResult {
    const secretKey = String(tryGetSetting("paymeSecretKey", "")).trim();
    if (!secretKey) return { ok: false, providerRef: "", failedReason: "Payme not configured" };
    let envelope: { sign?: string; transdata?: Record<string, unknown> } | null = null;
    try {
      envelope = JSON.parse(rawBody);
    } catch {
      return { ok: false, providerRef: "", failedReason: "Bad JSON" };
    }
    if (!paymeVerifyWebhook(envelope, secretKey)) {
      return { ok: false, providerRef: "", failedReason: "Bad signature" };
    }
    const td = envelope!.transdata!;
    const providerRef = String(td.plat_order_no || "");
    const orderStatus = String(td.order_status || "");
    if (orderStatus === "success") return { ok: true, providerRef, status: "paid", raw: td };
    if (orderStatus === "failed") {
      return {
        ok: true,
        providerRef,
        status: "failed",
        failedReason: String(td.message || "Provider reported failure"),
        raw: td,
      };
    }
    // "payouting" — still in progress, no terminal status.
    return { ok: false, providerRef, failedReason: `Non-final status: ${orderStatus}`, raw: td };
  }
}

/** Where Payme should POST the payout webhook callback. */
const payoutNotifyUrl = (orderId: string): string => {
  // Build from FRONTEND_URL by swapping port if local, otherwise the api
  // host. Matches the convention used in routes/withdrawal.ts.
  const base = (process.env.FRONTEND_URL || "")
    .replace(/:18803.*/, ":18805")
    .replace(/\/$/, "");
  return `${base}/api/withdrawal/webhook/payme?orderId=${encodeURIComponent(orderId)}`;
};
