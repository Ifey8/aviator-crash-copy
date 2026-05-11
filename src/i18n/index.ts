/**
 * Minimal i18n — no library, ~40 lines.
 *
 * Detection priority (first match wins):
 *   1. localStorage "lang" — user manual override, sticky across sessions
 *   2. Telegram.WebApp.initDataUnsafe.user.language_code — TG user's app language
 *   3. navigator.language — browser fallback
 *   4. "en" — default
 *
 * Hindi triggers on any code starting with "hi" (so `hi`, `hi-IN`, etc.).
 *
 * Re-rendering: components call useT() — that's a hook that returns `t` AND
 * subscribes the component to language-change events. Calling setLang() bumps
 * a counter via an event emitter; subscribed components re-render.
 *
 * Missing keys: fall back to the English string (NEVER show the raw key, that
 * looks like a bug to users). Missing in BOTH = return the key (logs a warn
 * in dev to catch typos).
 */
import React from "react";
import en, { I18nKey } from "./en";
import hi from "./hi";

export type Lang = "en" | "hi";

const STORAGE_KEY = "lang";
const dicts: Record<Lang, Record<string, string>> = { en, hi };

const detect = (): Lang => {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved === "en" || saved === "hi") return saved;
  } catch { /* localStorage blocked */ }

  // Telegram WebApp user language
  try {
    const tg = (window as any).Telegram?.WebApp?.initDataUnsafe?.user?.language_code;
    if (typeof tg === "string" && tg.toLowerCase().startsWith("hi")) return "hi";
    if (typeof tg === "string" && tg.toLowerCase().startsWith("en")) return "en";
  } catch { /* not in TG */ }

  // Browser language
  try {
    const nav = (navigator.language || (navigator as any).userLanguage || "").toLowerCase();
    if (nav.startsWith("hi")) return "hi";
  } catch { /* navigator missing */ }

  return "en";
};

// Single source of truth for current language.
let current: Lang = detect();
const listeners = new Set<() => void>();

export const getLang = (): Lang => current;

export const setLang = (lang: Lang): void => {
  if (lang === current) return;
  current = lang;
  try { localStorage.setItem(STORAGE_KEY, lang); } catch { /* ignore */ }
  listeners.forEach((l) => l());
};

export const t = (key: I18nKey | string): string => {
  const dict = dicts[current];
  const hit = dict[key];
  if (hit !== undefined) return hit;
  // Fall back to English so users never see a raw key.
  const fallback = (en as Record<string, string>)[key];
  if (fallback !== undefined) return fallback;
  if (process.env.NODE_ENV !== "production") {
    // eslint-disable-next-line no-console
    console.warn(`[i18n] missing key: ${key}`);
  }
  return key;
};

/**
 * Hook: gives you `t` and `lang`, re-renders when language changes.
 *
 * Usage:
 *   const { t, lang } = useT();
 *   <button>{t("cta.bet")}</button>
 */
export const useT = (): { t: typeof t; lang: Lang; setLang: typeof setLang } => {
  const [, force] = React.useReducer((n) => n + 1, 0);
  React.useEffect(() => {
    listeners.add(force);
    return () => { listeners.delete(force); };
  }, []);
  return { t, lang: current, setLang };
};
