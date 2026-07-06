import * as bip39 from "bip39";
import { ethers } from "ethers";
import { config } from "../config";
import { nextSeq } from "../db/models/Counter";
import { EVM_CHAIN_KEYS } from "./evmChains";

/**
 * HD-wallet helpers for EVM deposit addresses — mirrors wallet.ts (TRON)
 * but derives via m/44'/60'/0'/0/N (ETH SLIP-44 = 60). One derived address
 * is valid on Polygon, BSC, and Ethereum alike, so a single index serves
 * whichever EVM chain an order specifies. Index 0 = hot wallet (same
 * convention as TRON's wallet.ts).
 */
export interface DerivedEvmAccount {
  index: number;
  /** Checksummed 0x address. */
  address: string;
  /** 0x-prefixed 64-hex private key. Treat as secret. */
  privateKey: string;
  path: string;
}

const derivationPath = (index: number): string => `m/44'/60'/0'/0/${index}`;

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

export const deriveEvmAccount = (index: number): DerivedEvmAccount => {
  const seed = getSeed();
  const path = derivationPath(index);
  const root = ethers.HDNodeWallet.fromSeed(seed);
  const child = root.derivePath(path);
  return {
    index,
    address: child.address,
    privateKey: child.privateKey,
    path,
  };
};

/** Operator hot wallet — index 0, same slot convention as TRON's wallet.ts. */
export const evmHotWallet = (): DerivedEvmAccount =>
  deriveEvmAccount(config.cryptoHotWalletIndex);

/** Atomically allocate the next EVM derivation index, skipping the hot-wallet slot. */
export const allocNextEvmDepositIndex = async (): Promise<number> => {
  let n = await nextSeq("crypto_deriv_index_evm");
  while (n === config.cryptoHotWalletIndex) {
    n = await nextSeq("crypto_deriv_index_evm");
  }
  return n;
};

/**
 * Allocate an EVM deposit address, reusing a finalized+cooled-down one when
 * possible (same reuse strategy as TRON's allocateAddress). Reuse candidates
 * are pooled ACROSS all three EVM networks — a single derived index/address
 * backs orders on whichever EVM chain requested it, so recycling looks at
 * every EVM order regardless of which of the three chains it was on.
 */
export const allocateEvmAddress = async (network: string): Promise<DerivedEvmAccount> => {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { CryptoOrderModel } = require("../db/models/CryptoOrder") as typeof import("../db/models/CryptoOrder");

  const now = Date.now();
  const cutoff = new Date(now - config.cryptoAddressReuseCooldownMs);

  const candidates = await CryptoOrderModel.find(
    {
      network: { $in: EVM_CHAIN_KEYS },
      $or: [
        { status: "paid", paidAt: { $lt: cutoff } },
        { status: { $in: ["expired", "cancelled"] }, expiresAt: { $lt: cutoff } },
      ],
    },
    { derivIndex: 1, depositAddress: 1, paidAt: 1, expiresAt: 1 },
  )
    .sort({ paidAt: 1, expiresAt: 1 })
    .limit(20)
    .lean();

  for (const c of candidates) {
    const inUse = await CryptoOrderModel.exists({
      depositAddress: c.depositAddress,
      status: "pending",
      network: { $in: EVM_CHAIN_KEYS },
      expiresAt: { $gt: new Date() },
    });
    if (!inUse) {
      console.log(`[evmWallet] reusing address ${c.depositAddress.slice(0, 10)}… (index ${c.derivIndex}) for ${network}`);
      return deriveEvmAccount(c.derivIndex);
    }
  }

  const fresh = await allocNextEvmDepositIndex();
  console.log(`[evmWallet] allocating fresh EVM address at index ${fresh} for ${network}`);
  return deriveEvmAccount(fresh);
};
