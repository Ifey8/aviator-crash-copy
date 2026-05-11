import { config } from "../config";
import { CryptoOrderModel } from "../db/models/CryptoOrder";
import { WithdrawalOrderModel } from "../db/models/WithdrawalOrder";
import { deriveAccount, hotWallet } from "./wallet";
import { triggerReferralReward } from "./referral";
import { pushToUser, pushUserMyInfo } from "../sockets";
// eslint-disable-next-line @typescript-eslint/no-var-requires
const TronWeb = require("tronweb").TronWeb;

/**
 * walletOps — shared on-chain operations for the admin Wallets tab and
 * the existing CLI tools (sweep-deposits, transfer-out).
 *
 * Exports:
 *   • listWallets(useCache=true) → hot wallet + all derived sub-addresses
 *     known to the DB, with live TRX + USDT balances. Cached 30s in-memory.
 *   • transferOut({to, amountUsdt|amountTrx, dryRun}) → outbound from hot.
 *   • sweepAddresses({addresses?, dryRun}) → run sweep on all (or specified)
 *     paid+un-swept deposit addresses → hot wallet.
 *
 * Why a shared lib (vs each route doing its own thing):
 *   • Single source of truth for chain interactions
 *   • Caching & rate-limit handling in one place
 *   • Consistent behaviour between CLI and admin UI paths
 *   • Refactor-able later if we add stake/freeze, multi-sig, etc.
 */

const TRC20_RE = /^T[1-9A-HJ-NP-Za-km-z]{33}$/;

const buildClient = (privateKey?: string) =>
  new TronWeb({
    fullHost:
      config.tronNetwork === "mainnet"
        ? "https://api.trongrid.io"
        : "https://api.shasta.trongrid.io",
    headers: config.trongridApiKey
      ? { "TRON-PRO-API-KEY": config.trongridApiKey }
      : {},
    privateKey,
  });

// ---------------------------------------------------------------------------
// listWallets
// ---------------------------------------------------------------------------

export interface WalletEntry {
  role: "hot" | "deposit";
  index: number;
  address: string;
  /** null = balance fetch failed (rate limit / network). UI shows ⚠. */
  trxBalance: number | null;
  usdtBalance: number | null;
  /** for deposit addresses only — paid orders bound to this address */
  paidOrderCount?: number;
  unsweptOrderCount?: number;
  totalUsdtClaimed?: number;
}

export interface WalletsListResult {
  network: string;
  contract: string;
  fetchedAt: Date;
  wallets: WalletEntry[];
  totals: {
    hotTrx: number;
    hotUsdt: number;
    depositTrx: number;
    depositUsdt: number;
    unsweptOrders: number;
  };
  /** True when this result came from the in-memory cache (≤ 30s old). */
  cached: boolean;
}

const CACHE_TTL_MS = 30_000;
let cached: { at: number; result: WalletsListResult } | null = null;

// Retry helper — TronGrid free tier rate-limits + occasional 5xx, but
// usually clears within a few hundred ms. Three attempts with linear
// backoff covers >99% of transient failures without making the UI wait
// more than a couple seconds. Throws after the final attempt — callers
// MUST handle the throw rather than papering over with `return 0`,
// because a silent 0 looks identical to "really has no balance" and
// caused the worst class of bug we've hit (sweep marked address as
// no-balance + flagged orders swept, while chain still held the funds).
const withRetry = async <T>(fn: () => Promise<T>, label: string): Promise<T> => {
  let lastErr: unknown;
  for (let i = 0; i < 3; i++) {
    try {
      return await fn();
    } catch (e) {
      lastErr = e;
      if (i < 2) await new Promise((r) => setTimeout(r, 400 + i * 600));
    }
  }
  throw new Error(`[${label}] all 3 attempts failed: ${(lastErr as Error)?.message || lastErr}`);
};

const fetchTrxBalance = async (address: string): Promise<number> => {
  return withRetry(async () => {
    const tron = buildClient();
    const sun = await tron.trx.getBalance(address);
    return Number(sun) / 1e6;
  }, `trxBalance ${address.slice(0, 8)}`);
};

