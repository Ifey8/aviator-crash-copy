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
        default: "india-wakeup",
        options: [
          { value: "india-wakeup", label: "india-wakeup · 唤醒 (operator opens UPI app)" },
          { value: "india-qr", label: "india-qr · 扫码 (QR code)" },
          { value: "india-native", label: "india-native · 原生 (hosted page)" },
          { value: "india-pwallet", label: "india-pwallet · 个人钱包唤醒" },
        ],
        hint: "Each Payme merchant only has SOME pay_types enabled — confirm with your account manager which ones are open. Default india-wakeup (Payme's most commonly-opened type).",
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
      // Fee config — what the GATEWAY charges the operator (not what
      // the user pays). Used by the ledger to compute the operator's
      // running channel balance / reconciliation.
      {
        key: "payinFeePct",
        label: "Payin fee % (operator cost)",
        kind: "number",
        default: "0.05",
        hint: "Fraction the gateway keeps on each successful payin. 0.05 = 5%. For ₹1000 deposit, operator nets ₹950 in Payme's account.",
      },
      {
        key: "payoutFeePct",
        label: "Payout fee % (operator cost)",
        kind: "number",
        default: "0.03",
        hint: "Fraction the gateway charges on each successful payout. 0.03 = 3%. For ₹1000 payout, Payme deducts ₹30 from operator.",
      },
      {
        key: "payoutFeeFlat",
        label: "Payout flat fee (INR per transaction)",
        kind: "number",
        default: "6",
        hint: "Per-transaction flat fee on top of the % fee. Payme charges ₹6/transaction for India.",
      },
    ],
    createPaymentProvider: (cfg) => new PaymeProvider(cfg),
    createPayoutProvider: (cfg) => new PaymePayoutProvider(cfg),
  });
};
