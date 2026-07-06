# EVM Multi-Chain USDT Deposits + Withdrawals — Design

Status: Approved
Date: 2026-07-06

## Goal

Extend the existing TRON-only USDT recharge/withdrawal system to also support
Polygon, BNB Smart Chain (BSC), and Ethereum mainnet — same per-order unique
deposit address model, same admin visibility, both deposits AND withdrawals.
Frontend and backend change together in one pass.

## Non-goals

- No new fiat rails, no non-EVM/non-TRON chains.
- No migration of existing TRON data — all schema changes are additive.
- No per-chain admin Settings proliferation — reuse the existing global
  `usdtAutoPayoutEnabled` / `usdtAutoPayoutMaxInr` toggles across all chains,
  with Ethereum hard-excluded from auto-payout regardless of the toggle.

## Architecture

Same shape as the existing TRON flow, generalized across a chain family:

```
buyer picks chain (tron/polygon/bsc/ethereum) → POST /api/crypto/create {amountInr, network}
  → allocateAddress(network) derives a unique deposit address
  → buyer sends USDT
watcher (per chain, independent tick):
  - tron.ts        → TronGrid REST poll (unchanged)
  - evm.ts (new)    → eth_getLogs Transfer-event poll per pending order, per chain
  → match ≥ order amount → status=paid → engine.creditRecharge (unchanged)
withdrawal: buyer picks chain + address → same review/manual_queue/auto-payout
  state machine, dispatched to tron or evm broadcaster by network
sweep: admin-triggered for all EVM chains; Ethereum sweep requires an extra
  confirm step in the admin UI (gas-cost warning), never automatic
```

**Key architectural fact**: Polygon, BSC, and Ethereum are all EVM chains, so
one derivation path family — `m/44'/60'/0'/0/N` — produces ONE address that is
valid on all three. A single allocated index serves whichever EVM chain the
order specifies; the EVM index counter is separate from TRON's.

## Data model changes

### `CryptoOrder` (no schema change)
`network` is already a free-text indexed string; `contractAddress` already
generic. New values used: `"polygon"`, `"bsc"`, `"ethereum"` (TRON keeps its
existing `"shasta"` / `"mainnet"` values).

### `WithdrawalOrder` (additive fields only)
- `network?: string` — default `"tron"` for backward compatibility with
  existing rows (all of which are implicitly TRON today).
- `payoutAddress?: string` — new generic destination-address field for EVM
  withdrawals. Existing `trc20Address` field is untouched and keeps being used
  for TRON withdrawals (no behavior change for existing code paths).

## Chain registry (`payment/evmChains.ts`, new)

One entry per chain:

| key | chainId | usdtContract | decimals | native gas | sweepAllowed | default RPC |
|---|---|---|---|---|---|---|
| polygon | 137 | `0xc2132D05D31c914a87C6611C10748AEb04B58e8` | 6 | MATIC | auto (admin-triggered) | `https://polygon-rpc.com` |
| bsc | 56 | `0x55d398326f99059fF775485246999027B3197955` | **18** | BNB | auto (admin-triggered) | `https://bsc-dataseed.binance.org` |
| ethereum | 1 | `0xdAC17F958D2ee523a2206206994597C13D831ec7` | 6 | ETH | manual-with-warning only | `https://eth.llamarpc.com` |

All RPC URLs and gas-reserve thresholds are overridable via env
(`EVM_RPC_POLYGON`, `EVM_RPC_BSC`, `EVM_RPC_ETHEREUM`,
`CRYPTO_SWEEP_GAS_RESERVE_{POLYGON,BSC,ETHEREUM}`). `EVM_CHAINS_ENABLED`
(comma list, e.g. `polygon,bsc`) controls which chains are live — lets the
operator launch with a subset without code changes.

**BSC 18-decimal gotcha**: every EVM balance/amount calculation reads
`usdtDecimals` from this registry — nothing hardcodes `/1e6` for EVM code
paths (TRON code is unaffected and keeps its existing `/1e6`).

