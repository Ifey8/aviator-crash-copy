# EVM Multi-Chain USDT (Polygon/BSC/Ethereum) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Polygon, BSC, and Ethereum-mainnet USDT deposits + withdrawals to `aviator-back`, alongside the existing TRON-only flow, with matching frontend chain pickers and an admin visibility panel.

**Architecture:** A fully parallel EVM subsystem (`payment/evmChains.ts`, `evmWallet.ts`, `evmWalletOps.ts`, `providers/evm.ts`) mirrors the existing TRON files 1:1 in shape, sharing one BIP44 `m/44'/60'/0'/0/N` address across all three EVM chains. Existing TRON code paths are **not modified in their TRON-only behavior** — routes gain an `if (network is EVM) { ... } else { ...existing TRON... }` branch, and the admin Wallets tab gets a new sibling EVM panel behind a chain-tab switcher rather than a rewrite of the existing 500-line TRON table.

**Tech Stack:** Node/TS/Express/Mongoose backend, `ethers` v6 (new dependency) for EVM chain interaction, React/TS frontend.

**Design doc:** `docs/superpowers/specs/2026-07-06-evm-multichain-usdt-design.md`

**Refinement vs. the design doc:** the design said `GET /admin/wallets` would aggregate TRON+EVM into one response. On inspection, the existing `WalletsTab` component (`src/components/Admin/AdminApp.tsx:1744-2029`) is TRON-specific end to end (TRC20 regex, Tronscan links, "never ERC20/BEP20" copy). Merging chains into one table risks that stable, money-handling component. Instead: new namespaced routes `GET/POST /admin/wallets/evm/:chain/*` and a new sibling `EvmWalletsPanel` component, switched via a chain-tab row above the existing (untouched) TRON table. Same user-visible outcome (multi-chain admin visibility), lower blast radius.

---

### Task 1: Add `ethers` dependency + EVM config

**Files:**
- Modify: `aviator-back/package.json`
- Modify: `aviator-back/src/config.ts`

- [ ] **Step 1: Add the `ethers` dependency**

```bash
cd aviator-back && npm install ethers@^6.13.0
```

Expected: `package.json` dependencies gains `"ethers": "^6.13.0"` (or whatever exact 6.x version npm resolves), `package-lock.json` updated.

- [ ] **Step 2: Add EVM env vars to config.ts**

In `aviator-back/src/config.ts`, insert after the existing `usdtInrRateFallback` line (currently line 56) and before the `// Production-safe default` comment block:

```ts
  // -------- Crypto (EVM chains — Polygon / BSC / Ethereum) --------
  /** Comma-separated chains to enable, e.g. "polygon,bsc". Empty = EVM deposits/withdrawals disabled. */
  evmChainsEnabled: process.env.EVM_CHAINS_ENABLED || "",
  evmRpcPolygon: process.env.EVM_RPC_POLYGON || "https://polygon-rpc.com",
  evmRpcBsc: process.env.EVM_RPC_BSC || "https://bsc-dataseed.binance.org",
  evmRpcEthereum: process.env.EVM_RPC_ETHEREUM || "https://eth.llamarpc.com",
  /** Well-known mainnet USDT contracts — override only for testnets/custom deployments. */
  evmUsdtContractPolygon: process.env.EVM_USDT_CONTRACT_POLYGON || "0xc2132D05D31c914a87C6611C10748AEb04B58e8",
  evmUsdtContractBsc: process.env.EVM_USDT_CONTRACT_BSC || "0x55d398326f99059fF775485246999027B3197955",
  evmUsdtContractEthereum: process.env.EVM_USDT_CONTRACT_ETHEREUM || "0xdAC17F958D2ee523a2206206994597C13D831ec7",
  /** Min native-gas-token balance to keep in a deposit address (sweeper tops up to this). */
  cryptoSweepGasReservePolygon: num(process.env.CRYPTO_SWEEP_GAS_RESERVE_POLYGON, 0.5),
  cryptoSweepGasReserveBsc: num(process.env.CRYPTO_SWEEP_GAS_RESERVE_BSC, 0.01),
  cryptoSweepGasReserveEthereum: num(process.env.CRYPTO_SWEEP_GAS_RESERVE_ETHEREUM, 0.02),
```

- [ ] **Step 3: Typecheck**

Run: `cd aviator-back && npm run lint`
Expected: no errors (this step only added config fields; nothing consumes them yet).

- [ ] **Step 4: Commit**

```bash
git add aviator-back/package.json aviator-back/package-lock.json aviator-back/src/config.ts
git commit -m "Add ethers dependency + EVM chain env config"
```

---

### Task 2: EVM chain registry (`payment/evmChains.ts`)

**Files:**
- Create: `aviator-back/src/payment/evmChains.ts`
- Test: `aviator-back/tests/evmChains.test.ts`

- [ ] **Step 1: Write the failing test**

Create `aviator-back/tests/evmChains.test.ts`:

```ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd aviator-back && npx jest tests/evmChains.test.ts`
Expected: FAIL — `Cannot find module '../src/payment/evmChains'`

- [ ] **Step 3: Implement the registry**

Create `aviator-back/src/payment/evmChains.ts`:

```ts
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd aviator-back && npx jest tests/evmChains.test.ts`
Expected: PASS (6 tests)

- [ ] **Step 5: Commit**

```bash
git add aviator-back/src/payment/evmChains.ts aviator-back/tests/evmChains.test.ts
git commit -m "Add EVM chain registry (Polygon/BSC/Ethereum)"
```

---

### Task 3: EVM HD wallet derivation (`payment/evmWallet.ts`)

**Files:**
- Create: `aviator-back/src/payment/evmWallet.ts`
- Test: `aviator-back/tests/evmWallet.test.ts`

- [ ] **Step 1: Write the failing test**

Create `aviator-back/tests/evmWallet.test.ts`:

```ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd aviator-back && npx jest tests/evmWallet.test.ts`
Expected: FAIL — `Cannot find module '../src/payment/evmWallet'`

- [ ] **Step 3: Implement derivation**

Create `aviator-back/src/payment/evmWallet.ts`:

```ts
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd aviator-back && npx jest tests/evmWallet.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add aviator-back/src/payment/evmWallet.ts aviator-back/tests/evmWallet.test.ts
git commit -m "Add EVM HD wallet derivation (m/44'/60'/0'/0/N, shared across chains)"
```

---

### Task 4: `WithdrawalOrder` schema — add `network` + `payoutAddress`

**Files:**
- Modify: `aviator-back/src/db/models/WithdrawalOrder.ts`

- [ ] **Step 1: Add the fields**

In `aviator-back/src/db/models/WithdrawalOrder.ts`, in the `WithdrawalOrderDoc` interface, add after the `trc20Address?: string;` line (currently line 53):

```ts
  /** Chain for USDT withdrawals: "tron" (default, backward-compat) | "polygon" | "bsc" | "ethereum". */
  network?: string;
  /** Generic destination address for EVM withdrawals (0x...). TRON withdrawals keep using trc20Address. */
  payoutAddress?: string;
```

In the `WithdrawalOrderSchema` definition, add after the `trc20Address: { type: String, index: true, sparse: true },` line (currently line 91):

```ts
  network: { type: String, default: "tron" },
  payoutAddress: { type: String, index: true, sparse: true },
```

- [ ] **Step 2: Typecheck**

Run: `cd aviator-back && npm run lint`
Expected: no errors (additive optional fields, nothing else reads them yet)

- [ ] **Step 3: Commit**

```bash
git add aviator-back/src/db/models/WithdrawalOrder.ts
git commit -m "Add network + payoutAddress fields to WithdrawalOrder for multi-chain USDT"
```

---

### Task 5: `payment/evmWalletOps.ts` — hot wallet balance + listWalletsForChain

**Files:**
- Create: `aviator-back/src/payment/evmWalletOps.ts`

