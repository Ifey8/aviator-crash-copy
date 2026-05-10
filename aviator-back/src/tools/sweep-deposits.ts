/**
 * sweep-deposits.ts — manual sweep of paid deposit addresses → hot wallet.
 *
 * Run periodically (cron / manual):
 *   docker compose exec api node dist/tools/sweep-deposits.js [--dry-run]
 *
 * What it does (per-ADDRESS, not per-order — addresses are recycled):
 *   1. Group paid+un-swept orders by depositAddress
 *   2. For each address with non-zero USDT balance:
 *      a. Top up TRX from hot wallet if balance < gas reserve
 *      b. Send all USDT from depositAddress → hot wallet
 *      c. Mark all backing orders sweptAt + sweptTxHash
 *
 * Address-level grouping means N orders sharing 1 address = 1 sweep
 * (way cheaper than 1 sweep per order in the old design).
 *
 * SAFETY:
 *   • --dry-run flag previews actions without sending tx
 *   • Hot wallet must have enough TRX to fund gas top-ups
 *   • Each sweep costs ~10-20 TRX in fees
 */
import { connectDb } from "../db/connection";
import { CryptoOrderModel } from "../db/models/CryptoOrder";
import { config } from "../config";
import { deriveAccount, hotWallet } from "../payment/wallet";
// eslint-disable-next-line @typescript-eslint/no-var-requires
const TronWeb = require("tronweb").TronWeb;

const dryRun = process.argv.includes("--dry-run");

const buildClient = (privateKey: string) =>
  new TronWeb({
    fullHost:
      config.tronNetwork === "mainnet"
        ? "https://api.trongrid.io"
        : "https://api.shasta.trongrid.io",
    headers: config.trongridApiKey ? { "TRON-PRO-API-KEY": config.trongridApiKey } : {},
    privateKey,
  });

const main = async (): Promise<void> => {
  await connectDb();

  if (!config.cryptoMasterMnemonic) {
    console.error("CRYPTO_MASTER_MNEMONIC not set");
    process.exit(2);
  }
  if (!config.tronContract) {
    console.error("TRON_USDT_CONTRACT not set");
    process.exit(2);
  }

  const hot = hotWallet();
  console.log(`[sweep] hot wallet: ${hot.address} (index ${hot.index})`);
  console.log(`[sweep] dry run: ${dryRun}`);

  // Group paid+un-swept orders by depositAddress so we sweep each address
  // ONCE regardless of how many orders shared it.
  const grouped = await CryptoOrderModel.aggregate<{
    _id: string;            // depositAddress
    derivIndex: number;
    orderIds: string[];
    totalUsdt: number;
  }>([
    {
      $match: {
        status: "paid",
        sweptAt: null,
        network: config.tronNetwork,
        contractAddress: config.tronContract,
      },
    },
    {
      $group: {
        _id: "$depositAddress",
        derivIndex: { $first: "$derivIndex" },
        orderIds: { $push: "$orderId" },
        totalUsdt: { $sum: "$actualUsdt" },
      },
    },
    { $sort: { totalUsdt: -1 } },
  ]);

  console.log(`[sweep] ${grouped.length} address(es) with un-swept funds (${grouped.reduce((s, g) => s + g.totalUsdt, 0).toFixed(2)} USDT total expected)`);
  if (grouped.length === 0) return;

  const hotClient = buildClient(hot.privateKey);

  let successCount = 0;
  let totalSweptUsdt = 0;

  for (const grp of grouped) {
    const acct = deriveAccount(grp.derivIndex);
    if (acct.address !== grp._id) {
      console.error(
        `[sweep] derivIndex ${grp.derivIndex} produced ${acct.address} but DB has ${grp._id} — skipping`,
      );
      continue;
    }

    const subClient = buildClient(acct.privateKey);

    // Query the actual on-chain USDT balance (not the DB sum, in case of
    // late deposits we don't know about).
    const usdtContract = await subClient.contract().at(config.tronContract);
    const balRaw: bigint = await usdtContract.balanceOf(acct.address).call();
    const balance = Number(balRaw) / 1e6;
    if (balance <= 0) {
      console.log(`[sweep] ${acct.address.slice(0, 10)}… on-chain USDT=0  marking ${grp.orderIds.length} order(s) swept anyway`);
      // Mark swept so we don't re-check forever.
      if (!dryRun) {
        await CryptoOrderModel.updateMany(
          { orderId: { $in: grp.orderIds } },
          { $set: { sweptAt: new Date(), sweptTxHash: "no-balance" } },
        );
      }
      continue;
    }

    const trxBalSun = await subClient.trx.getBalance(acct.address);
    const trxBalance = trxBalSun / 1e6;

    console.log(
      `[sweep] ${acct.address.slice(0, 10)}…  ` +
        `USDT=${balance.toFixed(2)}  TRX=${trxBalance.toFixed(2)}  ` +
        `orders=${grp.orderIds.length}`,
    );

    if (trxBalance < config.cryptoSweepGasReserveTrx) {
      const need = config.cryptoSweepGasReserveTrx - trxBalance;
      console.log(`  → topping up ${need.toFixed(2)} TRX from hot wallet`);
      if (!dryRun) {
        const tx = await hotClient.trx.sendTransaction(
          acct.address,
          Math.round(need * 1e6),
        );
        if (!tx.result) {
          console.error("  TRX top-up failed:", tx);
          continue;
        }
        await new Promise((r) => setTimeout(r, 4000));
      }
    }

    console.log(`  → transferring ${balance.toFixed(6)} USDT → hot wallet`);
    if (dryRun) {
      console.log(`    [dry-run] would sweep + mark ${grp.orderIds.length} order(s)`);
      continue;
    }
    let sweepTxId: string;
    try {
      const tx = await usdtContract.transfer(hot.address, balRaw).send();
      sweepTxId = typeof tx === "string" ? tx : tx?.txid || JSON.stringify(tx);
    } catch (e) {
      console.error(`  USDT transfer failed:`, (e as Error).message);
      continue;
    }

    await CryptoOrderModel.updateMany(
      { orderId: { $in: grp.orderIds } },
      { $set: { sweptAt: new Date(), sweptTxHash: sweepTxId } },
    );
    successCount++;
    totalSweptUsdt += balance;
    console.log(`  ✓ swept ${sweepTxId.slice(0, 12)}… (${grp.orderIds.length} orders)`);
  }

  console.log("");
  console.log(`[sweep] done — swept ${successCount}/${grouped.length} address(es), ${totalSweptUsdt.toFixed(2)} USDT total`);
  process.exit(0);
};

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
