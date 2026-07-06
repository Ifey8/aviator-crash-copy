import { ethers } from "ethers";
import { config } from "../config";
import { CryptoOrderModel } from "../db/models/CryptoOrder";
import { WithdrawalOrderModel } from "../db/models/WithdrawalOrder";
import { getEvmChain, EvmChainKey } from "./evmChains";
import { deriveEvmAccount, evmHotWallet } from "./evmWallet";
import { triggerReferralReward } from "./referral";
import { pushToUser, pushUserMyInfo } from "../sockets";

/**
 * evmWalletOps — EVM counterpart to walletOps.ts (TRON). Same exported
 * shapes (listWallets/transferOut/sweepAddresses/autoBroadcast...) so the
 * admin routes and withdrawal flow can dispatch on `network` without
 * bespoke branching logic per call site.
 *
 * All amount math for USDT uses ethers.parseUnits/formatUnits — NOT
 * float multiplication — because BSC's USDT is 18-decimal. `amount * 1e18`
 * overflows JS's safe-integer range for ordinary withdrawal amounts;
 * parseUnits parses the decimal STRING directly into a BigInt instead.
 */

const ERC20_ABI = [
  "function balanceOf(address) view returns (uint256)",
  "function transfer(address to, uint256 amount) returns (bool)",
];

const providerCache = new Map<EvmChainKey, ethers.JsonRpcProvider>();
const getProvider = (chainKey: EvmChainKey): ethers.JsonRpcProvider => {
  let p = providerCache.get(chainKey);
  if (!p) {
    const chain = getEvmChain(chainKey)!;
    p = new ethers.JsonRpcProvider(chain.rpcUrl, chain.chainId);
    providerCache.set(chainKey, p);
  }
  return p;
};

// Mirrors walletOps.ts's withRetry — free-tier public RPCs rate-limit /
// glitch occasionally; 3 attempts with linear backoff covers most of it.
// Throws (rather than returning 0) after the final attempt so callers can't
// mistake "RPC down" for "really has no balance".
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

const fetchNativeBalance = async (chainKey: EvmChainKey, address: string): Promise<number> =>
  withRetry(async () => {
    const raw = await getProvider(chainKey).getBalance(address);
    return Number(ethers.formatEther(raw));
  }, `native ${address.slice(0, 8)}`);

const fetchUsdtBalance = async (chainKey: EvmChainKey, address: string): Promise<number> => {
  const chain = getEvmChain(chainKey)!;
  return withRetry(async () => {
    const c = new ethers.Contract(chain.usdtContract, ERC20_ABI, getProvider(chainKey));
    const raw: bigint = await c.balanceOf(address);
    return Number(ethers.formatUnits(raw, chain.usdtDecimals));
  }, `usdt ${address.slice(0, 8)}`);
};

export interface EvmHotWalletBalance {
  address: string;
  nativeBalance: number;
  usdtBalance: number;
}

/** Used by the withdrawal route's liquidity check (mirrors hotWallet.ts's getHotWalletBalance for TRON). */
export const getEvmHotWalletBalance = async (chainKey: EvmChainKey): Promise<EvmHotWalletBalance | null> => {
  if (!getEvmChain(chainKey)) return null;
  let hot;
  try {
    hot = evmHotWallet();
  } catch {
    return null;
  }
  try {
    const [nativeBalance, usdtBalance] = await Promise.all([
      fetchNativeBalance(chainKey, hot.address),
      fetchUsdtBalance(chainKey, hot.address),
    ]);
    return { address: hot.address, nativeBalance: +nativeBalance.toFixed(6), usdtBalance: +usdtBalance.toFixed(6) };
  } catch (e) {
    console.warn(`[evmWalletOps] hot wallet balance fetch failed for ${chainKey}:`, (e as Error).message);
    return null;
  }
};

export interface EvmWalletEntry {
  role: "hot" | "deposit";
  index: number;
  address: string;
  nativeBalance: number | null;
  usdtBalance: number | null;
  paidOrderCount?: number;
  unsweptOrderCount?: number;
  totalUsdtClaimed?: number;
}

export interface EvmWalletsListResult {
  chain: EvmChainKey;
  contract: string;
  fetchedAt: Date;
  wallets: EvmWalletEntry[];
  totals: { hotNative: number; hotUsdt: number; depositNative: number; depositUsdt: number; unsweptOrders: number };
  cached: boolean;
}

const CACHE_TTL_MS = 30_000;
const cacheByChain = new Map<EvmChainKey, { at: number; result: EvmWalletsListResult }>();