const fetchUsdtBalance = async (address: string): Promise<number> => {
  if (!config.tronContract) return 0;
  return withRetry(async () => {
    const tron = buildClient();
    // TronWeb requires an `owner_address` for constant contract calls
    // even when read-only. Without a privateKey set, the contract().at()
    // path fails with "owner_address isn't set". Pin the tron instance
    // to the address we're querying — view functions don't actually
    // need a signer, just a non-empty caller.
    tron.setAddress(address);
    const c = await tron.contract().at(config.tronContract);
    const raw: bigint = await c.balanceOf(address).call();
    return Number(raw) / 1e6;
  }, `usdtBalance ${address.slice(0, 8)}`);
};

export const listWallets = async (useCache = true): Promise<WalletsListResult> => {
  if (useCache && cached && Date.now() - cached.at < CACHE_TTL_MS) {
    return { ...cached.result, cached: true };
  }

  // Hot wallet
  let hot;
  try {
    hot = hotWallet();
  } catch {
    return {
      network: config.tronNetwork || "",
      contract: config.tronContract || "",
      fetchedAt: new Date(),
      wallets: [],
      totals: { hotTrx: 0, hotUsdt: 0, depositTrx: 0, depositUsdt: 0, unsweptOrders: 0 },
      cached: false,
    };
  }

  // Aggregate sub-addresses from CryptoOrder (only addresses with at least 1 paid order
  // + on-chain balance worth showing). Limit 50 to keep TronGrid load sane.
  const derivedRows = await CryptoOrderModel.aggregate<{
    _id: string;        // depositAddress
    derivIndex: number;
    paidOrderCount: number;
    unsweptOrderCount: number;
    totalUsdtClaimed: number;
  }>([
    {
      $match: {
        network: config.tronNetwork,
        contractAddress: config.tronContract,
        derivIndex: { $exists: true },
      },
    },
    {
      $group: {
        _id: "$depositAddress",
        derivIndex: { $first: "$derivIndex" },
        paidOrderCount: {
          $sum: { $cond: [{ $eq: ["$status", "paid"] }, 1, 0] },
        },
        unsweptOrderCount: {
          $sum: {
            $cond: [
              { $and: [{ $eq: ["$status", "paid"] }, { $eq: ["$sweptAt", null] }] },
              1,
              0,
            ],
          },
        },
        totalUsdtClaimed: { $sum: { $ifNull: ["$actualUsdt", 0] } },
      },
    },
    // Show un-swept first, then by paid-count descending
    { $sort: { unsweptOrderCount: -1, paidOrderCount: -1 } },
    { $limit: 50 },
  ]);

  // Sequential fetch (TronGrid free tier rate-limits parallel). 50 addresses
  // × 2 calls = ~100 requests; with API key + 30s cache this is fine.
  const wallets: WalletEntry[] = [];

  // Hot first — wrapped so a single chain hiccup doesn't render the
  // whole tab empty. Failed cells will surface as null balances which
  // the UI renders as "⚠ ?" so the operator knows the data is stale.
  const safe = async (fn: () => Promise<number>): Promise<number | null> => {
    try { return await fn(); } catch (e) {
      console.warn("[wallets] balance fetch failed:", (e as Error).message);
      return null;
    }
  };

  const [hotTrx, hotUsdt] = await Promise.all([
    safe(() => fetchTrxBalance(hot.address)),
    safe(() => fetchUsdtBalance(hot.address)),
  ]);
  wallets.push({
    role: "hot",
    index: hot.index,
    address: hot.address,
    trxBalance: hotTrx == null ? null : +hotTrx.toFixed(4),
    usdtBalance: hotUsdt == null ? null : +hotUsdt.toFixed(4),
  });

  let depositTrx = 0;
  let depositUsdt = 0;
  let unsweptOrders = 0;

  for (const row of derivedRows) {
    const trxBal = await safe(() => fetchTrxBalance(row._id));
    const usdtBal = await safe(() => fetchUsdtBalance(row._id));
    if (trxBal != null) depositTrx += trxBal;
    if (usdtBal != null) depositUsdt += usdtBal;
    unsweptOrders += row.unsweptOrderCount;
    wallets.push({
      role: "deposit",
      index: row.derivIndex,
      address: row._id,
      trxBalance: trxBal == null ? null : +trxBal.toFixed(4),
      usdtBalance: usdtBal == null ? null : +usdtBal.toFixed(4),
      paidOrderCount: row.paidOrderCount,
      unsweptOrderCount: row.unsweptOrderCount,
      totalUsdtClaimed: +row.totalUsdtClaimed.toFixed(4),
    });
  }

  const result: WalletsListResult = {
    network: config.tronNetwork || "",
    contract: config.tronContract || "",
    fetchedAt: new Date(),
    wallets,
    totals: {
      // Null balances treated as 0 in the totals card — individual row
      // displays "⚠ ?" so operator can pinpoint which address failed.
      hotTrx: hotTrx == null ? 0 : +hotTrx.toFixed(4),
      hotUsdt: hotUsdt == null ? 0 : +hotUsdt.toFixed(4),
      depositTrx: +depositTrx.toFixed(4),
      depositUsdt: +depositUsdt.toFixed(4),
      unsweptOrders,
    },
    cached: false,
  };
  cached = { at: Date.now(), result };
  return result;
};