No unit test for this task — mirrors `walletOps.ts`, which has no test file either (it's chain-RPC I/O, verified manually against real testnet/mainnet balances the same way the TRON version was). Verification is `npm run lint` (typecheck) here; end-to-end behavior is checked in Task 17 once the admin panel can call it.

- [ ] **Step 1: Implement hot wallet balance + wallet listing**

Create `aviator-back/src/payment/evmWalletOps.ts`:

```ts
import { ethers } from "ethers";
import { config } from "../config";
import { CryptoOrderModel } from "../db/models/CryptoOrder";
import { WithdrawalOrderModel } from "../db/models/WithdrawalOrder";
import { getEvmChain, EvmChainKey } from "./evmChains";
import { deriveEvmAccount, evmHotWallet } from "./evmWallet";
import { triggerReferralReward } from "./referral";
import { pushToUser, pushUserMyInfo } from "../sockets";

/**
 * evmWalletOps — EVM counterpart to walletOps.ts (TRON). Same exported
 * shapes (listWallets/transferOut/sweepAddresses/autoBroadcast...) so the
 * admin routes and withdrawal flow can dispatch on `network` without
 * bespoke branching logic per call site.
 *
 * All amount math for USDT uses ethers.parseUnits/formatUnits — NOT
 * float multiplication — because BSC's USDT is 18-decimal. `amount * 1e18`
 * overflows JS's safe-integer range for ordinary withdrawal amounts;
 * parseUnits parses the decimal STRING directly into a BigInt instead.
 */

const ERC20_ABI = [
  "function balanceOf(address) view returns (uint256)",
  "function transfer(address to, uint256 amount) returns (bool)",
];

const providerCache = new Map<EvmChainKey, ethers.JsonRpcProvider>();
const getProvider = (chainKey: EvmChainKey): ethers.JsonRpcProvider => {
  let p = providerCache.get(chainKey);
  if (!p) {
    const chain = getEvmChain(chainKey)!;
    p = new ethers.JsonRpcProvider(chain.rpcUrl, chain.chainId);
    providerCache.set(chainKey, p);
  }
  return p;
};

// Mirrors walletOps.ts's withRetry — free-tier public RPCs rate-limit /
// glitch occasionally; 3 attempts with linear backoff covers most of it.
// Throws (rather than returning 0) after the final attempt so callers can't
// mistake "RPC down" for "really has no balance".
const withRetry = async <T>(fn: () => Promise<T>, label: string): Promise<T> => {
  let lastErr: unknown;
  for (let i = 0; i < 3; i++) {
    try {
      return await fn();
    } catch (e) {
      lastErr = e;
      if (i < 2) await new Promise((r) => setTimeout(r, 400 + i * 600));
    }
  }
  throw new Error(`[${label}] all 3 attempts failed: ${(lastErr as Error)?.message || lastErr}`);
};

const fetchNativeBalance = async (chainKey: EvmChainKey, address: string): Promise<number> =>
  withRetry(async () => {
    const raw = await getProvider(chainKey).getBalance(address);
    return Number(ethers.formatEther(raw));
  }, `native ${address.slice(0, 8)}`);

const fetchUsdtBalance = async (chainKey: EvmChainKey, address: string): Promise<number> => {
  const chain = getEvmChain(chainKey)!;
  return withRetry(async () => {
    const c = new ethers.Contract(chain.usdtContract, ERC20_ABI, getProvider(chainKey));
    const raw: bigint = await c.balanceOf(address);
    return Number(ethers.formatUnits(raw, chain.usdtDecimals));
  }, `usdt ${address.slice(0, 8)}`);
};

export interface EvmHotWalletBalance {
  address: string;
  nativeBalance: number;
  usdtBalance: number;
}

/** Used by the withdrawal route's liquidity check (mirrors hotWallet.ts's getHotWalletBalance for TRON). */
export const getEvmHotWalletBalance = async (chainKey: EvmChainKey): Promise<EvmHotWalletBalance | null> => {
  if (!getEvmChain(chainKey)) return null;
  let hot;
  try {
    hot = evmHotWallet();
  } catch {
    return null;
  }
  try {
    const [nativeBalance, usdtBalance] = await Promise.all([
      fetchNativeBalance(chainKey, hot.address),
      fetchUsdtBalance(chainKey, hot.address),
    ]);
    return { address: hot.address, nativeBalance: +nativeBalance.toFixed(6), usdtBalance: +usdtBalance.toFixed(6) };
  } catch (e) {
    console.warn(`[evmWalletOps] hot wallet balance fetch failed for ${chainKey}:`, (e as Error).message);
    return null;
  }
};

export interface EvmWalletEntry {
  role: "hot" | "deposit";
  index: number;
  address: string;
  nativeBalance: number | null;
  usdtBalance: number | null;
  paidOrderCount?: number;
  unsweptOrderCount?: number;
  totalUsdtClaimed?: number;
}

export interface EvmWalletsListResult {
  chain: EvmChainKey;
  contract: string;
  fetchedAt: Date;
  wallets: EvmWalletEntry[];
  totals: { hotNative: number; hotUsdt: number; depositNative: number; depositUsdt: number; unsweptOrders: number };
  cached: boolean;
}

const CACHE_TTL_MS = 30_000;
const cacheByChain = new Map<EvmChainKey, { at: number; result: EvmWalletsListResult }>();

export const listWalletsForChain = async (chainKey: EvmChainKey, useCache = true): Promise<EvmWalletsListResult> => {
  const cached = cacheByChain.get(chainKey);
  if (useCache && cached && Date.now() - cached.at < CACHE_TTL_MS) {
    return { ...cached.result, cached: true };
  }

  const chain = getEvmChain(chainKey)!;
  let hot;
  try {
    hot = evmHotWallet();
  } catch {
    return {
      chain: chainKey,
      contract: chain.usdtContract,
      fetchedAt: new Date(),
      wallets: [],
      totals: { hotNative: 0, hotUsdt: 0, depositNative: 0, depositUsdt: 0, unsweptOrders: 0 },
      cached: false,
    };
  }

  const derivedRows = await CryptoOrderModel.aggregate<{
    _id: string;
    derivIndex: number;
    paidOrderCount: number;
    unsweptOrderCount: number;
    totalUsdtClaimed: number;
  }>([
    { $match: { network: chainKey, contractAddress: chain.usdtContract, derivIndex: { $exists: true } } },
    {
      $group: {
        _id: "$depositAddress",
        derivIndex: { $first: "$derivIndex" },
        paidOrderCount: { $sum: { $cond: [{ $eq: ["$status", "paid"] }, 1, 0] } },
        unsweptOrderCount: {
          $sum: { $cond: [{ $and: [{ $eq: ["$status", "paid"] }, { $eq: ["$sweptAt", null] }] }, 1, 0] },
        },
        totalUsdtClaimed: { $sum: { $ifNull: ["$actualUsdt", 0] } },
      },
    },
    { $sort: { unsweptOrderCount: -1, paidOrderCount: -1 } },
    { $limit: 50 },
  ]);

  const safe = async (fn: () => Promise<number>): Promise<number | null> => {
    try {
      return await fn();
    } catch (e) {
      console.warn("[evmWalletOps] balance fetch failed:", (e as Error).message);
      return null;
    }
  };

  const wallets: EvmWalletEntry[] = [];
  const [hotNative, hotUsdt] = await Promise.all([
    safe(() => fetchNativeBalance(chainKey, hot.address)),
    safe(() => fetchUsdtBalance(chainKey, hot.address)),
  ]);
  wallets.push({
    role: "hot",
    index: hot.index,
    address: hot.address,
    nativeBalance: hotNative == null ? null : +hotNative.toFixed(6),
    usdtBalance: hotUsdt == null ? null : +hotUsdt.toFixed(6),
  });

  let depositNative = 0;
  let depositUsdt = 0;
  let unsweptOrders = 0;
  for (const row of derivedRows) {
    const nativeBal = await safe(() => fetchNativeBalance(chainKey, row._id));
    const usdtBal = await safe(() => fetchUsdtBalance(chainKey, row._id));
    if (nativeBal != null) depositNative += nativeBal;
    if (usdtBal != null) depositUsdt += usdtBal;
    unsweptOrders += row.unsweptOrderCount;
    wallets.push({
      role: "deposit",
      index: row.derivIndex,
      address: row._id,
      nativeBalance: nativeBal == null ? null : +nativeBal.toFixed(6),
      usdtBalance: usdtBal == null ? null : +usdtBal.toFixed(6),
      paidOrderCount: row.paidOrderCount,
      unsweptOrderCount: row.unsweptOrderCount,
      totalUsdtClaimed: +row.totalUsdtClaimed.toFixed(6),
    });
  }

  const result: EvmWalletsListResult = {
    chain: chainKey,
    contract: chain.usdtContract,
    fetchedAt: new Date(),
    wallets,
    totals: {
      hotNative: hotNative ?? 0,
      hotUsdt: hotUsdt ?? 0,
      depositNative: +depositNative.toFixed(6),
      depositUsdt: +depositUsdt.toFixed(6),
      unsweptOrders,
    },
    cached: false,
  };
  cacheByChain.set(chainKey, { at: Date.now(), result });
  return result;
};

export const fetchEvmAddressBalance = async (
  chainKey: EvmChainKey,
  address: string,
): Promise<{ address: string; nativeBalance: number | null; usdtBalance: number | null; fetchedAt: Date }> => {
  let nativeBalance: number | null = null;
  let usdtBalance: number | null = null;
  try { nativeBalance = +(await fetchNativeBalance(chainKey, address)).toFixed(6); } catch { /* leave null */ }
  try { usdtBalance = +(await fetchUsdtBalance(chainKey, address)).toFixed(6); } catch { /* leave null */ }
  cacheByChain.delete(chainKey);
  return { address, nativeBalance, usdtBalance, fetchedAt: new Date() };
};
```

- [ ] **Step 2: Typecheck**

Run: `cd aviator-back && npm run lint`
Expected: no errors

- [ ] **Step 3: Commit**

```bash
git add aviator-back/src/payment/evmWalletOps.ts
git commit -m "Add evmWalletOps: hot wallet balance + per-chain wallet listing"
```

---

### Task 6: `evmWalletOps.ts` — transferOut

**Files:**
- Modify: `aviator-back/src/payment/evmWalletOps.ts`

- [ ] **Step 1: Add transferOut**

Append to `aviator-back/src/payment/evmWalletOps.ts`:

```ts
const EVM_ADDR_RE = /^0x[0-9a-fA-F]{40}$/;

export interface EvmTransferOutInput {
  chainKey: EvmChainKey;
  to: string;
  amountUsdt?: number;
  amountNative?: number;
  dryRun?: boolean;
}

export interface EvmTransferOutResult {
  ok: boolean;
  dryRun: boolean;
  reason?: string;
  txHash?: string;
  from: string;
  to: string;
  amount: number;
  currency: string;
  preBalance: { native: number; usdt: number };
}

/** Manual outbound from the EVM hot wallet — mirrors walletOps.ts's transferOut. */
export const transferOut = async (input: EvmTransferOutInput): Promise<EvmTransferOutResult> => {
  const chain = getEvmChain(input.chainKey);
  const currency = input.amountUsdt ? "USDT" : (chain?.nativeSymbol || "");
  const fail = (reason: string, from = "", pre = { native: 0, usdt: 0 }): EvmTransferOutResult => ({
    ok: false, dryRun: !!input.dryRun, reason, from, to: input.to || "",
    amount: input.amountUsdt ?? input.amountNative ?? 0, currency, preBalance: pre,
  });

  if (!chain) return fail(`Unknown chain ${input.chainKey}`);
  if (!input.to || !EVM_ADDR_RE.test(input.to)) return fail("Invalid EVM address (must be 0x + 40 hex chars)");
  if (!!input.amountUsdt === !!input.amountNative) return fail("Specify exactly one of amountUsdt or amountNative");

  let hot;
  try {
    hot = evmHotWallet();
  } catch (e) {
    return fail((e as Error).message);
  }
  if (input.to.toLowerCase() === hot.address.toLowerCase()) return fail("Destination equals hot wallet — refused", hot.address);

  const provider = getProvider(input.chainKey);
  const signer = new ethers.Wallet(hot.privateKey, provider);
  const nativeBal = Number(ethers.formatEther(await provider.getBalance(hot.address)));
  const c = new ethers.Contract(chain.usdtContract, ERC20_ABI, provider);
  const usdtBal = Number(ethers.formatUnits(await c.balanceOf(hot.address), chain.usdtDecimals));
  const pre = { native: +nativeBal.toFixed(6), usdt: +usdtBal.toFixed(6) };

  if (input.amountUsdt) {
    if (input.amountUsdt > usdtBal) return fail(`Hot wallet has only ${usdtBal} USDT (requested ${input.amountUsdt})`, hot.address, pre);
    if (nativeBal < chain.gasReserve) {
      return fail(`Hot wallet has only ${nativeBal.toFixed(4)} ${chain.nativeSymbol} — USDT transfer needs ~${chain.gasReserve} ${chain.nativeSymbol} gas`, hot.address, pre);
    }
    if (input.dryRun) return { ok: true, dryRun: true, from: hot.address, to: input.to, amount: input.amountUsdt, currency: "USDT", preBalance: pre };
    const cSigner = new ethers.Contract(chain.usdtContract, ERC20_ABI, signer);
    const raw = ethers.parseUnits(input.amountUsdt.toFixed(chain.usdtDecimals), chain.usdtDecimals);
    const tx = await cSigner.transfer(input.to, raw);
    const receipt = await tx.wait();
    return { ok: true, dryRun: false, txHash: receipt?.hash || tx.hash, from: hot.address, to: input.to, amount: input.amountUsdt, currency: "USDT", preBalance: pre };
  }

  const reserve = chain.gasReserve;
  if (input.amountNative! + reserve > nativeBal) {
    return fail(`Refusing — would leave less than ${reserve} ${chain.nativeSymbol} gas reserve. Hot=${nativeBal.toFixed(4)} req=${input.amountNative}`, hot.address, pre);
  }
  if (input.dryRun) return { ok: true, dryRun: true, from: hot.address, to: input.to, amount: input.amountNative!, currency: chain.nativeSymbol, preBalance: pre };
  const tx = await signer.sendTransaction({ to: input.to, value: ethers.parseEther(input.amountNative!.toString()) });
  const receipt = await tx.wait();
  return { ok: true, dryRun: false, txHash: receipt?.hash || tx.hash, from: hot.address, to: input.to, amount: input.amountNative!, currency: chain.nativeSymbol, preBalance: pre };
};
```

- [ ] **Step 2: Typecheck**

Run: `cd aviator-back && npm run lint`
Expected: no errors

- [ ] **Step 3: Commit**

```bash
git add aviator-back/src/payment/evmWalletOps.ts
git commit -m "Add evmWalletOps.transferOut (manual outbound from EVM hot wallet)"
```

---

### Task 7: `evmWalletOps.ts` — sweepAddresses

**Files:**
- Modify: `aviator-back/src/payment/evmWalletOps.ts`

- [ ] **Step 1: Add sweepAddresses**

Append to `aviator-back/src/payment/evmWalletOps.ts`:

```ts
export interface EvmSweepInput {
  chainKey: EvmChainKey;
  addresses?: string[];
  dryRun?: boolean;
  /** Required truthy to sweep a chain with sweepAllowed=false (Ethereum). */
  confirmedGasCost?: boolean;
}

export interface EvmSweepResult {
  ok: boolean;
  dryRun: boolean;
  attempted: number;
  swept: number;
  totalUsdt: number;
  details: Array<{
    address: string;
    derivIndex: number;
    onChainUsdt: number;
    onChainNative: number;
    orderIds: string[];
    action: "swept" | "no-balance" | "error" | "refused-gas-cost";
    txHash?: string;
    error?: string;
  }>;
}

/** Sweep paid+un-swept EVM deposit addresses → hot wallet. Mirrors walletOps.ts's sweepAddresses. */
export const sweepAddresses = async (input: EvmSweepInput): Promise<EvmSweepResult> => {
  const dryRun = !!input.dryRun;
  const chain = getEvmChain(input.chainKey);
  const empty: EvmSweepResult = { ok: false, dryRun, attempted: 0, swept: 0, totalUsdt: 0, details: [] };
  if (!chain) return empty;
  if (!chain.sweepAllowed && !input.confirmedGasCost) {
    return {
      ...empty,
      details: [{
        address: "", derivIndex: -1, onChainUsdt: 0, onChainNative: 0, orderIds: [],
        action: "refused-gas-cost",
        error: `${chain.label} sweep requires confirmedGasCost:true — gas can exceed the deposit's value`,
      }],
    };
  }
  if (!config.cryptoMasterMnemonic) return empty;

  const hot = evmHotWallet();
  const filter: Record<string, unknown> = { status: "paid", sweptAt: null, network: input.chainKey, contractAddress: chain.usdtContract };
  if (input.addresses?.length) filter.depositAddress = { $in: input.addresses };

  const grouped = await CryptoOrderModel.aggregate<{ _id: string; derivIndex: number; orderIds: string[] }>([
    { $match: filter },
    { $group: { _id: "$depositAddress", derivIndex: { $first: "$derivIndex" }, orderIds: { $push: "$orderId" } } },
  ]);

  const result: EvmSweepResult = { ok: true, dryRun, attempted: grouped.length, swept: 0, totalUsdt: 0, details: [] };
  if (grouped.length === 0) return result;

  const provider = getProvider(input.chainKey);
  const hotSigner = new ethers.Wallet(hot.privateKey, provider);

  for (const grp of grouped) {
    const acct = deriveEvmAccount(grp.derivIndex);
    if (acct.address.toLowerCase() !== grp._id.toLowerCase()) {
      result.details.push({ address: grp._id, derivIndex: grp.derivIndex, onChainUsdt: 0, onChainNative: 0, orderIds: grp.orderIds, action: "error", error: `derivIndex mismatch — expected ${grp._id} got ${acct.address}` });
      continue;
    }

    let onChainUsdt = 0;
    let onChainNative = 0;
    let balRaw: bigint = 0n;
    let balanceCheckFailed = false;
    try {
      const c = new ethers.Contract(chain.usdtContract, ERC20_ABI, provider);
      balRaw = await withRetry<bigint>(() => c.balanceOf(acct.address), `sweep.balanceOf ${acct.address.slice(0, 8)}`);
      onChainUsdt = Number(ethers.formatUnits(balRaw, chain.usdtDecimals));
      const nativeRaw = await withRetry<bigint>(() => provider.getBalance(acct.address), `sweep.native ${acct.address.slice(0, 8)}`);
      onChainNative = Number(ethers.formatEther(nativeRaw));
    } catch (e) {
      balanceCheckFailed = true;
      console.error(`[evm-sweep] balance check failed for ${acct.address}:`, (e as Error).message);
    }
    if (balanceCheckFailed) {
      result.details.push({ address: acct.address, derivIndex: acct.index, onChainUsdt: 0, onChainNative: 0, orderIds: grp.orderIds, action: "error", error: "Could not read balance after 3 retries — RPC unreachable. Order NOT marked swept." });
      continue;
    }
    if (onChainUsdt <= 0) {
      result.details.push({ address: acct.address, derivIndex: acct.index, onChainUsdt, onChainNative, orderIds: grp.orderIds, action: "no-balance" });
      if (!dryRun) {
        await CryptoOrderModel.updateMany({ orderId: { $in: grp.orderIds } }, { $set: { sweptAt: new Date(), sweptTxHash: "no-balance" } });
      }
      continue;
    }
    if (onChainNative < chain.gasReserve) {
      const need = chain.gasReserve - onChainNative;
      if (!dryRun) {
        const tx = await hotSigner.sendTransaction({ to: acct.address, value: ethers.parseEther(need.toFixed(18)) });
        await tx.wait();
        await new Promise((r) => setTimeout(r, 2000));
      }
    }
    if (dryRun) {
      result.details.push({ address: acct.address, derivIndex: acct.index, onChainUsdt, onChainNative, orderIds: grp.orderIds, action: "swept" });
      result.totalUsdt += onChainUsdt;
      result.swept++;
      continue;
    }
    try {
      const acctSigner = new ethers.Wallet(acct.privateKey, provider);
      const cSigner = new ethers.Contract(chain.usdtContract, ERC20_ABI, acctSigner);
      const tx = await cSigner.transfer(hot.address, balRaw);
      const receipt = await tx.wait();
      const txHash = receipt?.hash || tx.hash;
      await CryptoOrderModel.updateMany({ orderId: { $in: grp.orderIds } }, { $set: { sweptAt: new Date(), sweptTxHash: txHash } });
      result.details.push({ address: acct.address, derivIndex: acct.index, onChainUsdt, onChainNative, orderIds: grp.orderIds, action: "swept", txHash });
      result.totalUsdt += onChainUsdt;
      result.swept++;
    } catch (e) {
      result.details.push({ address: acct.address, derivIndex: acct.index, onChainUsdt, onChainNative, orderIds: grp.orderIds, action: "error", error: (e as Error).message });
    }
  }

  cacheByChain.delete(input.chainKey);
  return result;
};
```

- [ ] **Step 2: Typecheck**

Run: `cd aviator-back && npm run lint`
Expected: no errors

- [ ] **Step 3: Commit**

```bash
git add aviator-back/src/payment/evmWalletOps.ts
git commit -m "Add evmWalletOps.sweepAddresses (Ethereum requires explicit gas-cost confirm)"
```

---

### Task 8: `evmWalletOps.ts` — autoBroadcastUsdtWithdrawalEvm

**Files:**
- Modify: `aviator-back/src/payment/evmWalletOps.ts`

- [ ] **Step 1: Add the auto-payout broadcaster**

Append to `aviator-back/src/payment/evmWalletOps.ts`:

```ts
/**
 * Fire-and-forget USDT broadcast for an EVM withdrawal order — mirrors
 * walletOps.ts's autoBroadcastUsdtWithdrawal. Never called for Ethereum
 * (routes/withdrawal.ts's auto-payout dispatch skips chains where
 * sweepAllowed=false); this function also re-checks that gate defensively.
 */
