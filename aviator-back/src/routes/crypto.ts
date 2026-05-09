import { Router, Request, Response } from "express";
import { randomUUID } from "crypto";
import { CryptoOrderModel, CryptoOrderDoc } from "../db/models/CryptoOrder";
import { requireAuth } from "../middleware/requireAuth";
import { config } from "../config";
import { getUsdtInrRate } from "../payment/pricer";
import { pushToUser } from "../sockets";

export const cryptoRouter = Router();

const orderToClient = (o: CryptoOrderDoc) => ({
  orderId: o.orderId,
  amountUsdt: o.amountUsdt,
  amountInr: o.amountInr,
  fxRate: o.fxRate,
  network: o.network,
  receiver: o.receiver,
  contractAddress: o.contractAddress,
  status: o.status,
  txHash: o.txHash,
  createdAt: o.createdAt,
  expiresAt: o.expiresAt,
  paidAt: o.paidAt,
});

const expireIfNeeded = async (
  doc: CryptoOrderDoc,
): Promise<CryptoOrderDoc> => {
  if (doc.status === "pending" && doc.expiresAt < new Date()) {
    doc.status = "expired";
    await doc.save();
  }
  return doc;
};

// ---------------------------------------------------------------------------
// POST /api/crypto/create — initiate a USDT-TRC20 top-up
// ---------------------------------------------------------------------------
cryptoRouter.post("/create", requireAuth, async (req: Request, res: Response) => {
  const userName = req.authUserName!;
  const amountInr = Number(req.body?.amountInr);

  if (!config.tronNetwork || !config.tronReceiver || !config.tronContract) {
    return res.status(503).json({
      status: false,
      message:
        "Crypto recharge not configured. Set TRON_NETWORK + TRON_USDT_RECEIVER + TRON_USDT_CONTRACT.",
    });
  }

  if (!amountInr || amountInr <= 0) {
    return res.status(400).json({ status: false, message: "Invalid amount" });
  }

  const quote = await getUsdtInrRate();
  const amountUsdtRaw = amountInr / quote.rate;
  // USDT has 6 decimals on TRC20; clamp to that resolution.
  const amountUsdt = +amountUsdtRaw.toFixed(2);

  if (amountUsdt < config.cryptoMinUsdt) {
    return res.status(400).json({
      status: false,
      message: `Minimum recharge is ${config.cryptoMinUsdt} USDT (~${(config.cryptoMinUsdt * quote.rate).toFixed(2)} INR)`,
    });
  }
  if (amountUsdt > config.cryptoMaxUsdt) {
    return res.status(400).json({
      status: false,
      message: `Maximum recharge is ${config.cryptoMaxUsdt} USDT`,
    });
  }

  // Limit pending crypto orders so we don't pile up matches.
  const pending = await CryptoOrderModel.countDocuments({
    userName,
    status: "pending",
    expiresAt: { $gt: new Date() },
  });
  if (pending >= 3) {
    return res.status(429).json({
      status: false,
      message: "Too many pending crypto orders. Cancel one or wait for expiry.",
    });
  }

  const orderId = randomUUID();
  const expiresAt = new Date(Date.now() + config.cryptoOrderTtlMs);

  const doc = await CryptoOrderModel.create({
    orderId,
    userName,
    amountUsdt,
    amountInr: +(amountUsdt * quote.rate).toFixed(2),
    fxRate: quote.rate,
    fxRateAt: quote.fetchedAt,
    network: config.tronNetwork,
    receiver: config.tronReceiver,
    contractAddress: config.tronContract,
    status: "pending",
    expiresAt,
    meta: { rateSource: quote.source },
  });

  res.json({
    status: true,
    data: {
      ...orderToClient(doc),
      rateSource: quote.source,
      minConfirmations: config.cryptoMinConfirmations,
    },
  });
});

// ---------------------------------------------------------------------------
// GET /api/crypto/status/:orderId — poll status (owner only)
// ---------------------------------------------------------------------------
cryptoRouter.get("/status/:orderId", requireAuth, async (req: Request, res: Response) => {
  const userName = req.authUserName!;
  const order = await CryptoOrderModel.findOne({ orderId: req.params.orderId });
  if (!order || order.userName !== userName) {
    return res.status(404).json({ status: false, message: "Order not found" });
  }
  await expireIfNeeded(order);
  res.json({ status: true, data: orderToClient(order) });
});

// ---------------------------------------------------------------------------
// GET /api/crypto/orders — recent orders for the logged-in user
// ---------------------------------------------------------------------------
cryptoRouter.get("/orders", requireAuth, async (req: Request, res: Response) => {
  const userName = req.authUserName!;
  const orders = await CryptoOrderModel.find({ userName })
    .sort({ createdAt: -1 })
    .limit(20)
    .lean();
  res.json({
    status: true,
    data: orders.map((o) => ({
      orderId: o.orderId,
      amountUsdt: o.amountUsdt,
      amountInr: o.amountInr,
      status: o.status,
      network: o.network,
      txHash: o.txHash,
      createdAt: o.createdAt,
      paidAt: o.paidAt,
    })),
  });
});

// ---------------------------------------------------------------------------
// POST /api/crypto/cancel/:orderId — user cancels a pending order
// ---------------------------------------------------------------------------
cryptoRouter.post("/cancel/:orderId", requireAuth, async (req: Request, res: Response) => {
  const userName = req.authUserName!;
  const updated = await CryptoOrderModel.findOneAndUpdate(
    { orderId: req.params.orderId, userName, status: "pending" },
    { $set: { status: "cancelled" } },
    { new: true },
  );
  if (!updated) {
    return res.status(404).json({ status: false, message: "Order not found or not pending" });
  }
  pushToUser(userName, "rechargeUpdate", {
    orderId: updated.orderId,
    status: "cancelled",
    source: "crypto",
  });
  res.json({ status: true, data: orderToClient(updated) });
});