// ---------------------------------------------------------------------------
// fetchAddressBalance — single-address live read, bypasses the 30s cache.
// Used by the admin UI's per-row refresh button.
// ---------------------------------------------------------------------------

export interface AddressBalance {
  address: string;
  trxBalance: number | null;
  usdtBalance: number | null;
  fetchedAt: Date;
}

export const fetchAddressBalance = async (address: string): Promise<AddressBalance> => {
  let trxBalance: number | null = null;
  let usdtBalance: number | null = null;
  try { trxBalance = +(await fetchTrxBalance(address)).toFixed(4); } catch {}
  try { usdtBalance = +(await fetchUsdtBalance(address)).toFixed(4); } catch {}
  // Bust the listWallets cache so the next full refresh reflects this read.
  cached = null;
  return { address, trxBalance, usdtBalance, fetchedAt: new Date() };
};

// ---------------------------------------------------------------------------
// transferOut — outbound from hot wallet
// ---------------------------------------------------------------------------

export interface TransferOutInput {
  to: string;
  amountUsdt?: number;
  amountTrx?: number;
  dryRun?: boolean;
}

export interface TransferOutResult {
  ok: boolean;
  dryRun: boolean;
  reason?: string;
  txHash?: string;
  from: string;
  to: string;
  amount: number;
  currency: "USDT" | "TRX";
  preBalance: { trx: number; usdt: number };
}

