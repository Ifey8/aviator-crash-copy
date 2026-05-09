/**
 * Runs once at boot. If we're inside a Telegram WebApp and no `?cert=` is in
 * the URL yet, exchange initData → JWT and reload with `?cert=<token>` so
 * context.tsx picks it up on its first render.
 *
 * Outside Telegram (plain browser), do nothing — backend issues a dev guest
 * when token is missing (controlled by ALLOW_DEV_AUTH).
 */
declare global {
  interface Window {
    Telegram?: {
      WebApp?: {
        initData?: string;
        ready?: () => void;
        expand?: () => void;
        themeParams?: Record<string, string>;
      };
    };
  }
}

const apiBase = process.env.REACT_APP_API_URL || "http://localhost:5000";

export const bootstrapTelegram = async (): Promise<void> => {
  const url = new URL(window.location.href);
  if (url.searchParams.get("cert")) return;

  const tg = window.Telegram?.WebApp;
  if (!tg || !tg.initData) return;

  try {
    tg.ready?.();
    tg.expand?.();
    const res = await fetch(`${apiBase}/api/auth/telegram`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ initData: tg.initData }),
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