export const autoBroadcastUsdtWithdrawalEvm = async (orderId: string): Promise<void> => {
  const order = await WithdrawalOrderModel.findOne({ orderId });
  if (!order) return;
  if (order.method !== "usdt" || order.status !== "processing") return;
  if (!order.payoutAddress || !order.network) return;
  const chain = getEvmChain(order.network);
  if (!chain || !chain.sweepAllowed) return;

  let hot;
  try {
    hot = evmHotWallet();
  } catch (e) {
    console.error("[evm-auto-payout] hot wallet derive failed:", (e as Error).message);
    return;
  }

  const provider = getProvider(order.network as EvmChainKey);
  const c = new ethers.Contract(chain.usdtContract, ERC20_ABI, provider);

  let nativeBal = 0;
  let usdtBal = 0;
  try {
    nativeBal = Number(ethers.formatEther(await provider.getBalance(hot.address)));
    usdtBal = Number(ethers.formatUnits(await c.balanceOf(hot.address), chain.usdtDecimals));
  } catch (e) {
    console.error("[evm-auto-payout] balance fetch failed:", (e as Error).message);
    return;
  }
  if (usdtBal < order.grossAmount || nativeBal < chain.gasReserve) {
    console.warn(`[evm-auto-payout] order ${orderId} skipped — hot wallet thin (USDT=${usdtBal} ${chain.nativeSymbol}=${nativeBal}, need=${order.grossAmount})`);
    await WithdrawalOrderModel.updateOne(
      { orderId, status: "processing" },
      { $set: { status: "manual_queue", failedReason: `Auto-payout skipped — hot wallet insufficient (USDT=${usdtBal.toFixed(2)})` } },
    );
    pushToUser(order.userName, "withdrawalUpdate", { orderId, status: "manual_queue" });
    return;
  }

  let txHash: string;
  try {
    const signer = new ethers.Wallet(hot.privateKey, provider);
    const cSigner = new ethers.Contract(chain.usdtContract, ERC20_ABI, signer);
    const raw = ethers.parseUnits(order.grossAmount.toFixed(chain.usdtDecimals), chain.usdtDecimals);
    const tx = await cSigner.transfer(order.payoutAddress, raw);
    const receipt = await tx.wait();
    txHash = receipt?.hash || tx.hash;
  } catch (e) {
    const msg = (e as Error).message;
    console.error(`[evm-auto-payout] broadcast FAILED for ${orderId}:`, msg);
    await WithdrawalOrderModel.updateOne(
      { orderId, status: "processing" },
      { $set: { status: "manual_queue", failedReason: `Auto-broadcast failed: ${msg.slice(0, 200)}` } },
    );
    pushToUser(order.userName, "withdrawalUpdate", { orderId, status: "manual_queue", failedReason: msg.slice(0, 200) });
    return;
  }

  const flipped = await WithdrawalOrderModel.findOneAndUpdate(
    { orderId, status: "processing" },
    { $set: { status: "paid", paidAt: new Date(), txHash, meta: { ...(order.meta || {}), autoBroadcast: true } } },
    { new: true },
  );
  if (!flipped) {
    console.warn(`[evm-auto-payout] order ${orderId} status changed during broadcast (tx ${txHash})`);
    return;
  }

  await triggerReferralReward(order.userName, {
    type: "payout",
    id: order.providerRef || order.orderId,
    amountInr: order.grossAmount * (order.fxRate || 1),
  });
  pushToUser(order.userName, "withdrawalUpdate", { orderId, status: "paid", txHash });
  pushUserMyInfo(order.userName);
  cacheByChain.delete(order.network as EvmChainKey);
  console.log(`[evm-auto-payout] ✓ ${orderId.slice(0, 8)}… sent ${order.grossAmount} USDT on ${order.network}, tx ${txHash.slice(0, 12)}…`);
};
```

- [ ] **Step 2: Typecheck**

Run: `cd aviator-back && npm run lint`
Expected: no errors

- [ ] **Step 3: Commit**

```bash
git add aviator-back/src/payment/evmWalletOps.ts
git commit -m "Add evmWalletOps.autoBroadcastUsdtWithdrawalEvm (Ethereum excluded by design)"
```

---

### Task 9: EVM deposit watcher (`payment/providers/evm.ts`)

**Files:**
- Create: `aviator-back/src/payment/providers/evm.ts`

No unit test — mirrors `providers/tron.ts` (untested; it's a polling loop against live RPC). Verified via `npm run lint` here and manually once wired into `index.ts` in Task 10.

- [ ] **Step 1: Implement the watcher**

Create `aviator-back/src/payment/providers/evm.ts`:

```ts
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
```

- [ ] **Step 2: Typecheck**

Run: `cd aviator-back && npm run lint`
Expected: no errors

- [ ] **Step 3: Commit**

```bash
git add aviator-back/src/payment/providers/evm.ts
git commit -m "Add EVM deposit watcher (eth_getLogs Transfer polling per chain)"
```

---

### Task 10: Wire EVM watchers into `index.ts`

**Files:**
- Modify: `aviator-back/src/index.ts`

- [ ] **Step 1: Import and start the watchers**

In `aviator-back/src/index.ts`, next to the existing `import { startTronWatcher } from "./payment/providers/tron";` line (currently line 16), add:

```ts
import { startEvmWatchers } from "./payment/providers/evm";
```

Next to the existing `startTronWatcher();` call (currently line 60), add:

```ts
  startTronWatcher();
  startEvmWatchers();