export const transferOut = async (input: TransferOutInput): Promise<TransferOutResult> => {
  if (!input.to || !TRC20_RE.test(input.to)) {
    return {
      ok: false,
      dryRun: !!input.dryRun,
      reason: "Invalid TRC20 address (must start with T, 34 chars)",
      from: "",
      to: input.to || "",
      amount: 0,
      currency: input.amountUsdt ? "USDT" : "TRX",
      preBalance: { trx: 0, usdt: 0 },
    };
  }
  if (!!input.amountUsdt === !!input.amountTrx) {
    return {
      ok: false,
      dryRun: !!input.dryRun,
      reason: "Specify exactly one of amountUsdt or amountTrx",
      from: "",
      to: input.to,
      amount: 0,
      currency: input.amountUsdt ? "USDT" : "TRX",
      preBalance: { trx: 0, usdt: 0 },
    };
  }

  let hot;
  try {
    hot = hotWallet();
  } catch (e) {
    return {
      ok: false,
      dryRun: !!input.dryRun,
      reason: (e as Error).message,
      from: "",
      to: input.to,
      amount: 0,
      currency: input.amountUsdt ? "USDT" : "TRX",
      preBalance: { trx: 0, usdt: 0 },
    };
  }
  if (input.to === hot.address) {
    return {
      ok: false,
      dryRun: !!input.dryRun,
      reason: "Destination equals hot wallet — refused",
      from: hot.address,
      to: input.to,
      amount: 0,
      currency: input.amountUsdt ? "USDT" : "TRX",
      preBalance: { trx: 0, usdt: 0 },
    };
  }

  const tron = buildClient(hot.privateKey);
  const trxBal = (await tron.trx.getBalance(hot.address)) / 1e6;
  let usdtBal = 0;
  if (config.tronContract) {
    const c = await tron.contract().at(config.tronContract);
    const raw: bigint = await c.balanceOf(hot.address).call();
    usdtBal = Number(raw) / 1e6;
  }
  const pre = { trx: +trxBal.toFixed(4), usdt: +usdtBal.toFixed(4) };

  if (input.amountUsdt) {
    if (!config.tronContract) {
      return { ok: false, dryRun: !!input.dryRun, reason: "TRON_USDT_CONTRACT not set", from: hot.address, to: input.to, amount: input.amountUsdt, currency: "USDT", preBalance: pre };
    }
    if (input.amountUsdt > usdtBal) {
      return { ok: false, dryRun: !!input.dryRun, reason: `Hot wallet has only ${usdtBal} USDT (requested ${input.amountUsdt})`, from: hot.address, to: input.to, amount: input.amountUsdt, currency: "USDT", preBalance: pre };
    }
    if (trxBal < 15) {
      return { ok: false, dryRun: !!input.dryRun, reason: `Hot wallet has only ${trxBal.toFixed(2)} TRX — USDT transfer needs ~15 TRX gas`, from: hot.address, to: input.to, amount: input.amountUsdt, currency: "USDT", preBalance: pre };
    }
    if (input.dryRun) {
      return { ok: true, dryRun: true, from: hot.address, to: input.to, amount: input.amountUsdt, currency: "USDT", preBalance: pre };
    }
    const c = await tron.contract().at(config.tronContract);
    const raw = BigInt(Math.round(input.amountUsdt * 1e6));
    const tx = await c.transfer(input.to, raw).send();
    const txHash = typeof tx === "string" ? tx : tx?.txid || JSON.stringify(tx);
    cached = null; // invalidate balance cache
    return { ok: true, dryRun: false, txHash, from: hot.address, to: input.to, amount: input.amountUsdt, currency: "USDT", preBalance: pre };
  }

  // TRX path
  const reserve = 5;
  if (input.amountTrx! + reserve > trxBal) {
    return { ok: false, dryRun: !!input.dryRun, reason: `Refusing — would leave less than ${reserve} TRX gas reserve. Hot=${trxBal.toFixed(2)} req=${input.amountTrx}`, from: hot.address, to: input.to, amount: input.amountTrx!, currency: "TRX", preBalance: pre };
  }
  if (input.dryRun) {
    return { ok: true, dryRun: true, from: hot.address, to: input.to, amount: input.amountTrx!, currency: "TRX", preBalance: pre };
  }
  const sun = Math.round(input.amountTrx! * 1e6);
  const tx = await tron.trx.sendTransaction(input.to, sun);
  if (!tx.result) {
    return { ok: false, dryRun: false, reason: "Broadcast failed", from: hot.address, to: input.to, amount: input.amountTrx!, currency: "TRX", preBalance: pre };
  }
  const txHash = tx.txid || tx.transaction?.txID || "<unknown>";
  cached = null;
  return { ok: true, dryRun: false, txHash, from: hot.address, to: input.to, amount: input.amountTrx!, currency: "TRX", preBalance: pre };
};

// ---------------------------------------------------------------------------
// sweepAddresses — same logic as the CLI, exposed as a function
// ---------------------------------------------------------------------------

export interface SweepResult {
  ok: boolean;
  dryRun: boolean;
  attempted: number;
  swept: number;
  totalUsdt: number;
  details: Array<{
    address: string;
    derivIndex: number;
    onChainUsdt: number;
    onChainTrx: number;
    orderIds: string[];
    action: "swept" | "skipped-empty" | "no-balance" | "topped-up-only" | "error";
    txHash?: string;
    error?: string;
  }>;
}

