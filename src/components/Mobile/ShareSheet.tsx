import React from "react";
import { useAuth } from "../../auth/AuthProvider";

interface Props {
  open: boolean;
  onClose: () => void;
  /** Optional headline override — used when triggered from the out-of-balance prompt. */
  headline?: string;
}

/**
 * ShareSheet — referral share modal.
 * Builds `<frontendOrigin>?ref=<myUserName>` and exposes:
 *   • Copy-to-clipboard
 *   • Native Web Share API (mobile)
 *   • Telegram t.me deep link (`?start=ref_<myUserName>`) — works inside the
 *     Telegram WebApp via openTelegramLink so it stays in-app.
 *
 * Reward note: server credits referralRewardInr (admin-set, default ₹100) to
 * the referrer EACH TIME a referred user successfully recharges (fiat or
 * crypto). Idempotent per recharge event.
 */
export const ShareSheet: React.FC<Props> = ({ open, onClose, headline }) => {
  const { user } = useAuth();
  const [copied, setCopied] = React.useState(false);

  const myName = user?.userName || "";
  const origin =
    typeof window !== "undefined"
      ? `${window.location.protocol}//${window.location.host}`
      : "";
  const link = myName ? `${origin}/?ref=${encodeURIComponent(myName)}` : origin;

  // Telegram deep link — only useful if there is a configured bot username.
  // Pulled from the Telegram WebApp itself if available.
  const tgBotUsername =
    typeof window !== "undefined"
      ? ((window as any).Telegram?.WebApp?.initDataUnsafe?.bot?.username ||
          (window as any).__TG_BOT_USERNAME__ ||
          "")
      : "";
  const tgLink = tgBotUsername && myName
    ? `https://t.me/${tgBotUsername}?start=ref_${encodeURIComponent(myName)}`
    : "";

  const shareText = `🛩️ Play Aviator with me — earn ₹100 each time we recharge!\n${tgLink || link}`;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(tgLink || link);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      // fall back to legacy
      const ta = document.createElement("textarea");
      ta.value = tgLink || link;
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand("copy"); setCopied(true); } catch { /* ignore */ }
      document.body.removeChild(ta);
      setTimeout(() => setCopied(false), 1800);
    }
  };

  const nativeShare = async () => {
    const tg = (window as any).Telegram?.WebApp;
    if (tg?.openTelegramLink && tgLink) {
      // Inside Telegram → use openTelegramLink to share to a chat.
      tg.openTelegramLink(
        `https://t.me/share/url?url=${encodeURIComponent(tgLink)}&text=${encodeURIComponent(
          "🛩️ Play Aviator with me — earn ₹100 each recharge!",
        )}`,
      );
      return;
    }
    if ((navigator as any).share) {
      try {
        await (navigator as any).share({
          title: "Aviator Crash",
          text: "Play Aviator with me — earn ₹100 each recharge!",
          url: tgLink || link,
        });
      } catch { /* user cancelled */ }
      return;
    }
    // Fallback: copy
    copy();
  };

  if (!open) return null;

  return (
    <div className="mobile-modal-overlay" onClick={onClose}>
      <div
        className="mobile-modal share-modal"
        onClick={(e) => e.stopPropagation()}
      >
        <h3>{headline || "Invite friends · Earn ₹100"}</h3>
        <p className="share-blurb">
          Share your link. Get <strong>₹100</strong> credited to your balance
          <strong> every time</strong> a friend recharges — no cap.
        </p>

        <div className="share-link-row">
          <input
            className="share-link-input"
            type="text"
            value={tgLink || link}
            readOnly
            onFocus={(e) => e.currentTarget.select()}
            aria-label="Your referral link"
          />
          <button className="share-copy-btn" onClick={copy}>
            {copied ? "✓ Copied" : "Copy"}
          </button>
        </div>

        <div className="share-actions">
          <button className="modal-cta share-cta" onClick={nativeShare}>
            Share with friends
          </button>
          <button className="share-cancel" onClick={onClose}>
            Close
          </button>
        </div>

        {user?.userName ? (
          <div className="share-stats">
            Your code: <strong>{user.userName}</strong>
          </div>
        ) : null}
      </div>
    </div>
  );
};
