import React from "react";
import { useAuth } from "../../auth/AuthProvider";
import { Plane } from "./Plane";
import { config } from "../../config";

const apiBase = config.api;
const TOKEN_KEY = "aviator_token";

/**
 * AuthScreen — shown when the user has no valid session.
 *
 * Two login paths:
 *
 * 1. Cross-device Telegram login (primary):
 *    a. POST /auth/login-request → one-time token
 *    b. Open t.me/<bot>?start=auth_<token> in a new tab
 *    c. Poll /auth/login-poll/<token> every 2s
 *    d. User taps "Confirm Login" in the bot
 *    e. Poll returns JWT → reload → logged in
 *
 * 2. Password login (fallback for admins).
 *
 * Inside Telegram Mini App: bootstrapTelegram() in index.tsx handles auth
 * before this component even mounts. Users should never see this screen
 * while inside Telegram.
 */

type Stage = "idle" | "waiting" | "done";

export const AuthScreen: React.FC = () => {
  const { login, loading } = useAuth();
  const [stage, setStage] = React.useState<Stage>("idle");
  const [showPassword, setShowPassword] = React.useState(false);
  const [userName, setUserName] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const [botUsername, setBotUsername] = React.useState("eseecrashgamebot");
  const pollRef = React.useRef<ReturnType<typeof setInterval> | null>(null);
  const tokenRef = React.useRef<string | null>(null);

  // Fetch primary bot username from server (configurable via admin panel)
  React.useEffect(() => {
    fetch(`${apiBase}/auth/bots`)
      .then((r) => r.json())
      .then((j) => { if (j?.bots?.[0]?.username) setBotUsername(j.bots[0].username); })
      .catch(() => {});
  }, []);

  // Cleanup poll on unmount
  React.useEffect(() => () => { if (pollRef.current) clearInterval(pollRef.current); }, []);

  const startTelegramLogin = async () => {
    setError(null);
    try {
      // Step 1: get one-time login token from server
      const r = await fetch(`${apiBase}/auth/login-request`, { method: "POST" });
      const j = await r.json();
      if (!j.status || !j.token) throw new Error("Could not create login request");

      tokenRef.current = j.token;
      setStage("waiting");

      // Step 2: open the bot in a new tab with the token as start param
      window.open(`https://t.me/${botUsername}?start=auth_${j.token}`, "_blank");

      // Step 3: poll every 2s until fulfilled or expired (5 min)
      let elapsed = 0;
      pollRef.current = setInterval(async () => {
        elapsed += 2000;
        if (elapsed > 5 * 60 * 1000) {
          clearInterval(pollRef.current!);
          setStage("idle");
          setError("Login timed out. Please try again.");
          return;
        }
        try {
          const pr = await fetch(`${apiBase}/auth/login-poll/${j.token}`);
          const pj = await pr.json();
          if (pj.fulfilled && pj.jwt) {
            clearInterval(pollRef.current!);
            localStorage.setItem(TOKEN_KEY, pj.jwt);
            setStage("done");
            setTimeout(() => window.location.reload(), 500);
          } else if (!pj.status) {
            // Token invalid/expired
            clearInterval(pollRef.current!);
            setStage("idle");
            setError("Login link expired. Please try again.");
          }
        } catch { /* network hiccup — keep polling */ }
      }, 2000);
    } catch (e: any) {
      setError(e.message || "Failed to start login");
      setStage("idle");
    }
  };

  const cancelLogin = () => {
    if (pollRef.current) clearInterval(pollRef.current);
    tokenRef.current = null;
    setStage("idle");
    setError(null);
  };

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

        {!showPassword && stage === "idle" && (
          <button className="auth-tg-deeplink" onClick={startTelegramLogin}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="white"
              style={{ marginRight: 8, verticalAlign: "middle", flexShrink: 0 }}>
              <path d="M12 0C5.373 0 0 5.373 0 12s5.373 12 12 12 12-5.373 12-12S18.627 0 12 0zm5.894 8.221l-1.97 9.28c-.145.658-.537.818-1.084.508l-3-2.21-1.447 1.394c-.16.16-.295.295-.605.295l.213-3.053 5.56-5.023c.242-.213-.054-.333-.373-.12L7.41 13.617l-2.96-.924c-.643-.204-.657-.643.136-.953l11.57-4.461c.537-.194 1.006.131.738.942z"/>
            </svg>
            Log in with Telegram
          </button>
        )}

        {/* Waiting state: spinner + instruction */}
        {stage === "waiting" && (
          <div className="auth-tg-waiting">
            <div className="auth-tg-spinner" />
            <div className="auth-tg-waiting-text">
              <strong>Confirm in Telegram</strong>
              <span>Tap "✅ Confirm Login" in the bot message</span>
            </div>
            <button className="auth-tg-cancel" onClick={cancelLogin}>Cancel</button>
          </div>
        )}

        {stage === "done" && (
          <div className="auth-tg-waiting">
            <div style={{ fontSize: 28 }}>✅</div>
            <div className="auth-tg-waiting-text">
              <strong>Logged in!</strong>
              <span>Redirecting…</span>
            </div>
          </div>
        )}

        {error && <div className="auth-error">⚠ {error}</div>}

        {!showPassword && stage === "idle" ? (
          <div className="auth-footer">
            <button type="button" onClick={() => { setShowPassword(true); setError(null); }}>
              Sign in with password
            </button>
          </div>
        ) : showPassword ? (
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
        ) : null}
      </div>
    </div>
  );
};
