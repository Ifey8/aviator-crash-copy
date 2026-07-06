import { getEvmChain, isEvmChain, enabledEvmChains, EVM_CHAIN_KEYS } from "../src/payment/evmChains";

describe("evmChains registry", () => {
  test("isEvmChain recognizes the three EVM keys and rejects others", () => {
    expect(isEvmChain("polygon")).toBe(true);
    expect(isEvmChain("bsc")).toBe(true);
    expect(isEvmChain("ethereum")).toBe(true);
    expect(isEvmChain("tron")).toBe(false);
    expect(isEvmChain("mainnet")).toBe(false);
    expect(isEvmChain("")).toBe(false);
  });

  test("getEvmChain returns correct decimals per chain (BSC USDT is 18-decimal, others 6)", () => {
    expect(getEvmChain("polygon")?.usdtDecimals).toBe(6);
    expect(getEvmChain("bsc")?.usdtDecimals).toBe(18);
    expect(getEvmChain("ethereum")?.usdtDecimals).toBe(6);
    expect(getEvmChain("nope")).toBeUndefined();
  });

  test("getEvmChain returns the well-known mainnet USDT contract addresses by default", () => {
    expect(getEvmChain("polygon")?.usdtContract).toBe("0xc2132D05D31c914a87C6611C10748AEb04B58e8");
    expect(getEvmChain("bsc")?.usdtContract).toBe("0x55d398326f99059fF775485246999027B3197955");
    expect(getEvmChain("ethereum")?.usdtContract).toBe("0xdAC17F958D2ee523a2206206994597C13D831ec7");
  });

  test("ethereum is the only chain with sweepAllowed=false", () => {
    expect(getEvmChain("polygon")?.sweepAllowed).toBe(true);
    expect(getEvmChain("bsc")?.sweepAllowed).toBe(true);
    expect(getEvmChain("ethereum")?.sweepAllowed).toBe(false);
  });

  test("EVM_CHAIN_KEYS lists exactly the three supported chains", () => {
    expect(EVM_CHAIN_KEYS.sort()).toEqual(["bsc", "ethereum", "polygon"]);
  });

  test("enabledEvmChains parses EVM_CHAINS_ENABLED and ignores unknown/blank entries", () => {
    const prev = process.env.EVM_CHAINS_ENABLED;
    process.env.EVM_CHAINS_ENABLED = "polygon, bogus,,bsc";
    jest.resetModules();
    const { enabledEvmChains: reloaded } = require("../src/payment/evmChains");
    const keys = reloaded().map((c: { key: string }) => c.key).sort();
    expect(keys).toEqual(["bsc", "polygon"]);
    process.env.EVM_CHAINS_ENABLED = prev;
    jest.resetModules();
  });
});
