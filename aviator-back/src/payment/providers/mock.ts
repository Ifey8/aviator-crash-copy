import { PaymentProvider, CreateOrderInput, CreateOrderResult, WebhookVerifyResult } from "../types";
import { config } from "../../config";

/**
 * MockProvider — for development only.
 *
 * createOrder: returns a paymentUrl pointing to our own frontend `/mock-pay`
 *              route. The user clicks "Pay Now" on that page, which calls
 *              the dev-only `POST /api/recharge/mock-pay/:orderId` endpoint
 *              to flip the order to paid (no signature needed; the orderId
 *              itself acts as the unforgeable token).
 *
 * verifyWebhook: not used (we have a dedicated mock-pay endpoint instead),
 *                but implemented for symmetry — accepts a JSON body with
 *                `{ providerRef, status }`.
 *
 * Disabled in production via `isProduction = false` + the recharge route
 * checks `config.allowDevAuth` to gate this provider.
 */
export class MockProvider implements PaymentProvider {
  readonly name = "mock";
  readonly isProduction = false;

  async createOrder(input: CreateOrderInput): Promise<CreateOrderResult> {
    const base = config.frontendUrl?.replace(/\/$/, "") || "";
    const paymentUrl = `${base}/mock-pay?orderId=${encodeURIComponent(input.orderId)}&amount=${input.amount}`;
    return {
      paymentUrl,
      providerRef: `mock_${input.orderId}`,
    };
  }

  verifyWebhook(_headers: Record<string, unknown>, rawBody: string): WebhookVerifyResult {
    try {
      const body = JSON.parse(rawBody);
      return {
        ok: true,
        providerRef: String(body.providerRef || ""),
        status: body.status === "paid" ? "paid" : "failed",
        raw: body,
      };
    } catch {
      return { ok: false, providerRef: "", status: "failed" };
    }
  }
}
