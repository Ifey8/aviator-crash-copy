import { config } from "../../config";
import { CryptoOrderModel, CryptoOrderDoc } from "../../db/models/CryptoOrder";
import { engine } from "../../game/engine";
import { pushToUser, pushUserMyInfo } from "../../sockets";

/**
 * TronProvider — polls TronGrid for incoming USDT-TRC20 transfers to each
 * pending order's UNIQUE deposit address (derived from the server's HD
 * master seed).
 *
 * Architecture (per-order deposit address):
 *   • Each order has its own depositAddress (m/44'/195'/0'/0/N).
 *   • User sends ANY USDT amount to that address.
 *   • Watcher polls each pending address, claims any incoming tx.
 *   • Credit = actual_value × order.fxRate (locked at order create).
 *
 * Network selection driven by config.tronNetwork:
 *   "shasta"  → https://api.shasta.trongrid.io
 *   "mainnet" → https://api.trongrid.io
 *   ""        → provider disabled
 *
 * MATCHING RULES (any tx that satisfies all of these claims the order):
 *   1. tx.to === order.depositAddress
 *   2. tx.token_info.address === order.contractAddress
 *   3. tx.value > 0
 *   4. tx.block_timestamp >= order.createdAt - 60s (clock skew tolerance)
 *   5. tx hash not already claimed (DB unique constraint enforces this)
 *
 * IDEMPOTENCY: atomic findOneAndUpdate({status:"pending"}, ...) plus the
 * unique txHash index. A given tx can only ever credit one order.
 */

const SHASTA_BASE = "https://api.shasta.trongrid.io";
const MAINNET_BASE = "https://api.trongrid.io";

interface Trc20Tx {
  transaction_id: string;
  block_timestamp: number;
  from: string;
  to: string;
  value: string;
  token_info: {
    symbol: string;
    address: string;
    decimals: number;
  };
}

const apiBase = (): string =>
  config.tronNetwork === "mainnet" ? MAINNET_BASE : SHASTA_BASE;

/** Fetch incoming TRC20 transfers to `address` since `sinceMs`. */
const fetchIncoming = async (
  address: string,
  contractAddress: string,
  sinceMs: number,
): Promise<Trc20Tx[]> => {
  const url =
    `${apiBase()}/v1/accounts/${address}/transactions/trc20` +
    `?contract_address=${contractAddress}` +
    `&only_to=true` +
    `&min_timestamp=${sinceMs}` +
    `&limit=20` +
    `&order_by=block_timestamp,desc`;

  const headers: Record<string, string> = { accept: "application/json" };
  if (config.trongridApiKey) headers["TRON-PRO-API-KEY"] = config.trongridApiKey;

  try {
    const res = await fetch(url, { headers, signal: AbortSignal.timeout(8000) });
    if (!res.ok) {
      console.warn(`[tron] TronGrid ${res.status} for ${address.slice(0, 8)}…`);
      return [];
    }
    const json = (await res.json()) as { data?: Trc20Tx[] };
    return Array.isArray(json.data) ? json.data : [];
  } catch (e) {
    console.warn(`[tron] fetchIncoming ${address.slice(0, 8)}… error:`, (e as Error).message);
    return [];
  }
};

/** Atomic claim: pending order + matching tx → paid + balance credited. */
const claim = async (order: CryptoOrderDoc, tx: Trc20Tx): Promise<void> => {
  const actualUsdt = +(parseInt(tx.value, 10) / 1e6).toFixed(6);
  const actualInr = +(actualUsdt * order.fxRate).toFixed(2);

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
          actualUsdt,
          actualInr,
          meta: { tx },
        },
      },
      { new: true },
    );
  } catch (e) {
    // Likely a duplicate-key error on txHash — another order claimed it.
    // (Unlikely with per-order addresses but kept for safety.)
    console.warn(`[tron] claim ${order.orderId} failed:`, (e as Error).message);
    return;
  }
  if (!updated) return; // already paid by another worker

  const newBalance = await engine.creditBalance(order.userName, actualInr);
  if (newBalance != null) {
    updated.balanceAfter = newBalance;
    await updated.save();
  }

  pushToUser(order.userName, "rechargeUpdate", {
    orderId: order.orderId,
    status: "paid",
    amount: actualInr,
    balance: newBalance,
    source: "crypto",
  });
  pushUserMyInfo(order.userName);

  console.log(
    `[tron] order ${order.orderId} paid ${actualUsdt} USDT → ` +
      `+₹${actualInr} INR (rate ${order.fxRate}, tx ${tx.transaction_id.slice(0, 10)}…)`,
  );
};

/** One watcher tick: expire stale orders, then poll each pending address. */
const tick = async (): Promise<void> => {
  if (!config.tronNetwork || !config.tronContract) return;

  // 1. Expire orders past their deadline.
  await CryptoOrderModel.updateMany(
    { status: "pending", expiresAt: { $lt: new Date() } },
    { $set: { status: "expired" } },
  );

  // 2. Active pending orders for THIS network only.
  const pending = await CryptoOrderModel.find({
    status: "pending",
    network: config.tronNetwork,
    contractAddress: config.tronContract,
    expiresAt: { $gt: new Date() },
  });
  if (pending.length === 0) return;

  // 3. Poll each deposit address. Sequential to be kind to TronGrid free
  // tier; with API key + paid plan we could parallelise.
  for (const order of pending) {
    const txs = await fetchIncoming(
      order.depositAddress,
      order.contractAddress,
      order.createdAt.getTime() - 60_000,
    );
    if (txs.length === 0) continue;

    // Pick the EARLIEST matching tx (in case of multiple deposits, we
    // process them in order). TronGrid returns desc; reverse for oldest-first.
    const matches = txs
      .filter(
        (tx) =>
          tx.to === order.depositAddress &&
          tx.token_info?.address === order.contractAddress &&
          parseInt(tx.value, 10) > 0 &&
          tx.block_timestamp >= order.createdAt.getTime() - 60_000,
      )
      .reverse();
    if (matches.length === 0) continue;

    await claim(order, matches[0]);
  }
};

let watcherTimer: NodeJS.Timeout | null = null;

export const startTronWatcher = (): void => {
  if (watcherTimer) return;
  if (!config.tronNetwork) {
    console.log("[tron] watcher disabled (TRON_NETWORK not set)");
    return;
  }
  if (!config.tronContract) {
    console.warn("[tron] TRON_USDT_CONTRACT not configured — watcher idle");
    return;
  }
  if (!config.cryptoMasterMnemonic) {
    console.warn(
      "[tron] CRYPTO_MASTER_MNEMONIC not set — orders cannot be created until you generate one",
    );
  }
  console.log(
    `[tron] watcher started on ${config.tronNetwork} ` +
      `(contract=${config.tronContract}, interval=${config.cryptoWatchIntervalMs}ms, ` +
      `per-order deposit addresses)`,
  );
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
