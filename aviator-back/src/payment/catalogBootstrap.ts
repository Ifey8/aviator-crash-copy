import { registerProviderType } from "./catalog";
import { PaymeProvider } from "./providers/payme";
import { PaymePayoutProvider } from "./providers/paymePayout";

/**
 * Register all known provider types here. Called once at boot (from
 * payment/channels.ts module-load time).
 *
 * To add a new provider:
 *   1. Implement PaymentProvider and/or PayoutProvider with a constructor
 *      that takes a ChannelConfig.
 *   2. Append a registerProviderType({...}) call here.
 *   3. Admin can create channels for it immediately via the Channels tab.
 */
let bootstrapped = false;
export const bootstrapCatalog = (): void => {
  if (bootstrapped) return;
  bootstrapped = true;

  registerProviderType({
    name: "payme",
    displayName: "Payme (Cowpay)",
    countries: ["IN", "ID"],
    supports: { payin: true, payout: true },
    credentialFields: [
      {
        key: "apiBase",
        label: "API base URL",
        kind: "text",
        required: true,
        hint: "Base URL Payme gave you, e.g. https://api.cowpay.io — used as prefix for /api/payin, /api/payout, etc. No trailing slash.",
      },
      {
        key: "merchantCode",
        label: "Merchant code",
        kind: "text",
        required: true,
        hint: "merchant_code field from Payme dashboard. Sent in every signed request body.",
      },
      {
        key: "secretKey",
        label: "Secret key (MD5 sign)",
        kind: "secret",
        required: true,
        hint: "MD5 sign key from Payme dashboard. Used to sign outgoing requests + verify incoming webhooks.",
      },
    ],
    paramFields: [
      {
        key: "country",
        label: "Country code",
        kind: "select",
        default: "IN",
        options: [
          { value: "IN", label: "India (INR)" },
          { value: "ID", label: "Indonesia (IDR)" },
        ],
        hint: "Sent as country_code in every Payme request.",
      },
      {
        key: "payinPayType",
        label: "Payin pay_type",
        kind: "select",
        default: "india-native",
        options: [
          { value: "india-native", label: "india-native (hosted page)" },
          { value: "india-wakeup", label: "india-wakeup" },
          { value: "india-qr", label: "india-qr" },
          { value: "india-pwallet", label: "india-pwallet" },
        ],
        hint: "Which Payme payin product to use. india-native works for most.",
      },
      {
        key: "payoutBankCode",
        label: "Payout bank_code",
        kind: "select",
        default: "india-bank",
        options: [
          { value: "india-bank", label: "india-bank (account + IFSC)" },
          { value: "india-upi", label: "india-upi (UPI ID)" },
        ],
        hint: "The Aviator WithdrawalSheet asks for bankAccount + IFSC + holderName, which maps to india-bank.",
      },
    ],
    createPaymentProvider: (cfg) => new PaymeProvider(cfg),
    createPayoutProvider: (cfg) => new PaymePayoutProvider(cfg),
  });
};
