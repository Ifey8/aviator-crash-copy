import { createHmac } from "crypto";

// Force config before import
process.env.TELEGRAM_BOT_TOKEN = "TEST_TOKEN_ABC";

import { validateInitData } from "../src/auth/telegram";

const buildInitData = (token: string, user: object, authDate = Math.floor(Date.now() / 1000)) => {
  const params = new URLSearchParams();
  params.set("user", JSON.stringify(user));
  params.set("auth_date", String(authDate));
  params.set("query_id", "test_query");

  const dataCheckString = [...params.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${v}`)
    .join("\n");

  const secretKey = createHmac("sha256", "WebAppData").update(token).digest();
  const hash = createHmac("sha256", secretKey).update(dataCheckString).digest("hex");
  params.set("hash", hash);
  return params.toString();
};

describe("telegram initData validation", () => {
  test("valid signed data passes", () => {
    const initData = buildInitData("TEST_TOKEN_ABC", { id: 42, username: "alice" });
    const r = validateInitData(initData);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.user.id).toBe(42);
      expect(r.user.username).toBe("alice");
    }
  });

  test("tampered hash fails", () => {
    let initData = buildInitData("TEST_TOKEN_ABC", { id: 42 });
    initData = initData.replace(/hash=[a-f0-9]+/, "hash=" + "0".repeat(64));
    const r = validateInitData(initData);
    expect(r.ok).toBe(false);
  });

  test("wrong token fails", () => {
    const initData = buildInitData("OTHER_TOKEN", { id: 42 });
    const r = validateInitData(initData);
    expect(r.ok).toBe(false);
  });

  test("empty initData fails", () => {
    const r = validateInitData("");
    expect(r.ok).toBe(false);
  });
});
