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

const EVM_ADDR_RE = /^0x[0-9a-fA-F]{40}$/;

export interface EvmTransferOutInput {
  chainKey: EvmChainKey;
  to: string;
  amountUsdt?: number;
  amountNative?: number;
  dryRun?: boolean;
}

export interface EvmTransferOutResult {
  ok: boolean;
  dryRun: boolean;
  reason?: string;
  txHash?: string;
  from: string;
  to: string;
  amount: number;
  currency: string;
  preBalance: { native: number; usdt: number };
}

/** Manual outbound from the EVM hot wallet — mirrors walletOps.ts's transferOut. */
export const transferOut = async (input: EvmTransferOutInput): Promise<EvmTransferOutResult> => {
  const chain = getEvmChain(input.chainKey);
  const currency = input.amountUsdt ? "USDT" : (chain?.nativeSymbol || "");
  const fail = (reason: string, from = "", pre = { native: 0, usdt: 0 }): EvmTransferOutResult => ({
    ok: false, dryRun: !!input.dryRun, reason, from, to: input.to || "",
    amount: input.amountUsdt ?? input.amountNative ?? 0, currency, preBalance: pre,
  });

  if (!chain) return fail(`Unknown chain ${input.chainKey}`);
  if (!input.to || !EVM_ADDR_RE.test(input.to)) return fail("Invalid EVM address (must be 0x + 40 hex chars)");
  if (!!input.amountUsdt === !!input.amountNative) return fail("Specify exactly one of amountUsdt or amountNative");

  let hot;
  try {
    hot = evmHotWallet();
  } catch (e) {
    return fail((e as Error).message);
  }
  if (input.to.toLowerCase() === hot.address.toLowerCase()) return fail("Destination equals hot wallet — refused", hot.address);

  const provider = getProvider(input.chainKey);
  const signer = new ethers.Wallet(hot.privateKey, provider);
  const nativeBal = Number(ethers.formatEther(await provider.getBalance(hot.address)));
  const c = new ethers.Contract(chain.usdtContract, ERC20_ABI, provider);
  const usdtBal = Number(ethers.formatUnits(await c.balanceOf(hot.address), chain.usdtDecimals));
  const pre = { native: +nativeBal.toFixed(6), usdt: +usdtBal.toFixed(6) };

  if (input.amountUsdt) {
    if (input.amountUsdt > usdtBal) return fail(`Hot wallet has only ${usdtBal} USDT (requested ${input.amountUsdt})`, hot.address, pre);
    if (nativeBal < chain.gasReserve) {
      return fail(`Hot wallet has only ${nativeBal.toFixed(4)} ${chain.nativeSymbol} — USDT transfer needs ~${chain.gasReserve} ${chain.nativeSymbol} gas`, hot.address, pre);
    }
    if (input.dryRun) return { ok: true, dryRun: true, from: hot.address, to: input.to, amount: input.amountUsdt, currency: "USDT", preBalance: pre };
    const cSigner = new ethers.Contract(chain.usdtContract, ERC20_ABI, signer);
    const raw = ethers.parseUnits(input.amountUsdt.toFixed(chain.usdtDecimals), chain.usdtDecimals);
    const tx = await cSigner.transfer(input.to, raw);
    const receipt = await tx.wait();
    return { ok: true, dryRun: false, txHash: receipt?.hash || tx.hash, from: hot.address, to: input.to, amount: input.amountUsdt, currency: "USDT", preBalance: pre };
  }

  const reserve = chain.gasReserve;
  if (input.amountNative! + reserve > nativeBal) {
    return fail(`Refusing — would leave less than ${reserve} ${chain.nativeSymbol} gas reserve. Hot=${nativeBal.toFixed(4)} req=${input.amountNative}`, hot.address, pre);
  }
  if (input.dryRun) return { ok: true, dryRun: true, from: hot.address, to: input.to, amount: input.amountNative!, currency: chain.nativeSymbol, preBalance: pre };
  const tx = await signer.sendTransaction({ to: input.to, value: ethers.parseEther(input.amountNative!.toString()) });
  const receipt = await tx.wait();
  return { ok: true, dryRun: false, txHash: receipt?.hash || tx.hash, from: hot.address, to: input.to, amount: input.amountNative!, currency: chain.nativeSymbol, preBalance: pre };
};
