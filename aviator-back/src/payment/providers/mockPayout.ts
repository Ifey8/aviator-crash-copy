import { randomUUID } from "crypto";
import { PayoutProvider, PayoutCreateInput, PayoutCreateResult, PayoutWebhookResult } from "../payoutTypes";

/**
 * MockPayoutProvider — local/dev. Returns "processing" immediately so the
 * order shows up in the user's history; admin then manually marks it paid
 * or failed via the admin Withdrawals tab.
 *
 * In real life you'd integrate Razorpay Payouts / Cashfree / a TRC20 hot
 * wallet here. The interface is identical — drop a new file in providers/
 * and register it in payment/payouts.ts.
 */
export class MockPayoutProvider implements PayoutProvider {
  readonly name = "mock";

  async createPayout(input: PayoutCreateInput): Promise<PayoutCreateResult> {
    // Mock: instant accept; return a fake providerRef so admin/webhook
    // can correlate later. We DON'T auto-credit — admin must mark-paid.
    return {
      providerRef: `mock_${randomUUID()}`,
      status: "processing",
      message:
        input.method === "bank"
          ? "Bank transfer queued — usually settles in 1-24h"
          : "USDT withdrawal queued — confirmed within minutes",
    };
  }

  verifyWebhook(_headers: Record<string, unknown>, _rawBody: string): PayoutWebhookResult {
    // Mock has no webhook; admin marks paid/failed manually.
    return { ok: false, providerRef: "" };
  }
}
