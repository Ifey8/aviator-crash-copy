/**
 * First-touch attribution: capture `?sid=` and `?ref=` from the landing URL
 * once and persist to localStorage. Subsequent visits keep the original
 * value — we never overwrite (matches the backend's first-touch policy).
 *
 * Used by:
 *   • AuthProvider.register   (sends sid + ref with /api/auth/register)
 *   • telegram-bootstrap.ts   (sends sid + ref with /api/auth/telegram)
 *
 * `ref` is also exposed via `getOwnReferralCode()` so the share modal can
 * build the share link `<frontendUrl>?ref=<myUserName>`.
 */

const SID_KEY = "aviator_sid";
const REF_KEY = "aviator_ref";

const sanitize = (s: string | null | undefined): string | undefined => {
  if (!s) return undefined;
  const cleaned = s.replace(/[^A-Za-z0-9_.-]/g, "").slice(0, 64);
  return cleaned || undefined;
};

/**
 * Run once at app boot. Reads `?sid=` and `?ref=` from URL, persists to
 * localStorage if not already set (first-touch wins).
 */
export const captureAttribution = (): void => {
  try {
    const url = new URL(window.location.href);
    const sid = sanitize(url.searchParams.get("sid"));
    const ref = sanitize(url.searchParams.get("ref"));
    if (sid && !localStorage.getItem(SID_KEY)) {
      localStorage.setItem(SID_KEY, sid);
    }
    if (ref && !localStorage.getItem(REF_KEY)) {
      localStorage.setItem(REF_KEY, ref);
    }
  } catch {
    // ignore (SSR / private mode)
  }
};

export const getAttribution = (): { sid?: string; ref?: string } => {
  try {
    return {
      sid: localStorage.getItem(SID_KEY) || undefined,
      ref: localStorage.getItem(REF_KEY) || undefined,
    };
  } catch {
    return {};
  }
};
