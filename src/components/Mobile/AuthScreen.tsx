import React from "react";
import { useAuth, TelegramWidgetPayload } from "../../auth/AuthProvider";
import { Plane } from "./Plane";

const BOT_NAME = "crashaviator2026bot";

export const AuthScreen: React.FC = () => {
  const { login, loginWithTelegram, loading } = useAuth();
  const [showPassword, setShowPassword] = React.useState(false);
  const [userName, setUserName] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);

  // Keep callback stable across renders via ref so the widget script
  // (loaded once) always calls the latest version of loginWithTelegram.
  const loginWithTelegramRef = React.useRef(loginWithTelegram);
  loginWithTelegramRef.current = loginWithTelegram;

  React.useEffect(() => {
    (window as any).onTelegramAuth = async (user: TelegramWidgetPayload) => {
      const r = await loginWithTelegramRef.current(user);
      if (!r.ok) setError(r.reason);
    };

    const container = document.getElementById("tg-widget-container");
    if (!container) return;

    const script = document.createElement("script");
    script.src = "https://telegram.org/js/telegram-widget.js?22";
    script.setAttribute("data-telegram-login", BOT_NAME);
    script.setAttribute("data-size", "large");
    script.setAttribute("data-onauth", "onTelegramAuth(user)");
    script.setAttribute("data-request-access", "write");
    script.async = true;
    container.appendChild(script);

    return () => {
      delete (window as any).onTelegramAuth;
      container.innerHTML = "";
    };
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

        <div id="tg-widget-container" className="auth-tg-widget" />

        {error && <div className="auth-error">⚠ {error}</div>}

        {!showPassword ? (
          <div className="auth-footer">
            <button type="button" onClick={() => { setShowPassword(true); setError(null); }}>
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