```

- [ ] **Step 2: Typecheck**

Run: `cd aviator-back && npm run lint`
Expected: no errors

- [ ] **Step 3: Verify the server boots locally**

Run: `cd aviator-back && npm run build && node dist/index.js` (Ctrl+C after confirming), or `npm run dev` briefly.
Expected: log line `[evm] no EVM chains enabled (EVM_CHAINS_ENABLED empty) — watchers idle` (since `.env` doesn't set `EVM_CHAINS_ENABLED` yet) and no crash.

- [ ] **Step 4: Commit**

```bash
git add aviator-back/src/index.ts
git commit -m "Start EVM deposit watchers alongside the TRON watcher at boot"
```

---

### Task 11: Extend `PayoutCreateInput` with a generic payout address

**Files:**
- Modify: `aviator-back/src/payment/payoutTypes.ts`

- [ ] **Step 1: Add the field**

In `aviator-back/src/payment/payoutTypes.ts`, in the `PayoutCreateInput` interface, add after `trc20Address?: string;` (currently line 21):

```ts
  // EVM USDT (Polygon/BSC/Ethereum)
  network?: string;
  payoutAddress?: string;
```

- [ ] **Step 2: Typecheck**

Run: `cd aviator-back && npm run lint`
Expected: no errors (optional additive fields; `MockPayoutProvider` ignores unknown-to-it fields already)

- [ ] **Step 3: Commit**

```bash
git add aviator-back/src/payment/payoutTypes.ts
git commit -m "Add network + payoutAddress to PayoutCreateInput for EVM withdrawals"
```

---

### Task 12: `routes/crypto.ts` — network-aware `/create`

**Files:**
- Modify: `aviator-back/src/routes/crypto.ts`

- [ ] **Step 1: Make `/create` dispatch by network**

In `aviator-back/src/routes/crypto.ts`, add imports after the existing `import { allocateAddress } from "../payment/wallet";` line (currently line 8):

```ts
import { allocateEvmAddress } from "../payment/evmWallet";
import { getEvmChain, isEvmChain, enabledEvmChains } from "../payment/evmChains";
```

Replace the body of the `/create` handler from the `if (!config.tronNetwork || !config.tronContract) {` check (currently lines 56-67) through the `const acct = await allocateAddress();` line (currently line 104) with:

```ts
  const network: string = (req.body?.network || config.tronNetwork || "").trim();
  const isEvm = isEvmChain(network);

  let contractAddress: string;
  if (isEvm) {
    const chain = getEvmChain(network);
    const enabled = enabledEvmChains().some((c) => c.key === network);
    if (!chain || !enabled) {
      return res.status(503).json({
        status: false,
        message: `${network} deposits are not enabled.`,
      });
    }
    if (!config.cryptoMasterMnemonic) {
      return res.status(503).json({
        status: false,
        message: "Master wallet not configured. Generate via `node dist/tools/gen-master-seed.js`.",
      });
    }
    contractAddress = chain.usdtContract;
  } else {
    if (!config.tronNetwork || !config.tronContract) {
      return res.status(503).json({
        status: false,
        message: "Crypto recharge not configured. Set TRON_NETWORK + TRON_USDT_CONTRACT.",
      });
    }
    if (!config.cryptoMasterMnemonic) {
      return res.status(503).json({
        status: false,
        message: "Master wallet not configured. Generate via `node dist/tools/gen-master-seed.js`.",
      });
    }
    contractAddress = config.tronContract;
  }
```

(keep the existing `if (!amountInr || amountInr <= 0)` check and the min/max-USDT checks below it unchanged)

Then replace the allocation + order-create block (currently lines 101-123):

```ts
  const acct = isEvm ? await allocateEvmAddress(network) : await allocateAddress();

  const orderId = randomUUID();
  const expiresAt = new Date(Date.now() + config.cryptoOrderTtlMs);

  const doc = await CryptoOrderModel.create({
    orderId,
    userName,
    amountUsdt,
    amountInr: +(amountUsdt * quote.rate).toFixed(2),
    fxRate: quote.rate,
    fxRateAt: quote.fetchedAt,
    network: isEvm ? network : config.tronNetwork,
    depositAddress: acct.address,
    derivIndex: acct.index,
    contractAddress,
    status: "pending",
    expiresAt,
    meta: { rateSource: quote.source, derivPath: acct.path },
  });
```

- [ ] **Step 2: Typecheck**

Run: `cd aviator-back && npm run lint`
Expected: no errors

- [ ] **Step 3: Verify TRON path is unchanged (existing tests still pass)**

Run: `cd aviator-back && npm test -- --testPathPattern='integration|rest'`
Expected: PASS — these exercise the recharge/game flow and would catch a regression in the still-default TRON branch. (These tests need Mongo + a running server per the repo's existing setup; if not available locally, `npm run lint` plus a manual read-through of the diff against `providers/tron.ts`'s config checks suffices — the TRON branch is a verbatim move of the previous unconditional code.)

- [ ] **Step 4: Commit**

```bash
git add aviator-back/src/routes/crypto.ts
git commit -m "Make /api/crypto/create network-aware (TRON default + EVM chains)"
```

---

### Task 13: `routes/withdrawal.ts` — network-aware USDT withdrawal

**Files:**
- Modify: `aviator-back/src/routes/withdrawal.ts`

- [ ] **Step 1: Add imports and generalize `validateUsdt`**

Add imports after the existing `import { autoBroadcastUsdtWithdrawal } from "../payment/walletOps";` line (currently line 18):

```ts
import { autoBroadcastUsdtWithdrawalEvm, getEvmHotWalletBalance } from "../payment/evmWalletOps";
import { getEvmChain, isEvmChain, EvmChainKey } from "../payment/evmChains";
```

Replace `validateUsdt` (currently lines 41-45):

```ts
const EVM_ADDR_RE = /^0x[0-9a-fA-F]{40}$/;

const validateUsdt = (u: { trc20Address?: string; network?: string }): string | null => {
  const network = (u.network || "tron").trim();
  if (isEvmChain(network)) {
    const a = (u.trc20Address || "").trim();
    if (!EVM_ADDR_RE.test(a)) return "Invalid address (must be 0x + 40 hex chars)";
    return null;
  }
  const a = (u.trc20Address || "").trim();
  if (!TRC20_RE.test(a)) return "Invalid TRC20 address (must start with T, 34 chars)";
  return null;
};
```

Note: the frontend keeps sending the address under the `trc20Address` body key regardless of chain (see Task 16) — simplest possible frontend diff. The route below reads `req.body.trc20Address` for both TRON and EVM, and only differentiates when *storing* it (TRON → `trc20Address` column, EVM → `payoutAddress` column).

- [ ] **Step 2: Thread `network` through `/create`**

In the `/create` handler, replace the `const method: string = req.body?.method;` block start (currently lines 129-130) — keep those two lines, then immediately after `const amount = Number(req.body?.amount);` add:

```ts
  const network: string = (req.body?.network || "tron").trim();
```

Replace the `getHotWalletBalance` USDT-liquidity branch (currently lines 291-305):

```ts
    if (method === "usdt") {
      const isEvm = isEvmChain(network);
      if (isEvm) {
        const chain = getEvmChain(network);
        const hot = chain ? await getEvmHotWalletBalance(network as EvmChainKey) : null;
        if (!hot || hot.usdtBalance < amount) {
          initialStatus = "manual_queue";
        } else {
          const r = await provider!.createPayout({
            orderId,
            userName,
            method: "usdt",
            grossAmount: amount,
            network,
            payoutAddress: req.body.trc20Address.trim(),
          });
          providerRef = r.providerRef;
          initialStatus = r.status;
        }
      } else {
        const hot = await getHotWalletBalance();
        if (!hot || hot.usdtBalance < amount) {
          initialStatus = "manual_queue";
        } else {
          const r = await provider!.createPayout({
            orderId,
            userName,
            method: "usdt",
            grossAmount: amount,
            trc20Address: req.body.trc20Address.trim(),
          });
          providerRef = r.providerRef;
          initialStatus = r.status;
        }
      }
    } else {
```

- [ ] **Step 3: Store `network`/`payoutAddress` on the created order**

Replace the `trc20Address:` line in the `WithdrawalOrderModel.create({...})` call (currently line 338):

```ts
    trc20Address: method === "usdt" && !isEvmChain(network) ? String(req.body.trc20Address).trim() : undefined,
    network: method === "usdt" ? network : undefined,
    payoutAddress: method === "usdt" && isEvmChain(network) ? String(req.body.trc20Address).trim() : undefined,
```

- [ ] **Step 4: Dispatch auto-payout by network**

Replace the auto-payout block (currently lines 364-376):

```ts
  if (doc.method === "usdt" && doc.status === "processing") {
    const autoOn = Number(getSetting("usdtAutoPayoutEnabled") || 0) === 1;
    const maxInr = Number(getSetting("usdtAutoPayoutMaxInr") || 0);
    const orderInr = grossInr;
    const underCap = maxInr === 0 || orderInr < maxInr;
    const chain = doc.network ? getEvmChain(doc.network) : undefined;
    // Ethereum (sweepAllowed=false) never auto-broadcasts, regardless of the global toggle.
    const autoAllowedForChain = !chain || chain.sweepAllowed;
    if (autoOn && underCap && autoAllowedForChain) {
      const broadcaster = chain ? () => autoBroadcastUsdtWithdrawalEvm(doc.orderId) : () => autoBroadcastUsdtWithdrawal(doc.orderId);
      broadcaster().catch((e) => {
        console.error(`[auto-payout] order ${doc.orderId} threw:`, e);
      });
    }
  }
```

- [ ] **Step 5: Typecheck**

Run: `cd aviator-back && npm run lint`
Expected: no errors

- [ ] **Step 6: Commit**

```bash
git add aviator-back/src/routes/withdrawal.ts
git commit -m "Make USDT withdrawal network-aware (TRON default + EVM chains, Ethereum auto-payout excluded)"
```

---

### Task 14: `routes/admin.ts` — EVM wallet routes + withdrawal-action dispatch

**Files:**
- Modify: `aviator-back/src/routes/admin.ts`

- [ ] **Step 1: Add imports**

Add near the existing `import { listWallets, transferOut, sweepAddresses, fetchAddressBalance } from "../payment/walletOps";` line (currently line 13):

```ts
import {
  listWalletsForChain,
  transferOut as evmTransferOut,
  sweepAddresses as evmSweepAddresses,
  fetchEvmAddressBalance,
  autoBroadcastUsdtWithdrawalEvm,
} from "../payment/evmWalletOps";
import { getEvmChain, isEvmChain, enabledEvmChains, EvmChainKey } from "../payment/evmChains";
```

- [ ] **Step 2: Add EVM wallet routes**

Add immediately after the existing TRON `/admin/wallets/sweep` route block (after the closing `});` currently at line 1104):

```ts
// ---------- EVM Wallets (Polygon / BSC / Ethereum) ----------