export const sweepAddresses = async (input: { addresses?: string[]; dryRun?: boolean } = {}): Promise<SweepResult> => {
  const dryRun = !!input.dryRun;
  if (!config.cryptoMasterMnemonic) {
    return { ok: false, dryRun, attempted: 0, swept: 0, totalUsdt: 0, details: [] };
  }

  const hot = hotWallet();
  const filter: any = {
    status: "paid",
    sweptAt: null,
    network: config.tronNetwork,
    contractAddress: config.tronContract,
  };
  if (input.addresses && input.addresses.length > 0) {
    filter.depositAddress = { $in: input.addresses };
  }

  const grouped = await CryptoOrderModel.aggregate<{
    _id: string;
    derivIndex: number;
    orderIds: string[];
  }>([
    { $match: filter },
    { $group: { _id: "$depositAddress", derivIndex: { $first: "$derivIndex" }, orderIds: { $push: "$orderId" } } },
  ]);

  const result: SweepResult = { ok: true, dryRun, attempted: grouped.length, swept: 0, totalUsdt: 0, details: [] };
  if (grouped.length === 0) return result;

  const hotClient = buildClient(hot.privateKey);

  for (const grp of grouped) {
    const acct = deriveAccount(grp.derivIndex);
    if (acct.address !== grp._id) {
      result.details.push({
        address: grp._id,
        derivIndex: grp.derivIndex,
        onChainUsdt: 0,
        onChainTrx: 0,
        orderIds: grp.orderIds,
        action: "error",
        error: `derivIndex mismatch — expected ${grp._id} got ${acct.address}`,
      });
      continue;
    }

    const subClient = buildClient(acct.privateKey);
    const usdtContract = await subClient.contract().at(config.tronContract);

    // Read balance with retry. A bare balanceOf() can return 0 on rate
    // limit / network glitch, which would falsely trigger the
    // "no-balance" path and lock the funds out of admin view. Use
    // withRetry so we're certain before marking the order swept.
    let onChainUsdt = 0;
    let onChainTrx = 0;
    let balRaw: bigint = 0n;
    let balanceCheckFailed = false;
    try {
      balRaw = await withRetry<bigint>(
        () => usdtContract.balanceOf(acct.address).call(),
        `sweep.balanceOf ${acct.address.slice(0, 8)}`,
      );
      onChainUsdt = Number(balRaw) / 1e6;
      const trxSun = await withRetry<number>(
        () => subClient.trx.getBalance(acct.address),
        `sweep.trxBalance ${acct.address.slice(0, 8)}`,
      );
      onChainTrx = Number(trxSun) / 1e6;
    } catch (e) {
      balanceCheckFailed = true;
      console.error(`[sweep] balance check failed for ${acct.address}:`, (e as Error).message);
    }

    // Refuse to mark "no-balance" if we couldn't actually read the chain.
    // Better to fail loudly than silently flag the order as swept.
    if (balanceCheckFailed) {
      result.details.push({
        address: acct.address,
        derivIndex: acct.index,
        onChainUsdt: 0,
        onChainTrx: 0,
        orderIds: grp.orderIds,
        action: "error",
        error: "Could not read balance after 3 retries — chain RPC unreachable. Order NOT marked swept.",
      });
      continue;
    }

    if (onChainUsdt <= 0) {
      result.details.push({
        address: acct.address,
        derivIndex: acct.index,
        onChainUsdt,
        onChainTrx,
        orderIds: grp.orderIds,
        action: "no-balance",
      });
      if (!dryRun) {
        await CryptoOrderModel.updateMany(
          { orderId: { $in: grp.orderIds } },
          { $set: { sweptAt: new Date(), sweptTxHash: "no-balance" } },
        );
      }
      continue;
    }

    // Top up gas if needed
    if (onChainTrx < config.cryptoSweepGasReserveTrx) {
      const need = config.cryptoSweepGasReserveTrx - onChainTrx;
      if (!dryRun) {
        const tx = await hotClient.trx.sendTransaction(acct.address, Math.round(need * 1e6));
        if (!tx.result) {
          result.details.push({
            address: acct.address,
            derivIndex: acct.index,
            onChainUsdt,
            onChainTrx,
            orderIds: grp.orderIds,
            action: "error",
            error: "TRX top-up failed",
          });
          continue;
        }
        await new Promise((r) => setTimeout(r, 4000));
      }
    }

    if (dryRun) {
      result.details.push({
        address: acct.address,
        derivIndex: acct.index,
        onChainUsdt,
        onChainTrx,
        orderIds: grp.orderIds,
        action: "swept",
      });
      result.totalUsdt += onChainUsdt;
      result.swept++;
      continue;
    }

    try {
      const tx = await usdtContract.transfer(hot.address, balRaw).send();
      const txHash = typeof tx === "string" ? tx : tx?.txid || JSON.stringify(tx);
      await CryptoOrderModel.updateMany(
        { orderId: { $in: grp.orderIds } },
        { $set: { sweptAt: new Date(), sweptTxHash: txHash } },
      );
      result.details.push({
        address: acct.address,
        derivIndex: acct.index,
        onChainUsdt,
        onChainTrx,
        orderIds: grp.orderIds,
        action: "swept",
        txHash,
      });
      result.totalUsdt += onChainUsdt;
      result.swept++;
    } catch (e) {
      result.details.push({
        address: acct.address,
        derivIndex: acct.index,
        onChainUsdt,
        onChainTrx,
        orderIds: grp.orderIds,
        action: "error",
        error: (e as Error).message,
      });
    }
  }

  cached = null; // invalidate balance cache after on-chain ops
  return result;
};

