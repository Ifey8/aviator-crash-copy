import type { I18nKey } from "./en";

/**
 * Hindi (हिन्दी) copy — Hinglish-style for gambling/game terms because
 * pure-Devanagari translations (दांव instead of बेट, गुणक instead of
 * मल्टीप्लायर) read overly formal to Indian Telegram gaming audiences.
 * Numbers stay Arabic numerals (not Devanagari) — `Intl.NumberFormat("en-IN")`
 * Indian grouping like `₹1,23,456.78` reads fine in both locales.
 *
 * Missing keys auto-fall-back to English (i18n/index.ts).
 */
const hi: Record<I18nKey, string> = {
  // ---- Header ----
  "header.add": "+ जोड़ें",
  "header.offline": "ऑफ़लाइन",
  "header.out": "⊖ निकालें",

  // ---- BetCard tabs ----
  "bet.tab.bet": "बेट",
  "bet.tab.auto": "ऑटो",
  "bet.autoTarget": "ऑटो कैशआउट टारगेट",

  // ---- BetCard CTAs ----
  "cta.bet": "बेट",
  "cta.autoBet": "ऑटो बेट",
  "cta.cashOut": "कैश आउट",
  "cta.cashedOut": "कैश आउट हो गया",
  "cta.betPlaced": "बेट लगा",

  // ---- AUTO ON pill ----
  "auto.on": "ऑटो ऑन",
  "auto.stop": "✕ रोकें",

  // ---- Common ----
  "common.close": "बंद करें",
  "common.done": "हो गया",
  "common.tryAgain": "फिर से कोशिश करें",
  "common.cancel": "रद्द करें",

  // ---- Account sheet ----
  "account.balance.total": "कुल बैलेंस",
  "account.balance.locked": "लॉक (प्लेथ्रू)",
  "account.balance.withdrawable": "निकाला जा सकता है",
  "account.adminPanel": "⚙ एडमिन पैनल",
  "account.signOut": "साइन आउट",
  "account.signOutConfirm": "साइन आउट करें?",
  "account.close": "बंद करें",
  "account.language": "भाषा",

  // ---- Recharge ----
  "recharge.title": "बैलेंस रिचार्ज करें",
  "recharge.sub": "अपने वॉलेट में जोड़ने के लिए राशि चुनें।",
  "recharge.method.fiat": "UPI / कार्ड",
  "recharge.method.fiat.sub": "INR",
  "recharge.method.crypto": "USDT",
  "recharge.method.crypto.sub": "TRC-20",
  "recharge.inrUnavailable": "INR रिचार्ज अभी उपलब्ध नहीं है। USDT (TRC-20) चालू है।",
  "recharge.continue": "जारी रखें",
  "recharge.fine.crypto": "न्यूनतम 10 USDT · लाइव USDT/INR रेट · 1 कन्फर्मेशन पर बैलेंस में आता है",
  "recharge.fine.fiat": "न्यूनतम ₹100 · अधिकतम ₹50,000 · आमतौर पर 1 मिनट में बैलेंस में आता है",
  "recharge.creating": "ऑर्डर बना रहे हैं…",
  "recharge.pendingTitle": "भुगतान का इंतज़ार",
  "recharge.openPaymentPage": "पेमेंट पेज खोलें",
  "recharge.pendingHint": "अगर पेमेंट पेज नहीं खुला, तो ऊपर वाला बटन दबाएं।",
  "recharge.expiresIn": "समाप्त होने में",
  "recharge.cancelOrder": "ऑर्डर रद्द करें",
  "recharge.successTitle": "रिचार्ज पूरा हुआ",
  "recharge.successSub": "आपके बैलेंस में जोड़ा गया",
  "recharge.failedTitle": "भुगतान असफल",
  "recharge.failed.expired": "ऑर्डर समाप्त हो गया।",
  "recharge.failed.cancelled": "ऑर्डर रद्द कर दिया गया।",
  "recharge.failed.provider": "Provider ने failure रिपोर्ट की।",
  "recharge.error.amount": "सही राशि डालें",
  "recharge.error.create": "ऑर्डर बनाने में विफल",
  "recharge.error.network": "नेटवर्क एरर — फिर कोशिश करें",

  // ---- Withdrawal ----
  "withdrawal.title": "निकासी",
  "withdrawal.wagerHint": "निकालने से पहले रिचार्ज को बेट के ज़रिए wagering complete करना ज़रूरी है।",
  "withdrawal.tab.bank": "बैंक (INR)",
  "withdrawal.tab.usdt": "USDT (TRC20)",
  "withdrawal.bankUnavailable": "बैंक निकासी अभी उपलब्ध नहीं है। USDT (TRC20) चालू है।",
  "withdrawal.form.bankAccount": "अकाउंट नंबर",
  "withdrawal.form.bankAccount.ph": "9-18 अंक",
  "withdrawal.form.ifsc": "IFSC कोड",
  "withdrawal.form.ifsc.ph": "जैसे SBIN0001234",
  "withdrawal.form.holder": "खाताधारक का नाम (बैंक रिकॉर्ड के अनुसार)",
  "withdrawal.form.holder.ph": "पूरा नाम",
  "withdrawal.form.amountInr": "राशि (INR)",
  "withdrawal.form.amountUsdt": "राशि (USDT)",
  "withdrawal.form.trc20": "TRC20 USDT एड्रेस",
  "withdrawal.rateLocked": "Submit पर रेट लॉक:",
  "withdrawal.summary.youReceive": "आपको मिलेगा",
  "withdrawal.summary.fee": "फ़ीस",
  "withdrawal.summary.total": "बैलेंस से कुल कटौती",
  "withdrawal.cta.insufficient": "निकालने योग्य राशि कम है",
  "withdrawal.cta.min": "न्यूनतम",
  "withdrawal.cta.withdraw": "निकालें",
  "withdrawal.submitting": "Submit कर रहे हैं…",
  "withdrawal.review.title": "समीक्षा में",
  "withdrawal.review.body": "की हमारी टीम समीक्षा कर रही है। आमतौर पर 24 घंटे में पूरा हो जाता है।",
  "withdrawal.queued.title": "निकासी queue में",
  "withdrawal.queued.body": "प्रोसेस की जा रही है।",
  "withdrawal.orderMeta": "ऑर्डर",
  "withdrawal.status": "स्थिति",
  "withdrawal.cancel": "निकासी रद्द करें",
  "withdrawal.successTitle": "निकासी पूर्ण",
  "withdrawal.successSub": "सफलतापूर्वक भेजा गया।",
  "withdrawal.failedTitle": "निकासी",
  "withdrawal.failed.default": "Provider ने यह निकासी अस्वीकार की। आपका बैलेंस वापस कर दिया गया है।",
  "withdrawal.cancelled.by.you": "आपने रद्द किया",
  "withdrawal.method.bank": "बैंक ट्रांसफ़र",
  "withdrawal.method.usdt": "USDT निकासी",
};

export default hi;