const requireEvmChain = (req: Request, res: Response): EvmChainKey | null => {
  const key = req.params.chain;
  if (!isEvmChain(key) || !getEvmChain(key)) {
    res.status(400).json({ status: false, message: `Unknown or unconfigured chain: ${key}` });
    return null;
  }
  return key;
};

adminRouter.get("/wallets/evm/chains", (_req, res) => {
  res.json({ status: true, data: enabledEvmChains().map((c) => ({ key: c.key, label: c.label, sweepAllowed: c.sweepAllowed })) });
});

adminRouter.get("/wallets/evm/:chain", async (req, res) => {
  const chain = requireEvmChain(req, res);
  if (!chain) return;
  const useCache = req.query.fresh !== "1";
  try {
    const r = await listWalletsForChain(chain, useCache);
    res.json({ status: true, data: r });
  } catch (e) {
    res.status(502).json({ status: false, message: (e as Error).message });
  }
});

adminRouter.get("/wallets/evm/:chain/balance/:address", async (req, res) => {
  const chain = requireEvmChain(req, res);
  if (!chain) return;
  if (!/^0x[0-9a-fA-F]{40}$/.test(req.params.address)) {
    return res.status(400).json({ status: false, message: "Invalid EVM address" });
  }
  try {
    const r = await fetchEvmAddressBalance(chain, req.params.address);
    res.json({ status: true, data: r });
  } catch (e) {
    res.status(502).json({ status: false, message: (e as Error).message });
  }
});