export const listWalletsForChain = async (chainKey: EvmChainKey, useCache = true): Promise<EvmWalletsListResult> => {
  const cached = cacheByChain.get(chainKey);
  if (useCache && cached && Date.now() - cached.at < CACHE_TTL_MS) {
    return { ...cached.result, cached: true };
  }

  const chain = getEvmChain(chainKey)!;
  let hot;
  try {
    hot = evmHotWallet();
  } catch {
    return {
      chain: chainKey,
      contract: chain.usdtContract,
      fetchedAt: new Date(),
      wallets: [],
      totals: { hotNative: 0, hotUsdt: 0, depositNative: 0, depositUsdt: 0, unsweptOrders: 0 },
      cached: false,
    };
  }

  const derivedRows = await CryptoOrderModel.aggregate<{
    _id: string;
    derivIndex: number;
    paidOrderCount: number;
    unsweptOrderCount: number;
    totalUsdtClaimed: number;
  }>([
    { $match: { network: chainKey, contractAddress: chain.usdtContract, derivIndex: { $exists: true } } },
    {
      $group: {
        _id: "$depositAddress",
        derivIndex: { $first: "$derivIndex" },
        paidOrderCount: { $sum: { $cond: [{ $eq: ["$status", "paid"] }, 1, 0] } },
        unsweptOrderCount: {
          $sum: { $cond: [{ $and: [{ $eq: ["$status", "paid"] }, { $eq: ["$sweptAt", null] }] }, 1, 0] },
        },
        totalUsdtClaimed: { $sum: { $ifNull: ["$actualUsdt", 0] } },
      },
    },
    { $sort: { unsweptOrderCount: -1, paidOrderCount: -1 } },
    { $limit: 50 },
  ]);

  const safe = async (fn: () => Promise<number>): Promise<number | null> => {
    try {
      return await fn();
    } catch (e) {
      console.warn("[evmWalletOps] balance fetch failed:", (e as Error).message);
      return null;
    }
  };

  const wallets: EvmWalletEntry[] = [];
  const [hotNative, hotUsdt] = await Promise.all([
    safe(() => fetchNativeBalance(chainKey, hot.address)),
    safe(() => fetchUsdtBalance(chainKey, hot.address)),
  ]);
  wallets.push({
    role: "hot",
    index: hot.index,
    address: hot.address,
    nativeBalance: hotNative == null ? null : +hotNative.toFixed(6),
    usdtBalance: hotUsdt == null ? null : +hotUsdt.toFixed(6),
  });

  let depositNative = 0;
  let depositUsdt = 0;
  let unsweptOrders = 0;
  for (const row of derivedRows) {
    const nativeBal = await safe(() => fetchNativeBalance(chainKey, row._id));
    const usdtBal = await safe(() => fetchUsdtBalance(chainKey, row._id));
    if (nativeBal != null) depositNative += nativeBal;
    if (usdtBal != null) depositUsdt += usdtBal;
    unsweptOrders += row.unsweptOrderCount;
    wallets.push({
      role: "deposit",
      index: row.derivIndex,
      address: row._id,
      nativeBalance: nativeBal == null ? null : +nativeBal.toFixed(6),
      usdtBalance: usdtBal == null ? null : +usdtBal.toFixed(6),
      paidOrderCount: row.paidOrderCount,
      unsweptOrderCount: row.unsweptOrderCount,
      totalUsdtClaimed: +row.totalUsdtClaimed.toFixed(6),
    });
  }

  const result: EvmWalletsListResult = {
    chain: chainKey,
    contract: chain.usdtContract,
    fetchedAt: new Date(),
    wallets,
    totals: {
      hotNative: hotNative ?? 0,
      hotUsdt: hotUsdt ?? 0,
      depositNative: +depositNative.toFixed(6),
      depositUsdt: +depositUsdt.toFixed(6),
      unsweptOrders,
    },
    cached: false,
  };
  cacheByChain.set(chainKey, { at: Date.now(), result });
  return result;
};

export const fetchEvmAddressBalance = async (
  chainKey: EvmChainKey,
  address: string,
): Promise<{ address: string; nativeBalance: number | null; usdtBalance: number | null; fetchedAt: Date }> => {
  let nativeBalance: number | null = null;
  let usdtBalance: number | null = null;
  try { nativeBalance = +(await fetchNativeBalance(chainKey, address)).toFixed(6); } catch { /* leave null */ }
  try { usdtBalance = +(await fetchUsdtBalance(chainKey, address)).toFixed(6); } catch { /* leave null */ }
  cacheByChain.delete(chainKey);
  return { address, nativeBalance, usdtBalance, fetchedAt: new Date() };
};