## New/changed backend files

| File | Change |
|---|---|
| `payment/evmChains.ts` (new) | Chain registry above. |
| `payment/evmWallet.ts` (new) | `deriveEvmAccount(index)` via ethers' built-in HD wallet (ethers v6 bundles BIP32/39 — no new dependency beyond `ethers` itself); `allocateEvmAddress()` mirrors `wallet.ts`'s reuse-cooldown logic; separate Mongo counter `crypto_deriv_index_evm`. |
| `payment/providers/evm.ts` (new) | Mirrors `providers/tron.ts`: for each pending EVM order, `eth_getLogs` filtered to the chain's USDT contract + `Transfer(_, order.depositAddress, _)` topic, lookback capped at ~3000 blocks per scan, decimal-aware amount parsing. One `setInterval` per enabled EVM chain. |
| `payment/evmWalletOps.ts` (new) | Mirrors `walletOps.ts`: `listWallets`, `transferOut`, `sweepAddresses`, `autoBroadcastUsdtWithdrawal`. Uses `ethers.Contract` for ERC20 `balanceOf`/`transfer`, `provider.getBalance` for native gas. Ethereum's `sweepAddresses` and `autoBroadcastUsdtWithdrawal` both hard-refuse unless caller passes an explicit `confirmedGasCost: true` flag (surfaced by the admin UI's warning dialog / never set by the auto-payout path). |
| `db/models/WithdrawalOrder.ts` | Add `network?: string`, `payoutAddress?: string` (see above). |
| `routes/crypto.ts` | `/create` takes `network` from request body instead of hardcoding `config.tronNetwork`; dispatches to `wallet.ts` or `evmWallet.ts`/`evmChains.ts` based on network. |
| `routes/withdrawal.ts` | `/create` (usdt method) takes `network`; validates address format per chain (existing TRC20 regex vs new `0x[0-9a-fA-F]{40}` regex); dispatches broadcast to `walletOps` or `evmWalletOps`; auto-payout path explicitly skips Ethereum regardless of the global toggle. |
| `routes/admin.ts` | `/wallets` aggregates TRON + all enabled EVM chains into one response (each `WalletEntry` gets a `chain` field); sweep/transfer-out endpoints route to the right ops module by chain. |
| `config.ts` | New env vars listed above. |
| `package.json` | Add `ethers` (v6). No other new runtime deps. |

## Frontend changes

- `RechargeSheet.tsx` — USDT tab gains a chain picker (Tron / Polygon / BSC /
  Ethereum), populated from whatever the backend reports as enabled, before
  "Generate address".
- `WithdrawalSheet.tsx` — USDT tab gains the same chain picker; address input
  placeholder + client-side validation swap per chain.
- `AdminApp.tsx` Wallets tab — table gains a "Chain" column; the sweep action
  for Ethereum rows opens a confirm dialog with an explicit gas-cost warning
  instead of the one-click flow Polygon/BSC/TRON get.

## Risks / explicit tradeoffs

- **Free public RPC reliability**: `polygon-rpc.com` / `bsc-dataseed.binance.org`
  can rate-limit or lag under load — accepted tradeoff, same as TronGrid's free
  tier already in production. Override via env if it becomes a problem.
- **Ethereum gas economics**: deposits work fully; sweep and withdrawal
  auto-broadcast are both gated behind explicit manual confirmation to avoid
  silently spending more in gas than a small deposit is worth.
- **No data migration needed** — every schema change is additive/optional.

## Testing

- Extend the existing Jest suite with an `evmWallet` derivation test (mirrors
  `provablyFair.test.ts`'s determinism style) and a chain-registry decimal
  round-trip test (Polygon/Ethereum 6-decimal vs BSC 18-decimal math).
- Manual verification on testnets is out of scope for this pass (no testnet
  entries in the registry) — first real verification happens by watching a
  small mainnet deposit land, mirroring how TRON mainnet was verified.
