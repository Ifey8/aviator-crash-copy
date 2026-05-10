/**
 * transfer-out.ts — manually move funds OUT of the operator hot wallet.
 *
 * Two destinations supported:
 *   • personal TRC20 wallet (e.g. exchange deposit address, hardware wallet)
 *   • another HD-derived index (rare; for cold-storage rotation)
 *
 * Usage (from /opt/aviator/aviator-back):
 *   docker compose exec api node dist/tools/transfer-out.js \
 *     --to TXxxxxxxxxxxxxxxx \
 *     --amount-usdt 100 \
 *     [--dry-run]
 *
 *   docker compose exec api node dist/tools/transfer-out.js \
 *     --to TYxxxxxxxxxxxxxxx \
 *     --amount-trx 50 \
 *     [--dry-run]
 *
 * Why a CLI rather than just using TronLink?
 *   • Mnemonic / private key NEVER leaves the server
 *   • Audit trail in shell history + container logs
 *   • Atomic from operator's POV — one command, no clipboard mistakes
 *
 * Safety:
 *   • --dry-run flag shows what would be sent without broadcasting
 *   • Refuses if destination starts with non-T or wrong length
 *   • Refuses if hot wallet doesn't have enough balance
 *   • Recommends 1-token test transfer first
 */
import { config } from "../config";
import { hotWallet } from "../payment/wallet";
// eslint-disable-next-line @typescript-eslint/no-var-requires
const TronWeb = require("tronweb").TronWeb;

const argv = process.argv.slice(2);
const arg = (k: string): string | undefined => {
  const i = argv.indexOf(k);
  return i >= 0 ? argv[i + 1] : undefined;
};
const flag = (k: string): boolean => argv.includes(k);

const TRC20_RE = /^T[1-9A-HJ-NP-Za-km-z]{33}$/;

const usage = () => {
  console.error("Usage:");
  console.error("  --to <TRC20-address>     destination address (T..., 34 chars)");
  console.error("  --amount-usdt <number>   amount of USDT to send  (mutually exclusive)");
  console.error("  --amount-trx <number>    amount of TRX to send   (mutually exclusive)");
  console.error("  --dry-run                preview, don't broadcast");
  process.exit(2);
};

const main = async (): Promise<void> => {
  const to = arg("--to");
  const usdtAmt = arg("--amount-usdt");
  const trxAmt = arg("--amount-trx");
  const dryRun = flag("--dry-run");

  if (!to || !TRC20_RE.test(to)) {
    console.error("--to is required and must be a valid TRC20 address (T... 34 chars)");
    usage();
    return;
  }
  if (!!usdtAmt === !!trxAmt) {
    console.error("Specify exactly one of --amount-usdt or --amount-trx");
    usage();
    return;
  }
  if (!config.cryptoMasterMnemonic) {
    console.error("CRYPTO_MASTER_MNEMONIC not set in .env");
    process.exit(2);
  }

  const hot = hotWallet();
  console.log(`[transfer-out] hot wallet: ${hot.address} (index ${hot.index})`);
  console.log(`[transfer-out] destination: ${to}`);
  console.log(`[transfer-out] dry-run: ${dryRun}`);

  if (hot.address === to) {
    console.error("Destination equals hot wallet — refusing.");
    process.exit(2);
  }

  const tron = new TronWeb({
    fullHost:
      config.tronNetwork === "mainnet"
        ? "https://api.trongrid.io"
        : "https://api.shasta.trongrid.io",
    headers: config.trongridApiKey
      ? { "TRON-PRO-API-KEY": config.trongridApiKey }
      : {},
    privateKey: hot.privateKey,
  });

  // Always show pre-flight balances
  const trxBalSun: number = await tron.trx.getBalance(hot.address);
  const trxBal = trxBalSun / 1e6;
  let usdtBal = 0;
  if (config.tronContract) {
    const c = await tron.contract().at(config.tronContract);
    const bRaw: bigint = await c.balanceOf(hot.address).call();
    usdtBal = Number(bRaw) / 1e6;
  }
  console.log(
    `[transfer-out] hot wallet balance: TRX=${trxBal.toFixed(4)}  USDT=${usdtBal.toFixed(4)}`,
  );

  // ------- USDT path -------
  if (usdtAmt) {
    if (!config.tronContract) {
      console.error("TRON_USDT_CONTRACT not set");
      process.exit(2);
    }
    const amt = Number(usdtAmt);
    if (!isFinite(amt) || amt <= 0) {
      console.error("Invalid --amount-usdt");
      process.exit(2);
    }
    if (amt > usdtBal) {
      console.error(`Hot wallet has only ${usdtBal} USDT (requested ${amt})`);
      process.exit(2);
    }
    if (trxBal < 15) {
      console.error(`Hot wallet has only ${trxBal} TRX — USDT transfer needs ~15 TRX gas`);
      process.exit(2);
    }
    const raw = BigInt(Math.round(amt * 1e6));
    console.log(
      `[transfer-out] would send ${amt} USDT (raw=${raw}) → ${to}`,
    );
    if (dryRun) {
      console.log("[transfer-out] dry-run — no broadcast");
      return;
    }
    const c = await tron.contract().at(config.tronContract);
    const tx = await c.transfer(to, raw).send();
    const txId = typeof tx === "string" ? tx : tx?.txid || JSON.stringify(tx);
    console.log(`[transfer-out] ✓ sent: ${txId}`);
    console.log(
      `[transfer-out] verify: https://${config.tronNetwork === "mainnet" ? "" : "shasta."}tronscan.org/#/transaction/${txId}`,
    );
    return;
  }

  // ------- TRX path -------
  if (trxAmt) {
    const amt = Number(trxAmt);
    if (!isFinite(amt) || amt <= 0) {
      console.error("Invalid --amount-trx");
      process.exit(2);
    }
    // Reserve a few TRX for future gas needs; refuse if it would empty the wallet
    const reserve = 5;
    if (amt + reserve > trxBal) {
      console.error(
        `Refusing — would leave less than ${reserve} TRX gas reserve. Hot=${trxBal} req=${amt}`,
      );
      process.exit(2);
    }
    const sun = Math.round(amt * 1e6);
    console.log(`[transfer-out] would send ${amt} TRX (${sun} sun) → ${to}`);
    if (dryRun) {
      console.log("[transfer-out] dry-run — no broadcast");
      return;
    }
    const tx = await tron.trx.sendTransaction(to, sun);
    if (!tx.result) {
      console.error("[transfer-out] failed:", tx);
      process.exit(1);
    }
    const txId: string = tx.txid || tx.transaction?.txID || "<unknown>";
    console.log(`[transfer-out] ✓ sent: ${txId}`);
    console.log(
      `[transfer-out] verify: https://${config.tronNetwork === "mainnet" ? "" : "shasta."}tronscan.org/#/transaction/${txId}`,
    );
    return;
  }
};

main().catch((e) => {
  console.error("[transfer-out]", e);
  process.exit(1);
});
