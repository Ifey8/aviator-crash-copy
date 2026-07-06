import { config } from "../config";

/**
 * EVM chain registry — Polygon, BSC, Ethereum mainnet.
 *
 * All three share ONE derived address family (see evmWallet.ts, BIP44
 * m/44'/60'/0'/0/N) since an EVM address is valid on every EVM chain.
 * This file only holds per-chain facts: RPC endpoint, USDT contract +
 * decimals (BSC's USDT is 18-decimal, unlike Polygon/Ethereum/TRON's 6),
 * native gas symbol, and whether auto-sweep/auto-payout may touch it.
 *
 * Ethereum's sweepAllowed=false is deliberate: gas can exceed a small
 * deposit's value, so sweep/withdrawal-broadcast there require an explicit
 * operator confirmation instead of running automatically.
 */
export type EvmChainKey = "polygon" | "bsc" | "ethereum";

export interface EvmChainConfig {
  key: EvmChainKey;
  label: string;
  chainId: number;
  usdtContract: string;
  usdtDecimals: number;
  nativeSymbol: string;
  rpcUrl: string;
  gasReserve: number;
  sweepAllowed: boolean;
}

export const EVM_CHAIN_KEYS: EvmChainKey[] = ["polygon", "bsc", "ethereum"];

const REGISTRY: Record<EvmChainKey, EvmChainConfig> = {
  polygon: {
    key: "polygon",
    label: "Polygon",
    chainId: 137,
    usdtContract: config.evmUsdtContractPolygon,
    usdtDecimals: 6,
    nativeSymbol: "MATIC",
    rpcUrl: config.evmRpcPolygon,
    gasReserve: config.cryptoSweepGasReservePolygon,
    sweepAllowed: true,
  },
  bsc: {
    key: "bsc",
    label: "BNB Smart Chain",
    chainId: 56,
    usdtContract: config.evmUsdtContractBsc,
    usdtDecimals: 18,
    nativeSymbol: "BNB",
    rpcUrl: config.evmRpcBsc,
    gasReserve: config.cryptoSweepGasReserveBsc,
    sweepAllowed: true,
  },
  ethereum: {
    key: "ethereum",
    label: "Ethereum",
    chainId: 1,
    usdtContract: config.evmUsdtContractEthereum,
    usdtDecimals: 6,
    nativeSymbol: "ETH",
    rpcUrl: config.evmRpcEthereum,
    gasReserve: config.cryptoSweepGasReserveEthereum,
    sweepAllowed: false,
  },
};

export const isEvmChain = (network: string): network is EvmChainKey =>
  (EVM_CHAIN_KEYS as string[]).includes(network);

export const getEvmChain = (key: string): EvmChainConfig | undefined =>
  isEvmChain(key) ? REGISTRY[key] : undefined;

/** Chains the operator has turned on via EVM_CHAINS_ENABLED. Empty env = none. */
export const enabledEvmChains = (): EvmChainConfig[] =>
  config.evmChainsEnabled
    .split(",")
    .map((s) => s.trim())
    .filter((s): s is EvmChainKey => isEvmChain(s))
    .map((k) => REGISTRY[k]);
