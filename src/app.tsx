import React from "react";
import { MobileApp } from "./components/Mobile/MobileApp";
import { AuthScreen } from "./components/Mobile/AuthScreen";
import { AdminApp } from "./components/Admin/AdminApp";
import { useAuth } from "./auth/AuthProvider";
import "./components/Mobile/auth.scss";
import "./components/Admin/admin.scss";
import "./components/Mobile/luxe.scss"; // theme override — must load LAST

function App() {
  const { user, hydrating } = useAuth();

  React.useEffect(() => {
    const isTg = !!(window as any).Telegram?.WebApp?.initData;
    document.documentElement.dataset.platform = isTg ? "telegram" : "web";
  }, []);

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

  // Route: /admin → AdminApp (admin role required)
  // Anything else → MobileApp
  const path = typeof window !== "undefined" ? window.location.pathname : "/";
  if (path.startsWith("/admin")) {
    if (!user.isAdmin) {
      return (
        <div className="auth-screen">
          <div className="auth-card" style={{ textAlign: "center" }}>
            <h2 style={{ margin: "0 0 8px" }}>Admin only</h2>
            <p style={{ color: "rgba(255,245,220,0.55)", fontSize: 13 }}>
              Your account does not have admin privileges.
            </p>
            <a href="/" style={{ color: "#ffc857", fontWeight: 700, fontSize: 13 }}>← Back to game</a>
          </div>
        </div>
      );
    }
    return <AdminApp />;
  }

  return <MobileApp />;
}

export default App;