adminRouter.post("/wallets/evm/:chain/transfer-out", async (req, res) => {
  const chain = requireEvmChain(req, res);
  if (!chain) return;
  const { to, amountUsdt, amountNative, dryRun } = req.body || {};
  try {
    const r = await evmTransferOut({
      chainKey: chain,
      to,
      amountUsdt: amountUsdt != null ? Number(amountUsdt) : undefined,
      amountNative: amountNative != null ? Number(amountNative) : undefined,
      dryRun: !!dryRun,
    });
    if (!r.ok) return res.status(400).json({ status: false, ...r });
    res.json({ status: true, data: r });
  } catch (e) {
    res.status(502).json({ status: false, message: (e as Error).message });
  }
});

adminRouter.post("/wallets/evm/:chain/sweep", async (req, res) => {
  const chain = requireEvmChain(req, res);
  if (!chain) return;
  const { addresses, dryRun, confirmedGasCost } = req.body || {};
  try {
    const r = await evmSweepAddresses({
      chainKey: chain,
      addresses: Array.isArray(addresses) ? addresses : undefined,
      dryRun: !!dryRun,
      confirmedGasCost: !!confirmedGasCost,
    });
    res.json({ status: true, data: r });
  } catch (e) {
    res.status(502).json({ status: false, message: (e as Error).message });
  }
});
```

- [ ] **Step 3: Dispatch the existing withdrawal-broadcast route by network**

Replace the body of `adminRouter.post("/withdrawals/:orderId/broadcast", ...)` (currently lines 352-392) — keep the same route path and the initial validation (order lookup, method/status/address checks), but replace the address-check + broadcast call:

```ts
  if (order.method !== "usdt") {
    return res.status(400).json({ status: false, message: "Broadcast only applies to USDT withdrawals" });
  }
  if (order.status !== "manual_queue") {
    return res.status(400).json({ status: false, message: `Order is ${order.status}, expected manual_queue` });
  }

  const network = order.network || "tron";
  const isEvm = isEvmChain(network);
  const destination = isEvm ? order.payoutAddress : order.trc20Address;
  if (!destination) {
    return res.status(400).json({ status: false, message: "Order has no destination address" });
  }

  const result = isEvm
    ? await evmTransferOut({ chainKey: network as EvmChainKey, to: destination, amountUsdt: order.grossAmount })
    : await transferOut({ to: destination, amountUsdt: order.grossAmount });
  if (!result.ok) {
    return res.status(400).json({ status: false, message: result.reason || "Broadcast failed" });
  }
```

(the rest of the handler — the `findOneAndUpdate` to `paid`, referral reward, socket push, response — stays exactly as-is, it already references `result.txHash` generically)

- [ ] **Step 4: Dispatch the approve-review route's hot-wallet check by network**

In `adminRouter.post("/withdrawals/:orderId/approve-review", ...)`, replace the usdt branch (currently lines 461-... through the payout provider call, roughly lines 461-475):

```ts
    if (order.method === "usdt") {
      const network = order.network || "tron";
      const isEvm = isEvmChain(network);
      const hot = isEvm ? await getEvmHotWalletBalance(network as EvmChainKey) : await getHotWalletBalance();
      if (!hot || hot.usdtBalance < order.grossAmount) {
        nextStatus = "manual_queue";
      } else {
        const r = await provider.createPayout({
          orderId: order.orderId,
          userName: order.userName,
          method: "usdt",
          grossAmount: order.grossAmount,
          network: isEvm ? network : undefined,
          trc20Address: isEvm ? undefined : order.trc20Address,
          payoutAddress: isEvm ? order.payoutAddress : undefined,
        });
        providerRef = r.providerRef;
        nextStatus = r.status;
      }
    }
```

Note: read the surrounding code first (`aviator-back/src/routes/admin.ts:458-480`) to match the exact variable names already in scope (`nextStatus`, `providerRef`, `provider`) before replacing — this block must slot into the existing `try { ... } catch` without changing its outer structure.

- [ ] **Step 5: Typecheck**

Run: `cd aviator-back && npm run lint`
Expected: no errors

- [ ] **Step 6: Commit**

```bash
git add aviator-back/src/routes/admin.ts
git commit -m "Add EVM admin wallet routes + dispatch withdrawal broadcast/approve-review by network"
```

---

### Task 15: Frontend — chain picker in the recharge (deposit) flow

**Files:**
- Modify: `src/components/Mobile/CryptoPayPanel.tsx`
- Modify: `src/components/Mobile/RechargeSheet.tsx`

- [ ] **Step 1: Add a chain-availability fetch + picker step in `RechargeSheet.tsx`**

In `src/components/Mobile/RechargeSheet.tsx`, add state near the existing `usdtEnabled` state (currently line 70):

```ts
  const [evmChains, setEvmChains] = React.useState<Array<{ key: string; label: string }>>([]);
  const [network, setNetwork] = React.useState<string>("tron");
```

In the channel-availability `useEffect` (currently lines 75-98), extend the response handling — after `setUsdtEnabled(usdt);` add:

```ts
        setEvmChains(Array.isArray(json?.data?.evmChains) ? json.data.evmChains : []);
```

In the `step === "crypto"` render block (currently lines 288-294), pass the chosen network through and add a chain picker above it:

```tsx
        {step === "crypto" && (
          <div className="rs-crypto-chain-wrap">
            {evmChains.length > 0 && (
              <div className="rs-method-tabs" style={{ marginBottom: 10 }}>
                <button
                  type="button"
                  className={`rs-method ${network === "tron" ? "active" : ""}`}
                  onClick={() => setNetwork("tron")}
                >
                  <span className="rs-method-name">TRON</span>
                </button>
                {evmChains.map((c) => (
                  <button
                    key={c.key}
                    type="button"
                    className={`rs-method ${network === c.key ? "active" : ""}`}
                    onClick={() => setNetwork(c.key)}
                  >
                    <span className="rs-method-name">{c.label}</span>
                  </button>
                ))}
              </div>
            )}
            <CryptoPayPanel
              amountInr={amount}
              network={network}
              onDone={onClose}
              onRetry={() => setStep("picker")}
            />
          </div>
        )}
