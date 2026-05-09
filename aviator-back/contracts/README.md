# MockUSDT — Shasta testnet USDT for development

This contract is a minimal TRC20 mirror of Tether's USDT, deployed on TRON
Shasta testnet so we can test the full crypto-recharge flow end-to-end
without spending real money.

## One-time setup (15-20 minutes hands-on)

### 1. Install TronLink + create a wallet
- Browser extension: <https://www.tronlink.org/>
- Create wallet → **WRITE DOWN THE 12-WORD SEED PHRASE**
- Top-right network selector → **Shasta**

### 2. Get free Shasta TRX (deployment gas)
- <https://shasta.tronex.io/>
- Paste your wallet address → submit → **10,000 testnet TRX** delivered in seconds

### 3. Deploy `MockUSDT.sol`
- Open <https://www.tronide.io/>
- New file → paste contents of `MockUSDT.sol`
- **Compiler tab**: solidity version `0.5.10`, click **Compile**
- **Run tab**:
  - Environment: **Injected Web3** (TronLink popup will ask to connect)
  - Account: should auto-pick your TronLink wallet
  - Constructor params:
    | param | value |
    |---|---|
    | `_name` | `"Test USDT"` |
    | `_symbol` | `"USDT"` |
    | `_decimals` | `6` |
    | `_initialSupply` | `1000000000000` (= 1,000,000 USDT × 10⁶) |
  - Click **Deploy** → confirm in TronLink popup
- After ~30 seconds you'll see the deployed contract address (`TG...`)
- **Copy that address** and paste it back to me, plus your wallet address (the
  receiver address used to collect deposits).

### 4. (Optional) Create a separate "test buyer" wallet
- TronLink → top-right account dropdown → **Add Account** → next index
- Switch back to deployer account → use TronIDE's `transfer()` function on
  the deployed contract to send 100 USDT to the test buyer
  - Function: `transfer`
  - `to` = test buyer address
  - `value` = `100000000` (100 × 10⁶)
- Now your test buyer can simulate a real top-up by transferring USDT to
  the receiver address (which the backend monitors via TronGrid).

## What I need from you after deploy

```
TRON_USDT_RECEIVER=<your TronLink wallet — collects deposits>
TRON_USDT_CONTRACT=<the deployed MockUSDT contract address>
```

I'll wire those into `aviator-back/.env` and the backend will start polling
TronGrid Shasta for incoming USDT transfers to that receiver.

## Why this contract is intentionally tiny

- No `mint` / `burn`: full supply is minted at construction
- No `pause` / `blacklist`: testnet, no need
- No `decimals` accessor required as state — declared as `public` auto-getter
- No `SafeMath` — solidity 0.5 doesn't have built-in overflow checks but
  with 1,000,000 USDT supply and only manual transfers, we won't hit them
- No EIP-2612 permit, no ERC-1820 hooks

It's the bare minimum to test the **payment-detection** flow on the
backend, not a production token.
