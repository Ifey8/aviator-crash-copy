import React from "react";
import Context from "./context";
import { MobileApp } from "./components/Mobile/MobileApp";

/**
 * Mobile-first crash game UI. Original visual design — palette, plane SVG,
 * canvas trail, layout — built clean. Telegram MiniApp aware.
 *
 * Reuses the existing Socket.IO context for backend state + actions, so the
 * gameplay contract stays identical to the original.
 */
function App() {
  // Hint platform for analytics / future use; doesn't affect rendering.
  React.useEffect(() => {
    const isTg = !!(window as any).Telegram?.WebApp?.initData;
    document.documentElement.dataset.platform = isTg ? "telegram" : "web";
  }, []);

  // Suppress an unused-import warning while Context is used inside child components
  // (importing here keeps the dependency chain visible at the app root).
  void Context;

  return <MobileApp />;
}

export default App;