// ---------------------------------------------------------------------------
// autoBroadcastUsdtWithdrawal — fire-and-forget USDT broadcast for an order
//
// Called from the withdrawal route AFTER the order is created with
// status="processing", iff the operator has enabled auto-payout AND the
// amount is under the cap. Runs in the background — the user already
// got their HTTP response with status="processing", and this fn sends
// them a "paid" socket update once the tx broadcasts (or "manual_queue"
// if it fails).
//
// Atomicity: status flip uses {orderId, status:"processing"} guard so a
// concurrent admin "Mark paid" wins gracefully.
// ---------------------------------------------------------------------------

export const autoBroadcastUsdtWithdrawal = async (orderId: string): Promise<void> => {
  const order = await WithdrawalOrderModel.findOne({ orderId });
  if (!order) return;
  if (order.method !== "usdt" || order.status !== "processing") return;
  if (!order.trc20Address || !config.tronContract) return;

  let hot;
  try {
    hot = hotWallet();
  } catch (e) {
    console.error("[auto-payout] hot wallet derive failed:", (e as Error).message);
    return;
  }

  const tron = buildClient(hot.privateKey);

  // Pre-flight balance check (race vs other concurrent payouts)
  let trxBal = 0;
  let usdtBal = 0;
  try {
    trxBal = (await tron.trx.getBalance(hot.address)) / 1e6;
    const c = await tron.contract().at(config.tronContract);
    const raw: bigint = await c.balanceOf(hot.address).call();
    usdtBal = Number(raw) / 1e6;
  } catch (e) {
    console.error("[auto-payout] balance fetch failed:", (e as Error).message);
    return;
  }
  if (usdtBal < order.grossAmount || trxBal < 15) {
    console.warn(
      `[auto-payout] order ${orderId} skipped — hot wallet thin ` +
        `(USDT=${usdtBal} TRX=${trxBal}, need=${order.grossAmount})`,
    );
    await WithdrawalOrderModel.updateOne(
      { orderId, status: "processing" },
      {
        $set: {
          status: "manual_queue",
          failedReason: `Auto-payout skipped — hot wallet insufficient (USDT=${usdtBal.toFixed(2)})`,
        },
      },
    );
    pushToUser(order.userName, "withdrawalUpdate", { orderId, status: "manual_queue" });
    return;
  }

  // Broadcast
  let txHash: string;
  try {
    const c = await tron.contract().at(config.tronContract);
    const raw = BigInt(Math.round(order.grossAmount * 1e6));
    const tx = await c.transfer(order.trc20Address, raw).send();
    txHash = typeof tx === "string" ? tx : tx?.txid || JSON.stringify(tx);
  } catch (e) {
    const msg = (e as Error).message;
    console.error(`[auto-payout] broadcast FAILED for ${orderId}:`, msg);
    await WithdrawalOrderModel.updateOne(
      { orderId, status: "processing" },
      {
        $set: {
          status: "manual_queue",
          failedReason: `Auto-broadcast failed: ${msg.slice(0, 200)}`,
        },
      },
    );
    pushToUser(order.userName, "withdrawalUpdate", {
      orderId,
      status: "manual_queue",
      failedReason: msg.slice(0, 200),
    });
    return;
  }

  // Mark paid atomically
  const flipped = await WithdrawalOrderModel.findOneAndUpdate(
    { orderId, status: "processing" },
    {
      $set: {
        status: "paid",
        paidAt: new Date(),
        txHash,
        meta: { ...(order.meta || {}), autoBroadcast: true },
      },
    },
    { new: true },
  );
  if (!flipped) {
    // Admin raced us; tx still went out though. Just log.
    console.warn(`[auto-payout] order ${orderId} status changed during broadcast (tx ${txHash})`);
    return;
  }

  // Referral reward (idempotent on providerRef)
  await triggerReferralReward(order.userName, {
    type: "payout",
    id: order.providerRef || order.orderId,
    amountInr: order.grossAmount * (order.fxRate || 1),
  });

  pushToUser(order.userName, "withdrawalUpdate", {
    orderId,
    status: "paid",
    txHash,
  });
  pushUserMyInfo(order.userName);
  cached = null;
  console.log(
    `[auto-payout] ✓ ${orderId.slice(0, 8)}… sent ${order.grossAmount} USDT, tx ${txHash.slice(0, 12)}…`,
  );
};
