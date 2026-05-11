import {
  PayoutProvider,
  PayoutCreateInput,
  PayoutCreateResult,
  PayoutWebhookResult,
  PayoutQueryInput,
  PayoutQueryResult,
} from "../payoutTypes";
import { ChannelConfig } from "../catalog";
import { paymeSignedBody, paymeVerifyWebhook } from "./paymeSign";

/**
 * PaymePayoutProvider — Indian bank/UPI payout via Payme /api/payout.
 *
 * Aviator's WithdrawalSheet collects bankAccount + IFSC + holderName, which
 * maps to Payme's india-bank flow:
 *   bank_code     = "india-bank"
 *   bank_card_no  = bankAccount
 *   ifsc          = ifsc
 *   bene_name     = holderName
 *
 * For UPI (bank_code="india-upi"), bank_card_no holds the UPI ID instead.
 * Operator chooses via channel.params.payoutBankCode.
 *
 * Config from channel:
 *   credentials.apiBase        — base URL
 *   credentials.merchantCode   — merchant_code
 *   credentials.secretKey      — MD5 sign key
 *   params.payoutBankCode      — india-bank | india-upi (default india-bank)
 *   params.country             — IN | ID (default IN)
 */
export class PaymePayoutProvider implements PayoutProvider {
  readonly name: string;

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

  async createPayout(input: PayoutCreateInput): Promise<PayoutCreateResult> {
    const { apiBase, merchantCode, secretKey } = this.getCreds();
    const bankCode = String(this.cfg.params?.payoutBankCode || "india-bank").trim();
    const country = String(this.cfg.params?.country || "IN").trim().toUpperCase();

    if (input.method !== "bank") {
      throw new Error("Payme provider only handles bank payouts; usdt withdrawals use the on-chain path");
    }
    if (!input.bankAccount || !input.holderName) {
      throw new Error("Payme bank payout requires bankAccount + holderName");
    }
    if (bankCode === "india-bank" && !input.ifsc) {
      throw new Error("Payme india-bank payout requires ifsc");
    }

    const fields: Record<string, unknown> = {
      merchant_code: merchantCode,
      country_code: country,
      order_no: input.orderId,
      // Payme India requires integer order_amount (same as payin).
      order_amount: String(Math.round(input.grossAmount)),
      pay_type: "indiaCommon",
      bank_code: bankCode,
      bank_card_no: input.bankAccount.trim(),
      bene_name: input.holderName.trim(),
      notify_url: payoutNotifyUrl(this.cfg.channelCode, input.orderId),
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
    const { secretKey } = this.getCreds();
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
    return { ok: false, providerRef, failedReason: `Non-final status: ${orderStatus}`, raw: td };
  }

  /** Backstop: POST /api/payoutOrderQuery to find current state. */
  async queryPayoutStatus(input: PayoutQueryInput): Promise<PayoutQueryResult> {
    let creds;
    try { creds = this.getCreds(); }
    catch (e) { return { status: "unknown", failedReason: (e as Error).message }; }
    const country = String(this.cfg.params?.country || "IN").trim().toUpperCase();
    const body = paymeSignedBody({
      merchant_code: creds.merchantCode,
      country_code: country,
      order_no: input.orderId,
    }, creds.secretKey);
    let json: Record<string, unknown>;
    try {
      const res = await fetch(`${creds.apiBase}/api/payoutOrderQuery`, {
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
    if (!ok) return { status: "unknown", failedReason: String(json.message || "query failed"), raw: json };
    const orderStatus = String(json.order_status || "");
    const providerRef = String(json.plat_order_no || "") || undefined;
    if (orderStatus === "success") return { status: "paid", providerRef, raw: json };
    if (orderStatus === "failed") return { status: "failed", providerRef, raw: json, failedReason: String(json.message || "Failed") };
    if (orderStatus === "payouting") return { status: "pending", providerRef, raw: json };
    return { status: "unknown", providerRef, raw: json };
  }
}

const payoutNotifyUrl = (channelCode: string, orderId: string): string => {
  const base = (process.env.FRONTEND_URL || "")
    .replace(/:18803.*/, ":18805")
    .replace(/\/$/, "");
  return `${base}/api/withdrawal/webhook/${encodeURIComponent(channelCode)}?orderId=${encodeURIComponent(orderId)}`;
};
