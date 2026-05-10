/**
 * Runs once at boot. If we're inside a Telegram WebApp and no `?cert=` is in
 * the URL yet, exchange initData → JWT and reload with `?cert=<token>` so
 * context.tsx picks it up on its first render.
 *
 * Outside Telegram (plain browser), do nothing — backend issues a dev guest
 * when token is missing (controlled by ALLOW_DEV_AUTH).
 */
import { getAttribution } from "./acquisition";

const apiBase = process.env.REACT_APP_API_URL || "http://localhost:5000";

export const bootstrapTelegram = async (): Promise<void> => {
  const url = new URL(window.location.href);
  if (url.searchParams.get("cert")) return;

  const tg = (window as any).Telegram?.WebApp;
  if (!tg || !tg.initData) return;

  // Telegram start_param carries the deep-link query (e.g. t.me/bot?start=ref_alice).
  // Convention: prefix-encoded "ref_<userName>" or "sid_<source>" — easy for users
  // to share via Telegram's native bot links.
  const startParam: string = tg.initDataUnsafe?.start_param || "";
  let tgRef: string | undefined;
  let tgSid: string | undefined;
  if (startParam.startsWith("ref_")) tgRef = startParam.slice(4);
  else if (startParam.startsWith("sid_")) tgSid = startParam.slice(4);

  const stored = getAttribution();

  try {
    tg.ready?.();
    tg.expand?.();
    const res = await fetch(`${apiBase}/api/auth/telegram`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        initData: tg.initData,
        sid: stored.sid || tgSid,
        ref: stored.ref || tgRef,
      }),
    });
    const json = await res.json();
    if (json?.token) {
      url.searchParams.set("cert", json.token);
      window.location.replace(url.toString());
    }
  } catch (err) {
    console.warn("[telegram] auth failed, continuing as guest", err);
  }
};
