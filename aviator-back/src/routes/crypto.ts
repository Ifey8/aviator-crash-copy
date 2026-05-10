import { Router, Request, Response } from "express";
import { randomUUID } from "crypto";
import { CryptoOrderModel, CryptoOrderDoc } from "../db/models/CryptoOrder";
import { requireAuth } from "../middleware/requireAuth";
import { config } from "../config";
import { getUsdtInrRate } from "../payment/pricer";
import { pushToUser } from "../sockets";
import { allocNextDepositIndex, deriveAccount } from "../payment/wallet";

export const cryptoRouter = Router();

const orderToClient = (o: CryptoOrderDoc) => ({
  orderId: o.orderId,
  amountUsdt: o.amountUsdt,
  amountInr: o.amountInr,
  fxRate: o.fxRate,
  network: o.network,
  depositAddress: o.depositAddress,
  contractAddress: o.contractAddress,
  status: o.status,
  txHash: o.txHash,
  actualUsdt: o.actualUsdt,
  actualInr: o.actualInr,
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
// Returns a UNIQUE deposit address; user can send any USDT amount to it.
// ---------------------------------------------------------------------------
cryptoRouter.post("/create", requireAuth, async (req: Request, res: Response) => {
  const userName = req.authUserName!;
  const amountInr = Number(req.body?.amountInr);

  if (!config.tronNetwork || !config.tronContract) {
    return res.status(503).json({
      status: false,
      message: "Crypto recharge not configured. Set TRON_NETWORK + TRON_USDT_CONTRACT.",
    });
  }
  if (!config.cryptoMasterMnemonic) {
    return res.status(503).json({
      status: false,
      message: "Master wallet not configured. Generate via `node dist/tools/gen-master-seed.js`.",
    });
  }

  if (!amountInr || amountInr <= 0) {
    return res.status(400).json({ status: false, message: "Invalid amount" });
  }

  const quote = await getUsdtInrRate();
  const amountUsdt = +(amountInr / quote.rate).toFixed(2);

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

  // Allocate fresh deposit address for this order. Atomic counter ensures
  // every concurrent createOrder gets a unique index.
  const derivIndex = await allocNextDepositIndex();
  const acct = deriveAccount(derivIndex);

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
    depositAddress: acct.address,
    derivIndex: acct.index,
    contractAddress: config.tronContract,
    status: "pending",
    expiresAt,
    meta: { rateSource: quote.source, derivPath: acct.path },
  });

  res.json({
    status: true,
    data: {
      ...orderToClient(doc),
      rateSource: quote.source,
      minUsdt: config.cryptoMinUsdt,
    },
  });
});

// ---------------------------------------------------------------------------
// GET /api/crypto/status/:orderId
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
// GET /api/crypto/orders
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
      actualUsdt: o.actualUsdt,
      amountInr: o.amountInr,
      actualInr: o.actualInr,
      status: o.status,
      network: o.network,
      depositAddress: o.depositAddress,
      txHash: o.txHash,
      createdAt: o.createdAt,
      paidAt: o.paidAt,
    })),
  });
});

// ---------------------------------------------------------------------------
// POST /api/crypto/cancel/:orderId
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
