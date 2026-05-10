/**
 * sweep-deposits.ts — manual sweep of paid deposit addresses → hot wallet.
 *
 * Run periodically (cron / manual) on the server:
 *   docker compose exec api node dist/tools/sweep-deposits.js [--dry-run]
 *
 * What it does:
 *   1. Find CryptoOrders with status=paid AND sweptAt=null
 *   2. For each one's depositAddress:
 *      a. Query USDT balance (skip if 0)
 *      b. If TRX < SWEEP_GAS_RESERVE, transfer TRX from hot wallet
 *      c. Send all USDT from depositAddress → hot wallet
 *      d. Mark sweptAt + sweptTxHash in DB
 *
 * SAFETY:
 *   • --dry-run flag previews actions without sending tx.
 *   • Hot wallet must have enough TRX to fund gas top-ups.
 *   • Each sweep costs ~10-20 TRX in fees (TRX top-up + USDT transfer gas).
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

  const orders = await CryptoOrderModel.find({
    status: "paid",
    sweptAt: null,
    network: config.tronNetwork,
  }).sort({ paidAt: 1 });

  console.log(`[sweep] ${orders.length} paid order(s) to sweep`);
  if (orders.length === 0) return;

  // We'll need a TronWeb instance with the hot wallet's privKey to fund gas.
  const hotClient = buildClient(hot.privateKey);

  let successCount = 0;
  let totalUsdt = 0;

  for (const order of orders) {
    const acct = deriveAccount(order.derivIndex);
    if (acct.address !== order.depositAddress) {
      console.error(
        `[sweep] derivIndex ${order.derivIndex} produced ${acct.address} but order has ${order.depositAddress} — skipping`,
      );
      continue;
    }

    const subClient = buildClient(acct.privateKey);

    // Query USDT balance on the deposit address.
    const usdtContract = await subClient.contract().at(order.contractAddress);
    const balRaw: bigint = await usdtContract.balanceOf(acct.address).call();
    const balance = Number(balRaw) / 1e6;
    if (balance <= 0) {
      console.log(`[sweep] ${order.orderId.slice(0, 8)}… ${acct.address.slice(0, 10)}… USDT=0  skipping`);
      continue;
    }

    // Query TRX balance for gas.
    const trxBalSun = await subClient.trx.getBalance(acct.address);
    const trxBalance = trxBalSun / 1e6;

    console.log(
      `[sweep] ${order.orderId.slice(0, 8)}… ${acct.address.slice(0, 10)}…  ` +
        `USDT=${balance.toFixed(2)}  TRX=${trxBalance.toFixed(2)}`,
    );

    // Top up TRX if low.
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
        // Wait for funding to settle.
        await new Promise((r) => setTimeout(r, 4000));
      }
    }

    // Sweep USDT.
    console.log(`  → transferring ${balance.toFixed(6)} USDT → hot wallet`);
    if (dryRun) {
      console.log("    [dry-run] would call usdtContract.transfer(hot, balance)");
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

    order.sweptAt = new Date();
    order.sweptTxHash = sweepTxId;
    await order.save();
    successCount++;
    totalUsdt += balance;
    console.log(`  ✓ swept ${sweepTxId.slice(0, 12)}…`);
  }

  console.log("");
  console.log(`[sweep] done — swept ${successCount}/${orders.length} orders, ${totalUsdt.toFixed(2)} USDT total`);
  process.exit(0);
};

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
