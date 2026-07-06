import * as bip39 from "bip39";

// deriveEvmAccount reads config.cryptoMasterMnemonic lazily on each call,
// so we can set a throwaway test mnemonic before importing.
process.env.CRYPTO_MASTER_MNEMONIC = bip39.generateMnemonic();

import { deriveEvmAccount, evmHotWallet } from "../src/payment/evmWallet";

describe("evmWallet derivation", () => {
  test("derives a checksummed 0x address deterministically for the same index", () => {
    const a = deriveEvmAccount(3);
    const b = deriveEvmAccount(3);
    expect(a.address).toBe(b.address);
    expect(a.privateKey).toBe(b.privateKey);
    expect(a.address).toMatch(/^0x[0-9a-fA-F]{40}$/);
    expect(a.path).toBe("m/44'/60'/0'/0/3");
  });

  test("different indexes derive different addresses", () => {
    const a = deriveEvmAccount(1);
    const b = deriveEvmAccount(2);
    expect(a.address).not.toBe(b.address);
  });

  test("evmHotWallet derives index 0 by default", () => {
    const hot = evmHotWallet();
    const zero = deriveEvmAccount(0);
    expect(hot.address).toBe(zero.address);
  });

  test("throws a clear error when CRYPTO_MASTER_MNEMONIC is empty", () => {
    const prev = process.env.CRYPTO_MASTER_MNEMONIC;
    process.env.CRYPTO_MASTER_MNEMONIC = "";
    jest.resetModules();
    const { deriveEvmAccount: reloaded } = require("../src/payment/evmWallet");
    expect(() => reloaded(0)).toThrow(/CRYPTO_MASTER_MNEMONIC is empty/);
    process.env.CRYPTO_MASTER_MNEMONIC = prev;
    jest.resetModules();
  });
});
