import { Router, Request, Response } from "express";
import { randomUUID } from "crypto";
import { CryptoOrderModel, CryptoOrderDoc } from "../db/models/CryptoOrder";
import { requireAuth } from "../middleware/requireAuth";
import { config } from "../config";
import { getUsdtInrRate } from "../payment/pricer";
import { pushToUser } from "../sockets";
import { allocateAddress } from "../payment/wallet";
import { allocateEvmAddress } from "../payment/evmWallet";
import { getEvmChain, isEvmChain, enabledEvmChains } from "../payment/evmChains";
import { getSetting } from "../settings";

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

  // Admin toggle gate — operator can disable USDT deposits without a redeploy.
  if (Number(getSetting("cryptoRechargeEnabled") || 0) !== 1) {
    return res.status(403).json({
      status: false,
      message: "USDT recharge is temporarily unavailable. Please try again later or use INR.",
    });
  }

  const network: string = (req.body?.network || config.tronNetwork || "").trim();
  const isEvm = isEvmChain(network);

  let contractAddress: string;
  if (isEvm) {
    const chain = getEvmChain(network);
    const enabled = enabledEvmChains().some((c) => c.key === network);
    if (!chain || !enabled) {
      return res.status(503).json({
        status: false,
        message: `${network} deposits are not enabled.`,
      });
    }
    if (!config.cryptoMasterMnemonic) {
      return res.status(503).json({
        status: false,
        message: "Master wallet not configured. Generate via `node dist/tools/gen-master-seed.js`.",
      });
    }
    contractAddress = chain.usdtContract;
  } else {
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
    contractAddress = config.tronContract;
  }

  if (!amountInr || amountInr <= 0) {
    return res.status(400).json({ status: false, message: "Invalid amount" });
  }

  const quote = await getUsdtInrRate();
  const amountUsdt = +(amountInr / quote.rate).toFixed(2);

  if (amountUsdt < getSetting("cryptoMinUsdt")) {
    return res.status(400).json({
      status: false,
      message: `Minimum recharge is ${getSetting("cryptoMinUsdt")} USDT (~${(getSetting("cryptoMinUsdt") * quote.rate).toFixed(2)} INR)`,
    });
  }
  if (amountUsdt > getSetting("cryptoMaxUsdt")) {
    return res.status(400).json({
      status: false,
      message: `Maximum recharge is ${getSetting("cryptoMaxUsdt")} USDT`,
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

  // Allocate (or recycle) a deposit address. Recycles if a past order's
  // cooldown has elapsed; otherwise derives a fresh index. Hugely cuts
  // sweep gas over time vs allocating a brand-new address every order.
  const acct = isEvm ? await allocateEvmAddress(network) : await allocateAddress();

  const orderId = randomUUID();
  const expiresAt = new Date(Date.now() + config.cryptoOrderTtlMs);

  const doc = await CryptoOrderModel.create({
    orderId,
    userName,
    amountUsdt,
    amountInr: +(amountUsdt * quote.rate).toFixed(2),
    fxRate: quote.rate,
    fxRateAt: quote.fetchedAt,
    network: isEvm ? network : config.tronNetwork,
    depositAddress: acct.address,
    derivIndex: acct.index,
    contractAddress,
    status: "pending",
    expiresAt,
    meta: { rateSource: quote.source, derivPath: acct.path },
  });

  res.json({
    status: true,
    data: {
      ...orderToClient(doc),
      rateSource: quote.source,
      minUsdt: getSetting("cryptoMinUsdt"),
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
