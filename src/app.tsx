import React from "react";
import { MobileApp } from "./components/Mobile/MobileApp";
import { AuthScreen } from "./components/Mobile/AuthScreen";
import { AdminApp } from "./components/Admin/AdminApp";
import { MockPayPage } from "./components/Mobile/MockPayPage";
import { useAuth } from "./auth/AuthProvider";
import "./components/Mobile/auth.scss";
import "./components/Admin/admin.scss";
import "./components/Mobile/recharge.scss";
import "./components/Mobile/luxe.scss"; // theme override — must load LAST

function App() {
  const { user, hydrating } = useAuth();

  React.useEffect(() => {
    const isTg = !!(window as any).Telegram?.WebApp?.initData;
    document.documentElement.dataset.platform = isTg ? "telegram" : "web";
  }, []);

  // /mock-pay is the dev provider's "fake bank" page. Renders without auth
  // (the orderId in the query string is the unforgeable token, mirroring
  // how a real provider page works — anyone with the link can pay).
  const path = typeof window !== "undefined" ? window.location.pathname : "/";
  if (path === "/mock-pay" || path.startsWith("/mock-pay")) {
    return <MockPayPage />;
  }

  // /admin has its own login (password + Google Authenticator) and session,
  // independent of the game account — server-side requireAdmin enforces it.
  if (path.startsWith("/admin")) return <AdminApp />;

  // First-paint flash protection: if a token is in localStorage we're
  // validating it via /me; show a tiny shell, not the AuthScreen.
  if (hydrating) {
    return (
      <div className="auth-screen">
        <div className="auth-card" style={{ textAlign: "center", padding: 32 }}>
          <div style={{ color: "rgba(255,245,220,0.55)", letterSpacing: "0.2em", fontSize: 11 }}>
            LOADING…
          </div>
        </div>
      </div>
    );
  }

  if (!user) return <AuthScreen />;

  return <MobileApp />;
}

export default App;