```

- [ ] **Step 2: Extend `recharge/config` response consumption is already in place — update `CryptoPayPanel` to accept and send `network`**

In `src/components/Mobile/CryptoPayPanel.tsx`, extend `Props` (currently lines 41-48):

```ts
interface Props {
  /** Last INR amount picked in the parent picker — converted to USDT here. */
  amountInr: number;
  /** "tron" or an EVM chain key ("polygon"|"bsc"|"ethereum"). */
  network: string;
  /** Closes the whole sheet. */
  onDone: () => void;
  /** Triggers the parent to go back to picker step. */
  onRetry: () => void;
}
```

Update the component signature (currently line 60) and the order-create call (currently lines 60-98):

```tsx
export const CryptoPayPanel: React.FC<Props> = ({ amountInr, network, onDone, onRetry }) => {
  const ctx = React.useContext(Context);
  const sock = (ctx as any).socket;

  const [step, setStep] = React.useState<Step>("creating");
  const [order, setOrder] = React.useState<CryptoOrder | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [copied, setCopied] = React.useState<string | null>(null);

  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`${apiBase}/crypto/create`, {
          method: "POST",
          headers: { "Content-Type": "application/json", ...authHeaders() },
          body: JSON.stringify({ amountInr, network: network === "tron" ? undefined : network }),
        });
        const json = await res.json();
        if (cancelled) return;
        if (!json.status) {
          setError(json.message || "Failed to create order");
          setStep("failed");
          return;
        }
        setOrder(json.data);
        setStep("pending");
      } catch {
        if (!cancelled) {
          setError("Network error");
          setStep("failed");
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [amountInr, network]);
```

Update the pending-view network badge + warning copy (currently lines 242-305) so it doesn't hardcode "TRON":

```tsx
      <div className="cp-network-badge">{order.network.toUpperCase()} · USDT</div>
      <h3 className="rs-title">Send USDT to deposit address</h3>
```

```tsx
      <p className="cp-warn">
        ⚠ Send <b>USDT</b> over the <b>{order.network}</b> network ONLY.
        This address is unique to your order — any USDT amount ≥ <b>{(order.minUsdt ?? 10)} USDT</b> credits
        you the equivalent INR at <b>{order.fxRate.toFixed(2)}</b>. Network transactions are final.
      </p>
```

- [ ] **Step 3: Extend `routes/recharge.ts`'s `/config` response with `evmChains`**

In `aviator-back/src/routes/recharge.ts`, add the import at the top:

```ts
import { enabledEvmChains } from "../payment/evmChains";
```

Replace the `/config` response body (the object shown earlier around lines 26-35):

```ts
  const tronConfigured = !!config.tronNetwork && !!config.tronContract;
  const evmChains = enabledEvmChains();
  res.json({
    status: true,
    data: {
      inrEnabled: Number(getSetting("inrRechargeEnabled") || 0) === 1,
      usdtEnabled: (tronConfigured || evmChains.length > 0) && Number(getSetting("cryptoRechargeEnabled") || 0) === 1,
      evmChains: evmChains.map((c) => ({ key: c.key, label: c.label })),
      minInr: config.rechargeMinAmount,
      maxInr: config.rechargeMaxAmount,
    },
  });
```

- [ ] **Step 4: Typecheck both projects**

Run: `cd aviator-back && npm run lint`
Run: `npx tsc --noEmit` (from repo root, frontend)
Expected: no errors in either

- [ ] **Step 5: Manual verification in the preview**

Start the app (`preview_start` or existing dev flow), open the Recharge sheet, switch to the USDT tab. With `EVM_CHAINS_ENABLED` unset, confirm the chain-tab row does not appear (only TRON's existing flow renders) — this is the default/backward-compatible state. This step does not need EVM env vars configured to pass; it just confirms zero regression to the existing TRON-only deposit flow.

- [ ] **Step 6: Commit**

```bash
git add src/components/Mobile/CryptoPayPanel.tsx src/components/Mobile/RechargeSheet.tsx aviator-back/src/routes/recharge.ts
git commit -m "Add EVM chain picker to the crypto recharge flow"
```

---

### Task 16: Frontend — chain picker in the withdrawal flow

**Files:**
- Modify: `src/components/Mobile/WithdrawalSheet.tsx`
- Modify: `aviator-back/src/routes/withdrawal.ts` (extend `/quote`)

- [ ] **Step 1: Extend `/api/withdrawal/quote` with `evmChains`**

In `aviator-back/src/routes/withdrawal.ts`, add the import:

```ts
import { enabledEvmChains } from "../payment/evmChains";
```

In the `/quote` handler, add to the response `data` object (currently ending at line 107, before the closing `},`):

```ts
      evmChains: enabledEvmChains().map((c) => ({ key: c.key, label: c.label })),
```

- [ ] **Step 2: Add chain state + picker in `WithdrawalSheet.tsx`**

Extend `QuoteData` (currently lines 24-34):

```ts
interface QuoteData {
  balance: number;
  wagerRequired: number;
  withdrawable: number;
  feePct: number;
  minInr: number;
  maxGrossInr: number;
  usdtInrRate: number | null;
  bankEnabled?: boolean;
  usdtEnabled?: boolean;
  evmChains?: Array<{ key: string; label: string }>;
}
```

Add network state near the `trc20`/`amountUsdt` state (currently lines 81-82):

```ts
  const [network, setNetwork] = React.useState<string>("tron");
```

Update the address-format checks to be network-aware (currently line 197 `trc20Valid`):

```ts
  const EVM_ADDR_RE = /^0x[0-9a-fA-F]{40}$/;
  const isEvmNetwork = network !== "tron";
  const trc20Valid = isEvmNetwork ? EVM_ADDR_RE.test(trc20.trim()) : /^T[1-9A-HJ-NP-Za-km-z]{33}$/.test(trc20.trim());
```

Update `submit()`'s usdt body (currently lines 144-147):

```ts
      } else {
        body.amount = Number(amountUsdt);
        body.trc20Address = trc20.trim();
        body.network = network;
      }
```

In the USDT form block (currently lines 310-336), add a chain picker above the address input and swap the placeholder/max-length by network:

```tsx
              <div className="wd-form">
                {(quote?.evmChains?.length ?? 0) > 0 && (
                  <label>
                    <span>Network</span>
                    <select value={network} onChange={(e) => setNetwork(e.target.value)}>
                      <option value="tron">TRON (TRC20)</option>
                      {quote!.evmChains!.map((c) => (
                        <option key={c.key} value={c.key}>{c.label}</option>
                      ))}
                    </select>
                  </label>
                )}
                <label>
                  <span>{t("withdrawal.form.trc20")}</span>
                  <input
                    type="text"
                    placeholder={isEvmNetwork ? "0x..." : "T..."}
                    value={trc20}
                    onChange={(e) => setTrc20(e.target.value.trim())}
                    maxLength={isEvmNetwork ? 42 : 34}
                  />
                </label>
                <label>
                  <span>{t("withdrawal.form.amountUsdt")} — {t("withdrawal.cta.min")} ₹{minInr} (≈ {(minInr / fxRate).toFixed(2)} USDT)</span>
                  <input
                    type="text"
                    inputMode="decimal"
                    placeholder="10"
                    value={amountUsdt}
                    onChange={(e) => setAmountUsdt(e.target.value.replace(/[^\d.]/g, ""))}
                  />
                </label>
                <div className="wd-rate-note">
                  {t("withdrawal.rateLocked")} 1 USDT ≈ ₹{fxRate.toFixed(2)}
                </div>
              </div>
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit` (repo root)
Run: `cd aviator-back && npm run lint`
Expected: no errors

- [ ] **Step 4: Manual verification**

Open the Withdrawal sheet, USDT tab. With `EVM_CHAINS_ENABLED` unset, confirm no "Network" selector appears and TRC20 validation/behavior is exactly as before (backward-compatible default).

- [ ] **Step 5: Commit**

```bash
git add src/components/Mobile/WithdrawalSheet.tsx aviator-back/src/routes/withdrawal.ts
git commit -m "Add EVM chain picker to the USDT withdrawal flow"
```

---

### Task 17: Admin — EVM Wallets panel

**Files:**
- Modify: `src/components/Admin/AdminApp.tsx`

- [ ] **Step 1: Add a chain-tab switcher above the existing TRON `WalletsTab`**

In `src/components/Admin/AdminApp.tsx`, locate the render call `{tab === "wallets" && <WalletsTab />}` (currently line 93) and replace it with:

```tsx
        {tab === "wallets" && <WalletsRoot />}
```

- [ ] **Step 2: Add `WalletsRoot` + `EvmWalletsPanel` after the existing `WalletsTab` component**

Insert immediately before the `// -------------------------------- Wallets ---------------------------------` comment's `WalletsTab` definition ends (i.e. right after the closing `};` of `WalletsTab`, currently line 2029), add:

