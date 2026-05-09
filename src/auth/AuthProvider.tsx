import React from "react";
import { config } from "../config";

const TOKEN_KEY = "aviator_token";

export interface AuthUser {
  userName: string;
  balance: number;
  avatar: string;
  isAdmin: boolean;
  phone?: string;
}

interface AuthValue {
  token: string | null;
  user: AuthUser | null;
  loading: boolean;
  /** First-paint flag: true while we're validating a stored token. */
  hydrating: boolean;
  login: (userName: string, password: string) => Promise<{ ok: true } | { ok: false; reason: string }>;
  register: (
    userName: string,
    password: string,
    phone?: string,
  ) => Promise<{ ok: true } | { ok: false; reason: string }>;
  logout: () => void;
}

const Ctx = React.createContext<AuthValue>(null!);

export const useAuth = (): AuthValue => React.useContext(Ctx);

const loadToken = (): string | null => {
  // Token comes from (in order): URL ?cert= (telegram bootstrap), localStorage.
  try {
    const url = new URL(window.location.href);
    const cert = url.searchParams.get("cert");
    if (cert) {
      localStorage.setItem(TOKEN_KEY, cert);
      return cert;
    }
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
};

const apiBase = config.api.replace(/\/api$/, "/api");

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [token, setToken] = React.useState<string | null>(() => loadToken());
  const [user, setUser] = React.useState<AuthUser | null>(null);
  const [hydrating, setHydrating] = React.useState<boolean>(!!token);
  const [loading, setLoading] = React.useState(false);

  // On mount: if we have a token, validate via /me. Otherwise we're done hydrating.
  React.useEffect(() => {
    let cancelled = false;
    if (!token) { setHydrating(false); return; }
    (async () => {
      try {
        const res = await fetch(`${apiBase}/auth/me`, {
          headers: { authorization: `Bearer ${token}` },
        });
        if (!res.ok) throw new Error("invalid");
        const body = await res.json();
        if (cancelled) return;
        setUser({
          userName: body.userName,
          balance: body.balance,
          avatar: body.avatar,
          isAdmin: !!body.isAdmin,
          phone: body.phone,
        });
      } catch {
        if (cancelled) return;
        localStorage.removeItem(TOKEN_KEY);
        setToken(null);
        setUser(null);
      } finally {
        if (!cancelled) setHydrating(false);
      }
    })();
    return () => { cancelled = true; };
  }, [token]);

  // After login/register we want the Socket.IO Provider in context.tsx to
  // re-initialise with the new JWT. Reloading the page is the cleanest way
  // — the socket constructor at module-load time then picks up the token
  // from localStorage. Cost: one ~300ms blank screen on first sign-in.
  const finishAuth = (body: any) => {
    localStorage.setItem(TOKEN_KEY, body.token);
    window.location.href = window.location.pathname || "/";
  };

  const login: AuthValue["login"] = async (userName, password) => {
    setLoading(true);
    try {
      const res = await fetch(`${apiBase}/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userName, password }),
      });
      const body = await res.json();
      if (!res.ok) return { ok: false, reason: body.message || "Login failed" };
      finishAuth(body);
      return { ok: true };
    } finally { setLoading(false); }
  };

  const register: AuthValue["register"] = async (userName, password, phone) => {
    setLoading(true);
    try {
      const res = await fetch(`${apiBase}/auth/register`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userName, password, phone }),
      });
      const body = await res.json();
      if (!res.ok) return { ok: false, reason: body.message || "Register failed" };
      finishAuth(body);
      return { ok: true };
    } finally { setLoading(false); }
  };

  const logout = () => {
    localStorage.removeItem(TOKEN_KEY);
    setToken(null);
    setUser(null);
    // Reload to drop the Socket.IO connection cleanly.
    window.location.href = "/";
  };

  return (
    <Ctx.Provider value={{ token, user, loading, hydrating, login, register, logout }}>
      {children}
    </Ctx.Provider>
  );
};
