import * as bip39 from "bip39";
import HDKey from "hdkey";
// tronweb's typings still aren't great in v6; use require() for the
// constructor and dynamically type via DefaultTronWeb.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const TronWeb = require("tronweb").TronWeb;
import { config } from "../config";
import { nextSeq } from "../db/models/Counter";

/**
 * HD-wallet helpers for the per-order deposit-address scheme.
 *
 * The server holds a SINGLE master mnemonic (`CRYPTO_MASTER_MNEMONIC` env).
 * From it we derive an unbounded family of TRON addresses via BIP44:
 *
 *   m / 44' / 195' / 0' / 0 / N        (TRON SLIP-44 = 195)
 *
 * Index 0 is reserved as the operator's HOT WALLET — collected funds are
 * swept here. Indexes 1..∞ are per-order deposit addresses; each order
 * gets a fresh one and the user sends ANY amount of USDT to it.
 *
 * Why not use the user's own TronLink seed?
 *   • Hot-wallet model is operator-controlled; the server signs sweeps.
 *   • Mixing the user's wallet seed into the server is a privacy +
 *     security disaster — never do it.
 *
 * Master seed safety
 *   • Stored in `aviator-back/.env` as CRYPTO_MASTER_MNEMONIC (12 words)
 *   • DB stores only the derivation index; private keys are derived
 *     on-demand from the master seed when sweeping.
 *   • If the .env leaks, the attacker controls every deposit address +
 *     hot wallet. KEEP IT BACKED UP OFF-LINE (paper / hardware token).
 */

export interface DerivedAccount {
  index: number;
  /** TRON base58 address (T... 34 chars) */
  address: string;
  /** 64-char hex private key. Treat as secret. */
  privateKey: string;
  /** BIP44 path used. */
  path: string;
}

const derivationPath = (index: number): string => `m/44'/195'/0'/0/${index}`;

let cachedSeed: Buffer | null = null;
const getSeed = (): Buffer => {
  if (cachedSeed) return cachedSeed;
  const m = (config.cryptoMasterMnemonic || "").trim();
  if (!m) {
    throw new Error(
      "CRYPTO_MASTER_MNEMONIC is empty. Generate one with `node dist/tools/gen-master-seed.js` and put it in aviator-back/.env",
    );
  }
  if (!bip39.validateMnemonic(m)) {
    throw new Error("CRYPTO_MASTER_MNEMONIC failed BIP39 validation (check word list / count)");
  }
  cachedSeed = bip39.mnemonicToSeedSync(m);
  return cachedSeed;
};

/** Derive the {address, privateKey} pair at a specific index. */
export const deriveAccount = (index: number): DerivedAccount => {
  const seed = getSeed();
  const root = HDKey.fromMasterSeed(seed);
  const child = root.derive(derivationPath(index));
  if (!child.privateKey) throw new Error("HDKey produced empty privateKey");
  const privateKey = child.privateKey.toString("hex");
  // TronWeb derives the address from the private key without requiring a node.
  const address: string = TronWeb.address.fromPrivateKey(privateKey);
  if (!address || !address.startsWith("T")) {
    throw new Error(`Derived address malformed at index ${index}: ${address}`);
  }
  return {
    index,
    address,
    privateKey,
    path: derivationPath(index),
  };
};

/** Operator hot wallet — index 0. Receives sweeps. */
export const hotWallet = (): DerivedAccount =>
  deriveAccount(config.cryptoHotWalletIndex);

/**
 * Atomically allocate the next deposit-address index for a new order.
 * Skips the hot-wallet index (0 by default).
 */
export const allocNextDepositIndex = async (): Promise<number> => {
  // Counter starts at 0; first call returns 1, second 2, ...
  // If hot wallet is at index 0, this naturally skips it.
  let n = await nextSeq("crypto_deriv_index");
  while (n === config.cryptoHotWalletIndex) {
    n = await nextSeq("crypto_deriv_index");
  }
  return n;
};
