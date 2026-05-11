import { createHash } from "crypto";

/**
 * Payme signing helper.
 *
 * Algorithm (per Payme docs):
 *   1. Take all non-empty fields EXCEPT `sign`.
 *   2. Sort keys by ASCII (alphabetical).
 *   3. Join as key=value pairs with `&`.
 *   4. Append `&key=<secretKey>`.
 *   5. MD5 hex digest.
 *   6. Uppercase.
 *
 * Empty values (null / undefined / "") are excluded — verified against the
 * Java reference impl in the doc which checks `StringUtils.isBlank`.
 *
 * Same function is used for:
 *   • outgoing request signing (sign every body before POSTing)
 *   • incoming webhook verification (recompute over transdata, compare to outer sign)
 */
export const paymeSign = (data: Record<string, unknown>, secretKey: string): string => {
  const keys = Object.keys(data)
    .filter((k) => k !== "sign")
    .filter((k) => {
      const v = data[k];
      if (v === null || v === undefined) return false;
      const s = typeof v === "string" ? v : String(v);
      return s.trim().length > 0;
    })
    .sort();

  const pairs = keys.map((k) => `${k}=${data[k]}`).join("&");
  const toSign = `${pairs}&key=${secretKey}`;
  return createHash("md5").update(toSign, "utf8").digest("hex").toUpperCase();
};

/** Build a signed payload by computing sign + merging in. */
export const paymeSignedBody = (
  fields: Record<string, unknown>,
  secretKey: string,
): Record<string, unknown> => ({
  ...fields,
  sign: paymeSign(fields, secretKey),
});

/**
 * Verify an incoming webhook envelope `{ sign, transdata }`. Returns true
 * iff recomputing the sign over transdata's content matches the outer
 * sign field (timing-safe-ish comparison via length + char equality).
 */
export const paymeVerifyWebhook = (
  envelope: { sign?: string; transdata?: Record<string, unknown> } | null | undefined,
  secretKey: string,
): boolean => {
  if (!envelope || typeof envelope !== "object") return false;
  const sign = String(envelope.sign || "");
  const transdata = envelope.transdata;
  if (!sign || !transdata || typeof transdata !== "object") return false;
  const expected = paymeSign(transdata, secretKey);
  if (expected.length !== sign.length) return false;
  let mismatch = 0;
  for (let i = 0; i < expected.length; i++) {
    mismatch |= expected.charCodeAt(i) ^ sign.charCodeAt(i);
  }
  return mismatch === 0;
};