```tsx
/**
 * WalletsRoot — chain switcher above the wallet views. TRON keeps its
 * original, unmodified WalletsTab; EVM chains render through a new sibling
 * panel so the existing TRON component (money-handling, well-tested by
 * hand in production) isn't touched by this addition.
 */
const WalletsRoot: React.FC = () => {
  const api = useApi();
  const [evmChains, setEvmChains] = React.useState<Array<{ key: string; label: string; sweepAllowed: boolean }>>([]);
  const [activeChain, setActiveChain] = React.useState<string>("tron");

  React.useEffect(() => {
    (async () => {
      try {
        const r = await api(`/admin/wallets/evm/chains`);
        setEvmChains(r.data || []);
      } catch { /* EVM not configured — chain tabs stay TRON-only */ }
    })();
  }, [api]);

  return (
    <div>
      {evmChains.length > 0 && (
        <div className="wd-tabs" style={{ marginBottom: 12 }}>
          <button className={activeChain === "tron" ? "active" : ""} onClick={() => setActiveChain("tron")}>TRON</button>
          {evmChains.map((c) => (
            <button key={c.key} className={activeChain === c.key ? "active" : ""} onClick={() => setActiveChain(c.key)}>
              {c.label}
            </button>
          ))}
        </div>
      )}
      {activeChain === "tron" ? <WalletsTab /> : <EvmWalletsPanel chainKey={activeChain} chains={evmChains} />}
    </div>
  );
};

interface EvmWalletEntry {
  role: "hot" | "deposit";
  index: number;
  address: string;
  nativeBalance: number | null;
  usdtBalance: number | null;
  paidOrderCount?: number;
  unsweptOrderCount?: number;
  totalUsdtClaimed?: number;
}

interface EvmWalletsListData {
  chain: string;
  contract: string;
  fetchedAt: string;
  cached: boolean;
  wallets: EvmWalletEntry[];
  totals: { hotNative: number; hotUsdt: number; depositNative: number; depositUsdt: number; unsweptOrders: number };
}

const EvmWalletsPanel: React.FC<{ chainKey: string; chains: Array<{ key: string; label: string; sweepAllowed: boolean }> }> = ({ chainKey, chains }) => {
  const api = useApi();
  const [data, setData] = React.useState<EvmWalletsListData | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [sweeping, setSweeping] = React.useState(false);

  const meta = chains.find((c) => c.key === chainKey);
  const nativeSymbol = chainKey === "polygon" ? "MATIC" : chainKey === "bsc" ? "BNB" : "ETH";

  const load = React.useCallback(async (fresh = false) => {
    setLoading(true);
    try {
      const r = await api(`/admin/wallets/evm/${chainKey}${fresh ? "?fresh=1" : ""}`);
      setData(r.data);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [api, chainKey]);

  React.useEffect(() => { load(); }, [load]);

  const runSweep = async () => {
    const count = data?.totals.unsweptOrders || 0;
    const needsConfirm = meta && !meta.sweepAllowed;
    if (!window.confirm(
      needsConfirm
        ? `${meta?.label} gas fees can exceed a small deposit's value. Sweep ${count} address(es) anyway?`
        : `Sweep ${count} address(es)? This sends USDT from sub-addresses to the hot wallet (gas paid from hot wallet).`,
    )) return;
    setSweeping(true);
    try {
      const r = await api(`/admin/wallets/evm/${chainKey}/sweep`, {
        method: "POST",
        body: JSON.stringify({ dryRun: false, confirmedGasCost: needsConfirm }),
      });
      const d = r.data;
      alert(`Sweep complete:\nAttempted: ${d.attempted}\nSwept: ${d.swept}\nTotal USDT: ${d.totalUsdt.toFixed(4)}\n\n${d.details.map((x: any) => `${x.address.slice(0, 12)}… ${x.action}${x.error ? ` ERROR: ${x.error}` : ""}`).join("\n")}`);
      load(true);
    } catch (e) {
      alert("Sweep failed: " + (e as Error).message);
    } finally {
      setSweeping(false);
    }
  };

  if (error && !data) return <div className="admin-error">⚠ {error}</div>;
  if (!data) return <div className="admin-tab-body">Loading {chainKey} wallets…</div>;

  const hot = data.wallets.find((w) => w.role === "hot");
  const deposits = data.wallets.filter((w) => w.role === "deposit");

  return (
    <div className="admin-wallets">
      <section className="stat-grid">
        <Stat label="Hot USDT" value={data.totals.hotUsdt.toFixed(2)} accent={data.totals.hotUsdt < 50 ? "warn" : "ok"} />
        <Stat label={`Hot ${nativeSymbol}`} value={data.totals.hotNative.toFixed(4)} accent={data.totals.hotNative < (meta?.sweepAllowed ? 0.01 : 0.005) ? "warn" : "ok"} />
        <Stat label="Deposit USDT (un-swept)" value={data.totals.depositUsdt.toFixed(2)} accent={data.totals.depositUsdt > 0 ? "warn" : undefined} />
        <Stat label="Un-swept orders" value={String(data.totals.unsweptOrders)} accent={data.totals.unsweptOrders > 0 ? "warn" : undefined} />
      </section>

      <div style={{ display: "flex", gap: 8, marginTop: 12, alignItems: "center", flexWrap: "wrap" }}>
        <button onClick={() => load(true)} disabled={loading || sweeping}>↻ Refresh balances</button>
        <button onClick={runSweep} disabled={sweeping || data.totals.unsweptOrders === 0}>
          {sweeping ? "Sweeping…" : `Run sweep (${data.totals.unsweptOrders})`}
        </button>
        {meta && !meta.sweepAllowed && (
          <span style={{ fontSize: 11, color: "#ffb0bc" }}>⚠ {meta.label} sweep needs gas-cost confirm</span>
        )}
      </div>

      {hot && (
        <div className="admin-wallets-hot" style={{ marginTop: 16 }}>
          <h3 style={{ fontSize: 14, margin: "0 0 8px" }}>Hot wallet (index {hot.index})</h3>
          <code style={{ display: "block", fontSize: 11, wordBreak: "break-all", background: "rgba(255,200,87,0.06)", padding: "4px 8px", borderRadius: 4 }}>{hot.address}</code>
          <div style={{ fontSize: 12, marginTop: 8 }}>
            <strong style={{ color: "#ffc857" }}>{hot.usdtBalance?.toFixed(4) ?? "⚠ ?"} USDT</strong>
            {" · "}
            <strong>{hot.nativeBalance?.toFixed(4) ?? "⚠ ?"} {nativeSymbol}</strong>
          </div>
        </div>
      )}

      <h3 style={{ fontSize: 14, margin: "20px 0 8px" }}>Deposit sub-addresses ({deposits.length})</h3>
      <table className="admin-table">
        <thead>
          <tr>
            <th>Index</th><th>Address</th>
            <th className="num">USDT</th><th className="num">{nativeSymbol}</th>
            <th className="num">Paid</th><th className="num">Un-swept</th><th className="num">Total claimed</th>
          </tr>
        </thead>
        <tbody>
          {deposits.map((w) => (
            <tr key={w.address} className={(w.unsweptOrderCount || 0) > 0 ? "row-banned" : ""}>
              <td>{w.index}</td>
              <td className="seed">{w.address}</td>
              <td className="num">{w.usdtBalance == null ? "⚠ ?" : w.usdtBalance.toFixed(4)}</td>
              <td className="num">{w.nativeBalance == null ? "⚠ ?" : w.nativeBalance.toFixed(4)}</td>
              <td className="num">{w.paidOrderCount}</td>
              <td className="num">{w.unsweptOrderCount}</td>
              <td className="num">{w.totalUsdtClaimed?.toFixed(2)}</td>
            </tr>
          ))}
          {deposits.length === 0 && <tr><td colSpan={7} className="empty">No deposit addresses yet</td></tr>}
        </tbody>
      </table>
    </div>
  );
};
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit` (repo root)
Expected: no errors

- [ ] **Step 3: Manual verification in the preview**

Open the admin panel's Wallets tab. With `EVM_CHAINS_ENABLED` unset (default), confirm it renders exactly as before — no chain-tab row, `WalletsTab` (TRON) unchanged. This confirms zero regression.

If you want to see the EVM panel render, set `EVM_CHAINS_ENABLED=polygon` and a real/dummy `CRYPTO_MASTER_MNEMONIC` in `aviator-back/.env`, restart the backend, reload the admin Wallets tab — the chain-tab row ("TRON" / "Polygon") should appear, and clicking "Polygon" should load `EvmWalletsPanel` (hot wallet address derived from the mnemonic, zero balances is expected with a fresh mnemonic).

- [ ] **Step 4: Commit**

```bash
git add src/components/Admin/AdminApp.tsx
git commit -m "Add EVM Wallets admin panel (chain-tab switcher, TRON tab untouched)"
```

---

## Post-implementation notes for the operator (not code — record in `.env.example` / deployment docs)

- To actually go live on a chain: set `EVM_CHAINS_ENABLED=polygon,bsc` (or add `ethereum`) in `aviator-back/.env`, ensure `CRYPTO_MASTER_MNEMONIC` is set (shared with TRON — same master seed, different derivation path), restart the API container.
- Fund the EVM hot wallet (index 0 of the `m/44'/60'/0'/0/N` family — same address across all three EVM chains) with a small amount of each enabled chain's native gas token before enabling withdrawals, or `manual_queue`/sweep will report insufficient gas.
- `EVM_CHAINS_ENABLED` empty (the default) means zero behavior change from what's in production today — every new code path is gated behind it.
