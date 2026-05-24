/**
 * English copy. KEEP KEYS SORTED BY SECTION so en.ts/hi.ts diff cleanly.
 * Source-of-truth for keys — Hindi must mirror these. Missing keys fall back
 * to the English string (see ../i18n/index.ts).
 */
const en = {
  // ---- Header ----
  "header.add": "+ ADD",
  "header.offline": "offline",
  "header.out": "⊖ OUT",
  "header.share": "SHARE & EARN",

  // ---- BetCard tabs ----
  "bet.tab.bet": "Bet",
  "bet.tab.auto": "Auto",
  "bet.autoTarget": "Auto cashout target",

  // ---- BetCard CTAs ----
  "cta.bet": "BET",
  "cta.autoBet": "AUTO BET",
  "cta.cashOut": "CASH OUT",
  "cta.cashedOut": "CASHED OUT",
  "cta.betPlaced": "BET PLACED",
  "cta.nextBet": "NEXT BET",
  "cta.queued": "QUEUED ✓",

  // ---- AUTO ON pill ----
  "auto.on": "AUTO ON",
  "auto.stop": "✕ Stop",

  // ---- Common ----
  "common.close": "Close",
  "common.done": "Done",
  "common.tryAgain": "Try again",
  "common.cancel": "Cancel",

  // ---- Account sheet ----
  "account.balance.total": "Total balance",
  "account.balance.locked": "Locked (playthrough)",
  "account.balance.withdrawable": "Withdrawable",
  "account.adminPanel": "⚙ Admin panel",
  "account.signOut": "Sign out",
  "account.signOutConfirm": "Sign out?",
  "account.close": "Close",
  "account.language": "Language",

  // ---- Recharge ----
  "recharge.title": "Top up balance",
  "recharge.sub": "Choose an amount to add to your wallet.",
  "recharge.method.fiat": "UPI / Cards",
  "recharge.method.fiat.sub": "INR",
  "recharge.method.crypto": "USDT",
  "recharge.method.crypto.sub": "TRC-20",
  "recharge.inrUnavailable": "INR top-up is temporarily unavailable. USDT (TRC-20) is live.",
  "recharge.continue": "Continue",
  "recharge.fine.crypto": "Minimum 10 USDT · Live USDT/INR rate · Funds credit on 1 confirmation",
  "recharge.fine.fiat": "Minimum ₹100 · Maximum ₹50,000 · Funds usually arrive within 1 minute",
  "recharge.creating": "Creating order…",
  "recharge.pendingTitle": "Awaiting payment",
  "recharge.openPaymentPage": "Open payment page",
  "recharge.pendingHint": "If the payment page didn't open, tap the button above.",
  "recharge.expiresIn": "Expires in",
  "recharge.cancelOrder": "Cancel order",
  "recharge.successTitle": "Recharge complete",
  "recharge.successSub": "added to your balance",
  "recharge.failedTitle": "Payment unsuccessful",
  "recharge.failed.expired": "The order expired.",
  "recharge.failed.cancelled": "Order was cancelled.",
  "recharge.failed.provider": "Provider reported a failure.",
  "recharge.error.amount": "Enter a valid amount",
  "recharge.error.create": "Failed to create order",
  "recharge.error.network": "Network error — please try again",

  // ---- Withdrawal ----
  "withdrawal.title": "Withdraw funds",
  "withdrawal.wagerHint": "Recharges must be wagered through before they can be withdrawn.",
  "withdrawal.tab.bank": "Bank (INR)",
  "withdrawal.tab.usdt": "USDT (TRC20)",
  "withdrawal.bankUnavailable": "Bank withdrawals are temporarily unavailable. USDT (TRC20) is live.",
  "withdrawal.form.bankAccount": "Account number",
  "withdrawal.form.bankAccount.ph": "9-18 digits",
  "withdrawal.form.ifsc": "IFSC code",
  "withdrawal.form.ifsc.ph": "e.g. SBIN0001234",
  "withdrawal.form.holder": "Holder name (as on bank record)",
  "withdrawal.form.holder.ph": "Full name",
  "withdrawal.form.amountInr": "Amount (INR)",
  "withdrawal.form.amountUsdt": "Amount (USDT)",
  "withdrawal.form.trc20": "TRC20 USDT address",
  "withdrawal.rateLocked": "Rate locked at submit:",
  "withdrawal.summary.youReceive": "You receive",
  "withdrawal.summary.fee": "Fee",
  "withdrawal.summary.total": "Total deducted from balance",
  "withdrawal.cta.insufficient": "Insufficient withdrawable",
  "withdrawal.cta.min": "Min",
  "withdrawal.cta.withdraw": "Withdraw",
  "withdrawal.submitting": "Submitting…",
  "withdrawal.review.title": "Under review",
  "withdrawal.review.body": "is being reviewed by our team. Most reviews clear within 24 hours.",
  "withdrawal.queued.title": "Withdrawal queued",
  "withdrawal.queued.body": "is being processed.",
  "withdrawal.orderMeta": "Order",
  "withdrawal.status": "Status",
  "withdrawal.cancel": "Cancel withdrawal",
  "withdrawal.successTitle": "Withdrawal complete",
  "withdrawal.successSub": "sent successfully.",
  "withdrawal.failedTitle": "Withdrawal",
  "withdrawal.failed.default": "The provider rejected this withdrawal. Your balance has been refunded.",
  "withdrawal.cancelled.by.you": "Cancelled by you",
  "withdrawal.method.bank": "bank transfer",
  "withdrawal.method.usdt": "USDT withdrawal",
};

export type I18nKey = keyof typeof en;
export default en;
