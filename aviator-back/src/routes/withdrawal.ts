import { Router, Request, Response } from "express";
import { randomUUID } from "crypto";
import { WithdrawalOrderModel, WithdrawalStatus } from "../db/models/WithdrawalOrder";
import { UserModel } from "../db/models/User";
import { requireAuth } from "../middleware/requireAuth";
import { engine } from "../game/engine";
import { pushToUser, pushUserMyInfo } from "../sockets";
import { getSetting } from "../settings";
import { getUsdtInrRate } from "../payment/pricer";
import { getHotWalletBalance } from "../payment/hotWallet";
import {
  getPayoutProvider,
  defaultPayoutProvider,
} from "../payment/payouts";
import { getChannelByCode, getDefaultChannel } from "../payment/channels";
import { webhookGuard } from "../payment/webhookLog";
import { recordPayout, resolveChannelCodeForOrder } from "../payment/ledger";
import { autoBroadcastUsdtWithdrawal } from "../payment/walletOps";

export const withdrawalRouter = Router();

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

const IFSC_RE = /^[A-Z]{4}0[A-Z0-9]{6}$/;
const BANK_ACCT_RE = /^\d{9,18}$/;
const TRC20_RE = /^T[1-9A-HJ-NP-Za-km-z]{33}$/;

const validateBank = (b: { bankAccount?: string; ifsc?: string; holderName?: string }): string | null => {
  const acct = (b.bankAccount || "").replace(/\s/g, "");
  const ifsc = (b.ifsc || "").trim().toUpperCase();
  const holder = (b.holderName || "").trim();
  if (!BANK_ACCT_RE.test(acct)) return "Bank account must be 9-18 digits";
  if (!IFSC_RE.test(ifsc)) return "Invalid IFSC code (e.g. SBIN0001234)";
  if (holder.length < 2 || holder.length > 60) return "Holder name 2-60 chars";
  if (!/^[A-Za-z .'-]+$/.test(holder)) return "Holder name letters/spaces only";
  return null;
};

const validateUsdt = (u: { trc20Address?: string }): string | null => {
  const a = (u.trc20Address || "").trim();
  if (!TRC20_RE.test(a)) return "Invalid TRC20 address (must start with T, 34 chars)";
  return null;
};

// ---------------------------------------------------------------------------
// View helper
// ---------------------------------------------------------------------------

const orderToClient = (o: any) => ({
  orderId: o.orderId,
  method: o.method,
  status: o.status,
  grossAmount: o.grossAmount,
  feeAmount: o.feeAmount,
  totalDebitInr: o.totalDebitInr,
  bankAccount: o.bankAccount ? `****${o.bankAccount.slice(-4)}` : undefined,
  ifsc: o.ifsc,
  holderName: o.holderName,
  trc20Address: o.trc20Address,
  fxRate: o.fxRate,
  txHash: o.txHash,
  failedReason: o.failedReason,
  createdAt: o.createdAt,
  paidAt: o.paidAt,
  failedAt: o.failedAt,
});

// ---------------------------------------------------------------------------
// GET /api/withdrawal/quote — preview fees & withdrawable
// ---------------------------------------------------------------------------
withdrawalRouter.get("/quote", requireAuth, async (req: Request, res: Response) => {
  const userName = req.authUserName!;
  const user = await UserModel.findOne({ userName }).lean();
  if (!user) return res.status(404).json({ status: false, message: "User not found" });

  const fee = Number(getSetting("withdrawalFeePct") || 0);
  const min = Number(getSetting("withdrawalMinInr") || 0);
  const balance = +(user.balance || 0).toFixed(2);
  const wager = +(user.wagerRequired || 0).toFixed(2);
  const withdrawable = Math.max(0, +(balance - wager).toFixed(2));

  // Max gross = withdrawable / (1 + fee). We deduct gross+fee from balance.
  const maxGross = +(withdrawable / (1 + fee)).toFixed(2);

  let usdtRate: number | null = null;
  try {
    const q = await getUsdtInrRate();
    usdtRate = q.rate;
  } catch { /* ignore */ }

  res.json({
    status: true,
    data: {
      balance,
      wagerRequired: wager,
      withdrawable,
      feePct: fee,
      minInr: min,
      maxGrossInr: Math.max(0, maxGross),
      usdtInrRate: usdtRate,
      // Channel availability — frontend hides Bank tab when off so users
      // don't fill the form just to hit 403. Same setting that gates INR
      // recharge; flipping it on re-enables both bank withdrawal AND fiat
      // top-up at the same time.
      bankEnabled: Number(getSetting("inrRechargeEnabled") || 0) === 1,
    },
  });
});

// ---------------------------------------------------------------------------
// POST /api/withdrawal/create — initiate withdrawal
//
// Body:
//   method: "bank" | "usdt"
//   amount: number              // gross amount; recipient receives this
//   bankAccount, ifsc, holderName  (when method=bank)
//   trc20Address                   (when method=usdt; amount is in USDT)
//
// Money flow:
//   • bank: amount = INR recipient receives. Fee = amount * feePct.
//           totalDebitInr = amount + fee.
//   • usdt: amount = USDT recipient receives. Convert to INR via locked
//           fxRate. Fee = (usdt*fxRate) * feePct.
//           totalDebitInr = (usdt*fxRate) + fee.
// ---------------------------------------------------------------------------
withdrawalRouter.post("/create", requireAuth, async (req: Request, res: Response) => {
  const userName = req.authUserName!;
  const method: string = req.body?.method;
  const amount = Number(req.body?.amount);

  if (!["bank", "usdt"].includes(method)) {
    return res.status(400).json({ status: false, message: "method must be 'bank' or 'usdt'" });
  }
  if (!isFinite(amount) || amount <= 0) {
    return res.status(400).json({ status: false, message: "Invalid amount" });
  }

  // INR channel gate — same setting controls fiat recharge AND bank payout.
  // Off until a real Indian payout provider (Razorpay / Cashfree) is wired in.
  if (method === "bank" && Number(getSetting("inrRechargeEnabled") || 0) !== 1) {
    return res.status(403).json({
      status: false,
      message: "Bank withdrawals are temporarily unavailable. Please use USDT withdrawal.",
    });
  }

  const feePct = Number(getSetting("withdrawalFeePct") || 0);
  const minInr = Number(getSetting("withdrawalMinInr") || 0);

  let grossInr: number;     // amount of INR equivalent the user is taking out
  let feeAmount: number;    // INR fee on top
  let totalDebitInr: number;
  let fxRate: number | undefined;

  if (method === "bank") {
    const err = validateBank(req.body);
    if (err) return res.status(400).json({ status: false, message: err });
    // Bank gross is rounded to integer rupees — Payme rejects decimal
    // order_amount, and the user-facing INR amount is always integer
    // anyway (presets are whole-rupee).
    grossInr = Math.round(amount);
    if (grossInr < minInr) {
      return res.status(400).json({ status: false, message: `Minimum withdrawal is ₹${minInr}` });
    }
    feeAmount = +(grossInr * feePct).toFixed(2);
    totalDebitInr = +(grossInr + feeAmount).toFixed(2);
  } else {
    const err = validateUsdt(req.body);
    if (err) return res.status(400).json({ status: false, message: err });
    const rateQ = await getUsdtInrRate();
    fxRate = rateQ.rate;
    // USDT amount can be fractional (e.g. 5.5 USDT), but INR equivalent
    // we record + compare to thresholds should be integer.
    grossInr = Math.round(amount * fxRate);
    if (grossInr < minInr) {
      return res.status(400).json({
        status: false,
        message: `Minimum withdrawal is ₹${minInr} (≈ ${(minInr / fxRate).toFixed(2)} USDT)`,
      });
    }
    feeAmount = +(grossInr * feePct).toFixed(2);
    totalDebitInr = +(grossInr + feeAmount).toFixed(2);
  }

  // 1 pending withdrawal at a time per user — keeps the model simple and
  // prevents accidental double-submits.
  const existingPending = await WithdrawalOrderModel.findOne({
    userName,
    status: { $in: ["pending", "processing", "manual_queue", "review"] },
  });
  if (existingPending) {
    return res.status(409).json({
      status: false,
      message: "You already have a pending withdrawal. Cancel it first or wait for it to settle.",
    });
  }

  // Atomically reserve balance + check withdrawable >= totalDebitInr
  const reserved = await engine.reserveForWithdrawal(userName, totalDebitInr, grossInr);
  if (!reserved) {
    // Determine which reason for clearer UX
    const u = await UserModel.findOne({ userName }).lean();
    const balance = +(u?.balance || 0).toFixed(2);
    const wager = +(u?.wagerRequired || 0).toFixed(2);
    const withdrawable = Math.max(0, +(balance - wager).toFixed(2));
    return res.status(400).json({
      status: false,
      message:
        withdrawable < totalDebitInr
          ? `Insufficient withdrawable balance. You have ₹${withdrawable} (₹${wager} locked behind playthrough); withdrawal needs ₹${totalDebitInr}.`
          : "Insufficient balance",
    });
  }

  const orderId = randomUUID();

  // ── Channel / provider resolution ──
  // Bank: try channel registry first (admin can configure Payme / others per country).
  // USDT: stays on the on-chain path; provider here is "mock" since payouts.ts always returns mock for usdt.
  // Explicit body.channelCode wins for both.
  const explicitChannelCode: string | undefined = req.body?.channelCode;
  let providerName: string;
  let provider: ReturnType<typeof getPayoutProvider> = null;
  let channelCode: string | undefined;

  if (method === "bank") {
    if (explicitChannelCode) {
      const ch = await getChannelByCode(explicitChannelCode);
      if (!ch || !ch.payout) {
        return res.status(400).json({ status: false, message: `Channel "${explicitChannelCode}" not found or doesn't support payout` });
      }
      provider = ch.payout;
      providerName = ch.doc.provider;
      channelCode = ch.doc.code;
    } else {
      const def = await getDefaultChannel("IN", "payout");
      if (def && def.payout) {
        provider = def.payout;
        providerName = def.doc.provider;
        channelCode = def.doc.code;
      } else {
        providerName = defaultPayoutProvider("bank");
        provider = getPayoutProvider(providerName);
      }
    }
  } else {
    providerName = defaultPayoutProvider("usdt");
    provider = getPayoutProvider(providerName);
  }

  // ── Risk review (Layer 5) ──
  // Auto-flag for admin review if (a) gross amount above threshold, OR
  // (b) account younger than threshold. 0 in either setting disables it.
  const reviewAbove = Number(getSetting("withdrawalReviewAboveInr") || 0);
  const reviewNewAccountHrs = Number(getSetting("withdrawalReviewNewAccountHours") || 0);
  let needsReview = false;
  let reviewReason = "";
  if (reviewAbove > 0 && grossInr >= reviewAbove) {
    needsReview = true;
    reviewReason = `Amount ≥ ₹${reviewAbove}`;
  }
  if (!needsReview && reviewNewAccountHrs > 0) {
    const u = await UserModel.findOne({ userName }).select("createdAt").lean();
    if (u) {
      const ageHrs = (Date.now() - new Date(u.createdAt).getTime()) / 3_600_000;
      if (ageHrs < reviewNewAccountHrs) {
        needsReview = true;
        reviewReason = `Account ${ageHrs.toFixed(1)}h old (< ${reviewNewAccountHrs}h)`;
      }
    }
  }

  // For USDT, check hot wallet liquidity — if short, status = manual_queue
  // and admin must top up + then mark paid manually.
  let initialStatus: WithdrawalStatus = "pending";
  let providerRef: string | undefined;

  if (needsReview) {
    // Hold the order — DO NOT call provider. Admin must Approve first.
    initialStatus = "review";
  } else try {
    if (method === "usdt") {
      const hot = await getHotWalletBalance();
      if (!hot || hot.usdtBalance < amount) {
        initialStatus = "manual_queue";
      } else {
        const r = await provider!.createPayout({
          orderId,
          userName,
          method: "usdt",
          grossAmount: amount, // usdt
          trc20Address: req.body.trc20Address.trim(),
        });
        providerRef = r.providerRef;
        initialStatus = r.status;
      }
    } else {
      const r = await provider!.createPayout({
        orderId,
        userName,
        method: "bank",
        grossAmount: grossInr,
        bankAccount: String(req.body.bankAccount).replace(/\s/g, ""),
        ifsc: String(req.body.ifsc).trim().toUpperCase(),
        holderName: String(req.body.holderName).trim(),
      });
      providerRef = r.providerRef;
      initialStatus = r.status;
    }
  } catch (e) {
    // Provider blew up — refund and bail
    await engine.refundWithdrawal(userName, totalDebitInr);
    return res.status(502).json({
      status: false,
      message: `Payout provider error: ${e instanceof Error ? e.message : String(e)}`,
    });
  }

  const doc = await WithdrawalOrderModel.create({
    orderId,
    userName,
    method,
    grossAmount: method === "bank" ? grossInr : amount,
    feeAmount,
    totalDebitInr,
    bankAccount: method === "bank" ? String(req.body.bankAccount).replace(/\s/g, "") : undefined,
    ifsc: method === "bank" ? String(req.body.ifsc).trim().toUpperCase() : undefined,
    holderName: method === "bank" ? String(req.body.holderName).trim() : undefined,
    trc20Address: method === "usdt" ? String(req.body.trc20Address).trim() : undefined,
    fxRate,
    status: initialStatus,
    provider: providerName,
    providerRef,
    balanceAfter: reserved.balance,
    meta: {
      ...(needsReview ? { reviewReason } : {}),
      ...(channelCode ? { channelCode } : {}),
    },
  });

  pushToUser(userName, "withdrawalUpdate", {
    orderId: doc.orderId,
    status: doc.status,
    balance: reserved.balance,
  });
  pushUserMyInfo(userName);

  // ── Auto-payout (USDT only, fire-and-forget) ──
  // Conditions:
  //   • method === "usdt"
  //   • status === "processing" (not review/manual_queue)
  //   • setting usdtAutoPayoutEnabled = 1
  //   • amount in INR < usdtAutoPayoutMaxInr (0 disables cap)
  // Failures fall back to manual_queue + push the user the new status.
  if (doc.method === "usdt" && doc.status === "processing") {
    const autoOn = Number(getSetting("usdtAutoPayoutEnabled") || 0) === 1;
    const maxInr = Number(getSetting("usdtAutoPayoutMaxInr") || 0);
    const orderInr = grossInr; // already INR equivalent of the USDT amount
    const underCap = maxInr === 0 || orderInr < maxInr;
    if (autoOn && underCap) {
      // Don't await — user already has their HTTP response; broadcast
      // fires in background and pushes withdrawalUpdate via socket.
      autoBroadcastUsdtWithdrawal(doc.orderId).catch((e) => {
        console.error(`[auto-payout] order ${doc.orderId} threw:`, e);
      });
    }
  }

  res.json({ status: true, data: orderToClient(doc) });
});

// ---------------------------------------------------------------------------
// GET /api/withdrawal/orders — recent for current user
// ---------------------------------------------------------------------------
withdrawalRouter.get("/orders", requireAuth, async (req: Request, res: Response) => {
  const userName = req.authUserName!;
  const orders = await WithdrawalOrderModel.find({ userName })
    .sort({ createdAt: -1 })
    .limit(20)
    .lean();
  res.json({ status: true, data: orders.map(orderToClient) });
});

// ---------------------------------------------------------------------------
// POST /api/withdrawal/cancel/:orderId — user cancels (only if pending/manual_queue)
// ---------------------------------------------------------------------------
/**
 * POST /api/withdrawal/webhook/:key — provider callback. PUBLIC (sig-verified).
 *
 * :key is either a channel code (new path, looks up channel's payout
 * provider) or a legacy provider name (mock / payme — pre-channel routing).
 *
 * Channel route is preferred because each channel has its own secret key.
 */
withdrawalRouter.post("/webhook/:key", async (req: Request, res: Response) => {
  const key = req.params.key;
  const ch = await getChannelByCode(key, { allowDisabled: true });
  const isChannel = !!ch?.payout;
  const legacy = isChannel ? null : getPayoutProvider(key);

  if (!isChannel && !legacy) {
    return res.status(404).json({ status: false, message: "Unknown provider/channel" });
  }

  await webhookGuard(
    req, res,
    { channelCode: isChannel ? key : undefined, direction: "payout" },
    async () => {
      const rawBody = JSON.stringify(req.body);
      const v = isChannel
        ? ch!.payout!.verifyWebhook(req.headers as Record<string, unknown>, rawBody)
        : legacy!.verifyWebhook(req.headers as Record<string, unknown>, rawBody);

      const orderNo = String((req.body?.transdata?.order_no || req.body?.order_no || "")).slice(0, 64);
      const platOrderNo = v.providerRef || "";
      const orderStatus = String((req.body?.transdata?.order_status || req.body?.order_status || "")).slice(0, 32);

      if (!v.ok || !v.providerRef) {
        return {
          outcome: "rejected-sig" as const,
          orderNo, platOrderNo, orderStatus,
          responseStatus: 400,
          responseBody: JSON.stringify({ status: false, message: v.failedReason || "verification failed" }),
          responseContentType: "json" as const,
          note: v.failedReason,
        };
      }

      const order = await WithdrawalOrderModel.findOne({ providerRef: v.providerRef });
      if (!order) {
        return {
          outcome: "order-not-found" as const,
          orderNo, platOrderNo, orderStatus,
          responseStatus: 404,
          responseBody: JSON.stringify({ status: false, message: "Order not found for providerRef" }),
          responseContentType: "json" as const,
        };
      }

      if (v.status === "paid") {
        const flipped = await WithdrawalOrderModel.findOneAndUpdate(
          { providerRef: v.providerRef, status: { $in: ["pending", "processing", "manual_queue"] } },
          { $set: { status: "paid", paidAt: new Date() } },
          { new: true },
        );
        if (flipped) {
          // eslint-disable-next-line @typescript-eslint/no-var-requires
          const { triggerReferralReward } = require("../payment/referral");
          await triggerReferralReward(order.userName, {
            type: "payout",
            id: order.providerRef || order.orderId,
            amountInr: order.method === "bank" ? order.grossAmount : order.grossAmount * (order.fxRate || 1),
          });
          pushToUser(order.userName, "withdrawalUpdate", { orderId: order.orderId, status: "paid" });
          pushUserMyInfo(order.userName);
          // Ledger debit on the channel (principal + gateway fee row).
          if (flipped.method === "bank") {
            const chCode = await resolveChannelCodeForOrder(flipped);
            if (chCode) {
              try {
                await recordPayout({
                  channelCode: chCode,
                  orderId: flipped.orderId,
                  providerRef: flipped.providerRef,
                  grossInr: flipped.grossAmount,
                });
              } catch (e) {
                console.error("[withdrawal] ledger recordPayout failed:", (e as Error).message);
              }
            }
          }
        }
        return {
          outcome: "ok-paid" as const,
          orderNo, platOrderNo, orderStatus,
          responseStatus: 200,
          responseBody: "success",
          responseContentType: "text" as const,
        };
      }

      // failed
      const flipped = await WithdrawalOrderModel.findOneAndUpdate(
        { providerRef: v.providerRef, status: { $in: ["pending", "processing", "manual_queue"] } },
        { $set: { status: "failed", failedAt: new Date(), failedReason: v.failedReason || "Provider reported failure" } },
        { new: true },
      );
      if (flipped) {
        await engine.refundWithdrawal(order.userName, order.totalDebitInr);
        pushToUser(order.userName, "withdrawalUpdate", { orderId: order.orderId, status: "failed", failedReason: flipped.failedReason });
        pushUserMyInfo(order.userName);
      }
      return {
        outcome: "ok-failed" as const,
        orderNo, platOrderNo, orderStatus,
        responseStatus: 200,
        responseBody: "success",
        responseContentType: "text" as const,
      };
    },
  );
});

withdrawalRouter.post("/cancel/:orderId", requireAuth, async (req: Request, res: Response) => {
  const userName = req.authUserName!;
  const order = await WithdrawalOrderModel.findOne({
    orderId: req.params.orderId,
    userName,
  });
  if (!order) return res.status(404).json({ status: false, message: "Order not found" });
  if (!["pending", "manual_queue", "review"].includes(order.status)) {
    return res.status(400).json({
      status: false,
      message: `Cannot cancel — order is already ${order.status}`,
    });
  }
  // Atomic state flip; if status changed beneath us, refuse the refund.
  const flipped = await WithdrawalOrderModel.findOneAndUpdate(
    { orderId: order.orderId, status: { $in: ["pending", "manual_queue", "review"] } },
    { $set: { status: "cancelled", cancelledAt: new Date() } },
    { new: true },
  );
  if (!flipped) {
    return res.status(409).json({ status: false, message: "Order state changed; refresh" });
  }
  await engine.refundWithdrawal(userName, order.totalDebitInr);
  pushToUser(userName, "withdrawalUpdate", { orderId: order.orderId, status: "cancelled" });
  pushUserMyInfo(userName);
  res.json({ status: true, data: orderToClient(flipped) });
});
