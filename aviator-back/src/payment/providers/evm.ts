import { ethers } from "ethers";
import { config } from "../../config";
import { CryptoOrderModel, CryptoOrderDoc } from "../../db/models/CryptoOrder";
import { engine } from "../../game/engine";
import { pushToUser, pushUserMyInfo } from "../../sockets";
import { triggerReferralReward } from "../referral";
import { enabledEvmChains, EvmChainConfig } from "../evmChains";

/**
 * EVM deposit watcher — mirrors providers/tron.ts's per-order polling model
 * but reads on-chain state via eth_getLogs instead of a block-explorer REST
 * API (there's no TronGrid equivalent bundled for EVM chains here).
 *
 * For each pending order, per tick: fetch USDT Transfer logs into that
 * order's deposit address, over a bounded lookback window (public RPCs cap
 * eth_getLogs range; ~3000 blocks keeps every provider happy), then claim
 * the first matching log the same way tron.ts claims a matching tx.
 *
 * One interval per enabled chain — chains tick independently so a slow/
 * rate-limited RPC on one chain doesn't delay the others.
 */

const TRANSFER_TOPIC = ethers.id("Transfer(address,address,uint256)");
const LOOKBACK_BLOCKS = 3000;

const providerCache = new Map<string, ethers.JsonRpcProvider>();
const getProvider = (chain: EvmChainConfig): ethers.JsonRpcProvider => {
  let p = providerCache.get(chain.key);
  if (!p) {
    p = new ethers.JsonRpcProvider(chain.rpcUrl, chain.chainId);
    providerCache.set(chain.key, p);
  }
  return p;
};

const addressTopic = (address: string): string => ethers.zeroPadValue(address, 32);

/** Claim a matching on-chain transfer for a pending order — mirrors tron.ts's claim(). */
const claim = async (
  order: CryptoOrderDoc,
  txHash: string,
  rawValue: bigint,
  decimals: number,
  fromAddress: string,
  blockTimestamp: number,
): Promise<void> => {
  const actualUsdt = +Number(ethers.formatUnits(rawValue, decimals)).toFixed(6);
  const actualInr = +(actualUsdt * order.fxRate).toFixed(2);

  let updated: CryptoOrderDoc | null;
  try {
    updated = await CryptoOrderModel.findOneAndUpdate(
      { orderId: order.orderId, status: "pending" },
      {
        $set: {
          status: "paid",
          paidAt: new Date(),
          txHash,
          fromAddress,
          blockTimestamp,
          actualUsdt,
          actualInr,
        },
      },
      { new: true },
    );
  } catch (e) {
    console.warn(`[evm] claim ${order.orderId} failed:`, (e as Error).message);
    return;
  }
  if (!updated) return;

  const newBalance = await engine.creditRecharge(order.userName, actualInr);
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

  await triggerReferralReward(order.userName, {
    type: "crypto",
    id: txHash,
    amountInr: actualInr,
  });

  console.log(`[evm] order ${order.orderId} paid ${actualUsdt} USDT (${order.network}) → +₹${actualInr} INR (tx ${txHash.slice(0, 10)}…)`);
};

const tickChain = async (chain: EvmChainConfig): Promise<void> => {
  await CryptoOrderModel.updateMany(
    { status: "pending", network: chain.key, expiresAt: { $lt: new Date() } },
    { $set: { status: "expired" } },
  );

  const pending = await CryptoOrderModel.find({
    status: "pending",
    network: chain.key,
    contractAddress: chain.usdtContract,
    expiresAt: { $gt: new Date() },
  });
  if (pending.length === 0) return;

  const provider = getProvider(chain);
  let latestBlock: number;
  try {
    latestBlock = await provider.getBlockNumber();
  } catch (e) {
    console.warn(`[evm:${chain.key}] getBlockNumber failed:`, (e as Error).message);
    return;
  }
  const fromBlock = Math.max(0, latestBlock - LOOKBACK_BLOCKS);

  for (const order of pending) {
    try {
      const logs = await provider.getLogs({
        address: chain.usdtContract,
        topics: [TRANSFER_TOPIC, null, addressTopic(order.depositAddress)],
        fromBlock,
        toBlock: latestBlock,
      });
      if (logs.length === 0) continue;

      // Earliest matching log first, mirroring tron.ts's oldest-first claim order.
      const sorted = [...logs].sort((a, b) => a.blockNumber - b.blockNumber);
      const log = sorted[0];
      const rawValue = BigInt(log.data);
      if (rawValue <= 0n) continue;

      const from = "0x" + log.topics[1].slice(-40);
      const block = await provider.getBlock(log.blockNumber);
      await claim(order, log.transactionHash, rawValue, chain.usdtDecimals, from, block?.timestamp ?? Math.floor(Date.now() / 1000));
    } catch (e) {
      console.warn(`[evm:${chain.key}] order ${order.orderId} poll failed:`, (e as Error).message);
    }
  }
};

const timers = new Map<string, NodeJS.Timeout>();

export const startEvmWatchers = (): void => {
  const chains = enabledEvmChains();
  if (chains.length === 0) {
    console.log("[evm] no EVM chains enabled (EVM_CHAINS_ENABLED empty) — watchers idle");
    return;
  }
  if (!config.cryptoMasterMnemonic) {
    console.warn("[evm] CRYPTO_MASTER_MNEMONIC not set — EVM orders cannot be created until you generate one");
  }
  for (const chain of chains) {
    if (timers.has(chain.key)) continue;
    console.log(`[evm] watcher started on ${chain.label} (contract=${chain.usdtContract}, interval=${config.cryptoWatchIntervalMs}ms)`);
    const run = () => tickChain(chain).catch((e) => console.error(`[evm:${chain.key}] tick error:`, e));
    run();
    timers.set(chain.key, setInterval(run, config.cryptoWatchIntervalMs));
  }
};

export const stopEvmWatchers = (): void => {
  for (const t of timers.values()) clearInterval(t);
  timers.clear();
};
