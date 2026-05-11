import { PaymentChannelModel } from "../db/models/PaymentChannel";
import { SettingsModel } from "../db/models/Settings";

/**
 * One-time boot migration: lift any legacy Payme config from the
 * Settings doc (paymeApiBase / paymeMerchantCode / paymeSecretKey /
 * paymeEnabled / paymePayinPayType / paymePayoutBankCode) into a
 * PaymentChannel doc, then $unset the legacy keys so the Settings
 * page no longer shows them.
 *
 * Idempotent: if a Payme channel already exists OR the legacy keys
 * aren't present, this is a no-op.
 *
 * Created channel:
 *   code: "payme-in-1"
 *   name: "Payme (migrated from Settings)"
 *   provider: "payme"
 *   country: "IN"
 *   enabled: <paymeEnabled value, defaulting to 0>
 */
export const migratePaymeSettingsToChannel = async (): Promise<void> => {
  const settings = await SettingsModel.findById("default").lean<any>();
  if (!settings) return; // no settings doc yet, nothing to migrate
  const apiBase = settings.paymeApiBase;
  const merchantCode = settings.paymeMerchantCode;
  const secretKey = settings.paymeSecretKey;
  // Nothing to migrate if no creds were ever entered
  if (!apiBase && !merchantCode && !secretKey) {
    await cleanupLegacyKeys();
    return;
  }

  // Skip if a Payme channel already exists (admin may have re-created)
  const existing = await PaymentChannelModel.findOne({ provider: "payme" }).lean();
  if (existing) {
    await cleanupLegacyKeys();
    return;
  }

  const code = "payme-in-1";
  await PaymentChannelModel.create({
    code,
    name: "Payme (migrated from Settings)",
    provider: "payme",
    country: "IN",
    enabled: Number(settings.paymeEnabled) === 1,
    supports: { payin: true, payout: true },
    credentials: {
      apiBase: String(apiBase || ""),
      merchantCode: String(merchantCode || ""),
      secretKey: String(secretKey || ""),
    },
    params: {
      country: "IN",
      payinPayType: String(settings.paymePayinPayType || "india-native"),
      payoutBankCode: String(settings.paymePayoutBankCode || "india-bank"),
    },
    priority: 100,
  });

  console.log(`[migrate] Created channel "${code}" from legacy Payme Settings (enabled=${Number(settings.paymeEnabled) === 1})`);
  await cleanupLegacyKeys();
};

const cleanupLegacyKeys = async (): Promise<void> => {
  // Use the raw MongoDB driver collection rather than Mongoose model:
  // mongoose strict mode (the default) silently strips $unset operations
  // on fields that aren't in the schema. We just removed paymeXxx from
  // the schema, so mongoose would refuse to unset them — exactly the
  // wrong behaviour for a migration. Raw driver bypasses strict mode.
  const r = await SettingsModel.collection.updateOne(
    { _id: "default" as any },
    {
      $unset: {
        paymeEnabled: "",
        paymeApiBase: "",
        paymeMerchantCode: "",
        paymeSecretKey: "",
        paymePayinPayType: "",
        paymePayoutBankCode: "",
      },
    },
  );
  if (r.modifiedCount > 0) {
    console.log("[migrate] $unset legacy Payme keys from Settings doc");
  }
};
