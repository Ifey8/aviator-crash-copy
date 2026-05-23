import React from "react";
import { useAuth } from "../../auth/AuthProvider";
import { Plane } from "./Plane";
import { config } from "../../config";

const apiBase = config.api;

/**
 * AuthScreen — shown when the user has no valid session.
 *
 * Flow:
 *   • Inside Telegram Mini App → bootstrapTelegram() (in index.tsx) already
 *     exchanged initData for a JWT and redirected with ?cert=; user should
 *     NEVER see this screen while inside Telegram. If they do, something
 *     went wrong with the bootstrap.
 *
 *   • Web / desktop browser → show "Open in Telegram" button that navigates
 *     to t.me/<botUsername>. User opens the bot, taps Launch, and the Mini
 *     App auto-authenticates them via bootstrapTelegram.
 *
 *   • Fallback → "Sign in with password" for admin / password-registered users.
 */
export const AuthScreen: React.FC = () => {
  const { login, loading } = useAuth();
  const [showPassword, setShowPassword] = React.useState(false);
  const [userName, setUserName] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const [botLink, setBotLink] = React.useState<string | null>(null);

  // Fetch the primary bot username from the server so it's configurable.
  // Falls back to a hardcoded bot name if the request fails.
  React.useEffect(() => {
    fetch(`${apiBase}/auth/bots`)
      .then((r) => r.json())
      .then((j) => {
        const first = j?.bots?.[0];
        if (first?.username) setBotLink(`https://t.me/${first.username}?start=weblogin`);
      })
      .catch(() => setBotLink("https://t.me/eseecrashgamebot?start=weblogin"));
    // Also set fallback immediately so the button renders before fetch completes.
    setBotLink("https://t.me/eseecrashgamebot?start=weblogin");
  }, []);

  const submitPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    const r = await login(userName, password);
    if (!r.ok) setError(r.reason);
  };

  return (
    <div className="auth-screen">
      <div className="auth-card">
        <div className="auth-brand">
          <Plane size={48} static halo={false} />
          <h1>AVIATOR</h1>
          <p className="auth-tag">FESTIVE CRASH GAME</p>
        </div>

        {/* Primary CTA: open the Telegram bot, launch the Mini App, auto-auth */}
        {!showPassword && (
          <a
            className="auth-tg-deeplink"
            href={botLink || "https://t.me/eseecrashgamebot"}
            target="_blank"
            rel="noreferrer"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="white" style={{ marginRight: 8, verticalAlign: "middle" }}>
              <path d="M12 0C5.373 0 0 5.373 0 12s5.373 12 12 12 12-5.373 12-12S18.627 0 12 0zm5.894 8.221l-1.97 9.28c-.145.658-.537.818-1.084.508l-3-2.21-1.447 1.394c-.16.16-.295.295-.605.295l.213-3.053 5.56-5.023c.242-.213-.054-.333-.373-.12L7.41 13.617l-2.96-.924c-.643-.204-.657-.643.136-.953l11.57-4.461c.537-.194 1.006.131.738.942z"/>
            </svg>
            Log in with Telegram
          </a>
        )}

        {error && <div className="auth-error">⚠ {error}</div>}

        {!showPassword ? (
          <div className="auth-footer">
            <button
              type="button"
              onClick={() => { setShowPassword(true); setError(null); }}
            >
              Sign in with password
            </button>
          </div>
        ) : (
          <form className="auth-form" onSubmit={submitPassword}>
            <label className="auth-field">
              <span>Username</span>
              <input
                type="text"
                autoComplete="username"
                value={userName}
                onChange={(e) => setUserName(e.target.value)}
                minLength={3}
                maxLength={20}
                required
                autoFocus
              />
            </label>
            <label className="auth-field">
              <span>Password</span>
              <input
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                minLength={6}
                required
              />
            </label>
            <button className="auth-submit" type="submit" disabled={loading}>
              {loading ? "…" : "SIGN IN"}
            </button>
            <div className="auth-footer">
              <button type="button" onClick={() => { setShowPassword(false); setError(null); }}>
                ← Back
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
};
