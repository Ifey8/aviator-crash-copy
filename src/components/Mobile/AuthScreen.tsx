import React from "react";
import { useAuth } from "../../auth/AuthProvider";
import { Plane } from "./Plane";

type Tab = "login" | "register";

export const AuthScreen: React.FC = () => {
  const { login, register, loading } = useAuth();
  const [tab, setTab] = React.useState<Tab>("login");
  const [userName, setUserName] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [phone, setPhone] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    const r = tab === "login"
      ? await login(userName, password)
      : await register(userName, password, phone || undefined);
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

        <div className="auth-tabs">
          <button
            className={`auth-tab ${tab === "login" ? "active" : ""}`}
            onClick={() => { setTab("login"); setError(null); }}
            type="button"
          >
            Sign in
          </button>
          <button
            className={`auth-tab ${tab === "register" ? "active" : ""}`}
            onClick={() => { setTab("register"); setError(null); }}
            type="button"
          >
            Create account
          </button>
        </div>

        <form className="auth-form" onSubmit={submit}>
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
              autoComplete={tab === "login" ? "current-password" : "new-password"}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              minLength={6}
              required
            />
          </label>

          {tab === "register" && (
            <label className="auth-field">
              <span>Phone <em>(optional)</em></span>
              <input
                type="tel"
                inputMode="tel"
                autoComplete="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="+91 9876543210"
              />
            </label>
          )}

          {error && <div className="auth-error">⚠ {error}</div>}

          <button className="auth-submit" type="submit" disabled={loading}>
            {loading
              ? "…"
              : tab === "login" ? "SIGN IN" : "CREATE ACCOUNT"}
          </button>
        </form>

        <div className="auth-footer">
          {tab === "login" ? (
            <>New here? <button onClick={() => setTab("register")}>Create an account</button></>
          ) : (
            <>Already have an account? <button onClick={() => setTab("login")}>Sign in</button></>
          )}
        </div>
      </div>
    </div>
  );
};
