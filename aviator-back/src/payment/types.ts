/**
 * PaymentProvider — abstraction over a third-party payment platform.
 *
 * Implementations live in ./providers/*.ts. The registry in ./index.ts maps
 * provider names ("mock" / "razorpay" / etc) to instances.
 *
 * Two operations:
 *   1. createOrder — initiated by the user; returns where they should pay.
 *   2. verifyWebhook — initiated by the provider; tells us a payment landed
 *      (or failed). Must verify HMAC signature so a malicious caller can't
 *      spoof a "paid" notification for someone else's order.
 *
 * Both operations are stateless — order persistence + balance crediting
 * happens in routes/recharge.ts using the model.
 */

export interface CreateOrderInput {
  /** Internal order UUID; pass through to the provider as their reference. */
  orderId: string;
  /** Amount in major units (INR rupees, not paise). */
  amount: number;
  currency: string;
  userName: string;
  /** Where the provider should redirect after payment (frontend success page). */
  returnUrl: string;
  /** Where the provider should POST status webhooks (backend endpoint). */
  webhookUrl: string;
}

export interface CreateOrderResult {
  /** URL the user opens to pay. */
  paymentUrl: string;
  /** Provider's own order/reference ID, stored as RechargeOrder.providerRef. */
  providerRef: string;
  /** Optional UPI QR or deeplink payload. */
  qrCode?: string;
}

export interface WebhookVerifyResult {
  ok: boolean;
  /** Provider's reference for the order (matches RechargeOrder.providerRef). */
  providerRef: string;
  status: "paid" | "failed";
  failedReason?: string;
  raw?: unknown;
}

/**
 * Backstop poll: ask the upstream gateway what state THEIR copy of the
 * order is in. Used by the orderWatcher to catch missed webhooks.
 * Returns `unknown` to mean "can't determine; try again later". Providers
 * that don't support polling can omit this method.
 */
export interface QueryOrderStatusInput {
  orderId: string;        // our internal merchant order_no
  providerRef?: string;   // gateway's plat_order_no if we have it
}
export interface QueryOrderStatusResult {
  /** "paid" / "failed" terminal; "pending" still in flight; "unknown" couldn't tell. */
  status: "paid" | "failed" | "pending" | "unknown";
  providerRef?: string;
  failedReason?: string;
  raw?: unknown;
}

export interface PaymentProvider {
  readonly name: string;
  /** True iff this provider is safe to expose in production. */
  readonly isProduction: boolean;
  createOrder(input: CreateOrderInput): Promise<CreateOrderResult>;
  /**
   * Validates the incoming webhook (signature) and extracts {providerRef,status}.
   * Headers are passed raw so each provider can pull whichever signature header
   * they use (X-Razorpay-Signature, X-Cashfree-Signature, ...).
   */
  verifyWebhook(headers: Record<string, string | string[] | undefined>, rawBody: string):
    WebhookVerifyResult;
  /** Backstop poll. Optional — orderWatcher skips providers that don't expose it. */
  queryOrderStatus?(input: QueryOrderStatusInput): Promise<QueryOrderStatusResult>;
}
