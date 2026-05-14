import { createHmac, createHash } from "crypto";

// Must be set before the module import so config picks it up
process.env.TELEGRAM_BOT_TOKEN = "TEST_WIDGET_TOKEN";

import { verifyWidgetHash, TelegramWidgetPayload } from "../src/auth/telegram";

/** Build a valid-looking widget payload signed with the given bot token. */
const buildPayload = (
  token: string,
  overrides: Partial<Omit<TelegramWidgetPayload, "hash">> = {},
): TelegramWidgetPayload => {
  const base: Omit<TelegramWidgetPayload, "hash"> = {
    id: 42,
    first_name: "Alice",
    username: "alice",
    auth_date: Math.floor(Date.now() / 1000),
    ...overrides,
  };
  const dataCheckString = (Object.keys(base) as string[])
    .sort()
    .map((k) => `${k}=${(base as any)[k]}`)
    .join("\n");
  const secretKey = createHash("sha256").update(token).digest();
  const hash = createHmac("sha256", secretKey).update(dataCheckString).digest("hex");
  return { ...base, hash };
};

describe("Telegram widget hash verification", () => {
  test("valid payload passes and returns user fields", async () => {
    const payload = buildPayload("TEST_WIDGET_TOKEN");
    const r = await verifyWidgetHash(payload);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.user.id).toBe(42);
      expect(r.user.username).toBe("alice");
    }
  });

  test("expired auth_date (>3600s ago) fails", async () => {
    const payload = buildPayload("TEST_WIDGET_TOKEN", {
      auth_date: Math.floor(Date.now() / 1000) - 7200,
    });
    const r = await verifyWidgetHash(payload);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/expired/i);
  });

  test("tampered hash fails", async () => {
    const payload = buildPayload("TEST_WIDGET_TOKEN");
    const r = await verifyWidgetHash({ ...payload, hash: "0".repeat(64) });
    expect(r.ok).toBe(false);
  });

  test("wrong token fails", async () => {
    const payload = buildPayload("OTHER_TOKEN");
    const r = await verifyWidgetHash(payload);
    expect(r.ok).toBe(false);
  });
});
