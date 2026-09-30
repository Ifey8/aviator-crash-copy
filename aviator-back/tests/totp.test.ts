import { base32Encode, base32Decode, codeAt, verifyCode, generateSecret } from "../src/auth/totp";

// RFC 6238 Appendix B test secret "12345678901234567890" (SHA1)
const RFC_SECRET = base32Encode(Buffer.from("12345678901234567890"));

describe("totp", () => {
  test("RFC 6238 SHA1 vectors (last 6 digits)", () => {
    expect(codeAt(RFC_SECRET, Math.floor(59 / 30))).toBe("287082");
    expect(codeAt(RFC_SECRET, Math.floor(1111111109 / 30))).toBe("081804");
    expect(codeAt(RFC_SECRET, Math.floor(2000000000 / 30))).toBe("279037");
  });

  test("base32 round-trip", () => {
    const b = Buffer.from("hello world 123");
    expect(base32Decode(base32Encode(b)).equals(b)).toBe(true);
  });

  test("verify accepts current and ±1 step, rejects others", () => {
    const s = generateSecret();
    const now = 1_700_000_000_000;
    const step = Math.floor(now / 30000);
    expect(verifyCode(s, codeAt(s, step), now)).toBe(step);
    expect(verifyCode(s, codeAt(s, step - 1), now)).toBe(step - 1);
    expect(verifyCode(s, codeAt(s, step + 1), now)).toBe(step + 1);
    expect(verifyCode(s, codeAt(s, step - 3), now)).toBeNull();
    expect(verifyCode(s, "abc", now)).toBeNull();
    expect(verifyCode(s, "", now)).toBeNull();
  });
});
