import { config } from "../../config";
import { CryptoOrderModel, CryptoOrderDoc } from "../../db/models/CryptoOrder";
import { engine } from "../../game/engine";
import { pushToUser, pushUserMyInfo } from "../../sockets";

/**
 * TronProvider — polls TronGrid for incoming USDT-TRC20 transfers to the
 * configured receiver address, and matches them against pending CryptoOrders.
 *
 * Polling-based (not socket / event-stream) because TronGrid's free public
 * API doesn't offer a websocket and our throughput is tiny (a few orders/min
 * at most). 30s interval is plenty.
 *
 * Network selection driven by config.tronNetwork:
 *   "shasta"  → https://api.shasta.trongrid.io  (testnet)
 *   "mainnet" → https://api.trongrid.io
 *   ""        → provider disabled (no watcher started)
 *
 * MATCHING RULES (must all hold for a tx to be claimed by an order):
 *   1. tx.to === order.receiver
 *   2. tx.token_info.address === order.contractAddress (same USDT)
 *   3. tx.value (in 6-decimal smallest unit) === order.amountUsdt × 10^6
 *   4. tx.block_timestamp >= order.createdAt
 *   5. tx not already claimed (DB unique on txHash enforces this atomically)
 *
 * IDEMPOTENCY: marking paid uses findOneAndUpdate({status:"pending"}, ...) so
 * concurrent calls can't double-credit. The unique index on txHash ensures a
 * single tx can only ever claim one order.
 */

const SHASTA_BASE = "https://api.shasta.trongrid.io";
const MAINNET_BASE = "https://api.trongrid.io";

interface Trc20Tx {
  transaction_id: string;
  block_timestamp: number;
  from: string;
  to: string;
  /** Decimal string in smallest unit (USDT 6-decimals). */
  value: string;
  token_info: {
    symbol: string;
    address: string;
    decimals: number;
  };
}

const apiBase = (): string =>
  config.tronNetwork === "mainnet" ? MAINNET_BASE : SHASTA_BASE;

/** Convert USDT major units → smallest unit string. 10.5 → "10500000". */
const toSmallestUnit = (usdt: number): string =>
  Math.round(usdt * 1e6).toString();

/** Fetch incoming TRC20 transfers to receiver since `sinceMs`. */
const fetchIncoming = async (sinceMs: number): Promise<Trc20Tx[]> => {
  const url =
    `${apiBase()}/v1/accounts/${config.tronReceiver}/transactions/trc20` +
    `?contract_address=${config.tronContract}` +
    `&only_to=true` +
    `&min_timestamp=${sinceMs}` +
    `&limit=50` +
    `&order_by=block_timestamp,desc`;

  const headers: Record<string, string> = { accept: "application/json" };
  if (config.trongridApiKey) headers["TRON-PRO-API-KEY"] = config.trongridApiKey;

  const res = await fetch(url, {
    headers,
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) {
    console.warn(`[tron] TronGrid ${res.status} ${res.statusText}`);
    return [];
  }
  const json = (await res.json()) as { data?: Trc20Tx[] };
  return Array.isArray(json.data) ? json.data : [];
};

/** Atomic claim: pending order + valid tx → paid + balance credited. */
const claim = async (
  order: CryptoOrderDoc,
  tx: Trc20Tx,
): Promise<void> => {
  let updated: CryptoOrderDoc | null;
  try {
    updated = await CryptoOrderModel.findOneAndUpdate(
      { orderId: order.orderId, status: "pending" },
      {
        $set: {
          status: "paid",
          paidAt: new Date(),
          txHash: tx.transaction_id,
          fromAddress: tx.from,
          blockTimestamp: tx.block_timestamp,
          meta: { tx },
        },
      },
      { new: true },
    );
  } catch (e) {
    // Likely a duplicate-key error on txHash — another order claimed it.
    console.warn(`[tron] claim ${order.orderId} failed:`, (e as Error).message);
    return;
  }
  if (!updated) return; // someone else flipped pending → paid first

  const newBalance = await engine.creditBalance(order.userName, order.amountInr);
  if (newBalance != null) {
    updated.balanceAfter = newBalance;
    await updated.save();
  }

  pushToUser(order.userName, "rechargeUpdate", {
    orderId: order.orderId,
    status: "paid",
    amount: order.amountInr,
    balance: newBalance,
    source: "crypto",
  });
  pushUserMyInfo(order.userName);

  console.log(
    `[tron] order ${order.orderId} paid +${order.amountInr} INR ` +
      `(${order.amountUsdt} USDT @ ${order.fxRate}) tx=${tx.transaction_id.slice(0, 10)}…`,
  );
};

/** Single watcher tick: expire stale + match pending against incoming txs. */
const tick = async (): Promise<void> => {
  if (!config.tronNetwork || !config.tronReceiver || !config.tronContract) {
    return; // not configured — nothing to do
  }

  // 1. Expire orders past their deadline. Cheap, runs every tick.
  await CryptoOrderModel.updateMany(
    { status: "pending", expiresAt: { $lt: new Date() } },
    { $set: { status: "expired" } },
  );

  // 2. Active pending orders for THIS network only.
  const pending = await CryptoOrderModel.find({
    status: "pending",
    network: config.tronNetwork,
    receiver: config.tronReceiver,
    contractAddress: config.tronContract,
    expiresAt: { $gt: new Date() },
  });
  if (pending.length === 0) return;

  // 3. Window: oldest pending - 60s buffer (clock skew tolerance).
  const earliest = pending.reduce(
    (acc, o) => Math.min(acc, o.createdAt.getTime()),
    Date.now(),
  );
  const txs = await fetchIncoming(earliest - 60_000);
  if (txs.length === 0) return;

  // 4. Match each pending order against the tx list.
  // O(P × T) is fine for small P,T; if it grows we'd index by amount.
  for (const order of pending) {
    const targetValue = toSmallestUnit(order.amountUsdt);
    const match = txs.find(
      (tx) =>
        tx.to === order.receiver &&
        tx.token_info?.address === order.contractAddress &&
        tx.value === targetValue &&
        tx.block_timestamp >= order.createdAt.getTime(),
    );
    if (match) await claim(order, match);
  }
};

let watcherTimer: NodeJS.Timeout | null = null;

export const startTronWatcher = (): void => {
  if (watcherTimer) return;
  if (!config.tronNetwork) {
    console.log("[tron] watcher disabled (TRON_NETWORK not set)");
    return;
  }
  if (!config.tronReceiver || !config.tronContract) {
    console.warn(
      "[tron] watcher started without receiver/contract — orders will be created but not credited until configured",
    );
  }
  console.log(
    `[tron] watcher started on ${config.tronNetwork} ` +
      `(receiver=${config.tronReceiver || "<unset>"}, ` +
      `contract=${config.tronContract || "<unset>"}, ` +
      `interval=${config.cryptoWatchIntervalMs}ms)`,
  );
  // Run once immediately, then on interval.
  tick().catch((e) => console.error("[tron] tick error:", e));
  watcherTimer = setInterval(() => {
    tick().catch((e) => console.error("[tron] tick error:", e));
  }, config.cryptoWatchIntervalMs);
};

export const stopTronWatcher = (): void => {
  if (watcherTimer) {
    clearInterval(watcherTimer);
    watcherTimer = null;
  }
};
