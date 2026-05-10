/**
 * gen-master-seed.ts — generate a fresh BIP39 12-word mnemonic for the
 * server's HD master wallet. Run this ONCE at setup.
 *
 *   docker compose exec api node dist/tools/gen-master-seed.js
 *
 * Then copy the printed mnemonic into aviator-back/.env as:
 *   CRYPTO_MASTER_MNEMONIC="word1 word2 ... word12"
 *
 * SECURITY:
 *   • The mnemonic controls every per-order deposit address + the hot wallet.
 *   • If it leaks, an attacker drains every USDT collected.
 *   • Back it up off-line (paper / hardware token / 1Password vault).
 *   • Do NOT commit it. .env is .gitignored — keep it that way.
 *
 * The script also derives + prints index 0 (hot wallet) so you can
 * verify the address looks right and fund it with TRX for sweep gas.
 */
import * as bip39 from "bip39";
import HDKey from "hdkey";
// eslint-disable-next-line @typescript-eslint/no-var-requires
const TronWeb = require("tronweb").TronWeb;

const main = (): void => {
  const mnemonic = bip39.generateMnemonic(128); // 128 bits = 12 words
  const seed = bip39.mnemonicToSeedSync(mnemonic);
  const root = HDKey.fromMasterSeed(seed);
  const hot = root.derive("m/44'/195'/0'/0/0");
  const hotAddress = TronWeb.address.fromPrivateKey(hot.privateKey!.toString("hex"));

  console.log("");
  console.log("=".repeat(72));
  console.log("  GENERATED HD MASTER MNEMONIC — server wallet for Aviator crypto pay");
  console.log("=".repeat(72));
  console.log("");
  console.log("  ┌─────────────────────────────────────────────────────────────────┐");
  console.log("  │  PASTE INTO aviator-back/.env (ONE LINE, IN QUOTES):            │");
  console.log("  └─────────────────────────────────────────────────────────────────┘");
  console.log("");
  console.log(`  CRYPTO_MASTER_MNEMONIC="${mnemonic}"`);
  console.log("");
  console.log("  Hot wallet (index 0, where sweeps land):");
  console.log(`    ${hotAddress}`);
  console.log("");
  console.log("  ⚠  BACK UP THE MNEMONIC OFF-LINE NOW.");
  console.log("     If you lose it, you lose access to every deposit address.");
  console.log("=".repeat(72));
  console.log("");
};

main();
