# Crypto Pay 操作手冊

Per-order HD deposit address + **cooldown 重用** 嘅完整使用流程。Coinbase
Commerce / BitPay 業界標準模式 — 每個 order **獨立 binding** 一個 TRON
address,**舊 order 完成 1 小時後該 address 可被新 order 重用**,大幅減少
sweep gas 成本。

## 💡 Address Pool 重用機制(省 gas 嘅關鍵)

而家 backend 唔係每個 order 都派一個全新 address — 每次 create order:

```
1. 查 DB 揾「過咗 cooldown 嘅完成 order」(paid 1h+ / expired 1h+)
2. 如果有 → 重用嗰個 derivIndex 同 depositAddress
3. 如果冇 → 派新 derivIndex(counter 自動 +1)
```

實際效果:
- 一日 100 個 order → 只生成 ~5 個 unique address(因為 1h cooldown 內最多 ~10-15 個 active order)
- 一年 10K order → ~50 個 address
- Sweep gas 由「每 order 一筆」變成「每 address 一批,N orders 共享」
- **Gas overhead 由 ~5% 降到 ~0.5%**

### 重用安全保證(timestamp window)

每個 tx 上鏈嗰一刻都有 `block_timestamp`。Backend match 規則:
- `tx.to === order.depositAddress` ✓
- `tx.block_timestamp >= order.createdAt - 60s`(允許 ~1min clock skew)
- `tx.block_timestamp <= order.expiresAt + 5min`(post-expiry grace)

呢樣保證:
- 用戶 A 嘅 order 完結 1 小時後,address 重用俾 B
- A 如果**仍然**喺 1.5 小時後送錢,個 tx timestamp 大過 A.expiresAt → 唔 match A
- 但 timestamp 又**小過** B.createdAt(因為 B 啱啱 create) → 都唔 match B
- → **無人賺 A 嗰筆「late」錢**(會卡住喺 address,sweep 入 hot wallet,operator 可手動 reconcile)

冷靜期由 `CRYPTO_ADDRESS_REUSE_COOLDOWN_MS` env 控制,默認 1 小時。

---

Per-order HD deposit address 嘅完整使用流程。

---

## 🏗 一次性 setup(server 上面)

### 1. 生成 master seed(server-only,**唔好用 TronLink 嘅 seed**)

```bash
ssh easyenglish
cd /opt/aviator/aviator-back
docker compose exec api node dist/tools/gen-master-seed.js
```

Output 會 print 一個 12-word mnemonic 同 hot wallet address(index 0)。
**立即抄低,寫紙上 / 入 1Password / 入 hardware token**。

⚠ 如果丟咗 mnemonic = **永遠攞唔返**用戶送嚟嘅錢。

### 2. 寫入 `.env`

```bash
nano /opt/aviator/aviator-back/.env
```

```env
TRON_NETWORK=mainnet                         # 或 shasta 測試
TRON_USDT_CONTRACT=TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t  # 真 USDT(mainnet)
CRYPTO_MASTER_MNEMONIC="word1 word2 ... word12"        # 你啱啱攞嗰個
CRYPTO_HOT_WALLET_INDEX=0
CRYPTO_SWEEP_GAS_RESERVE_TRX=30
TRONGRID_API_KEY=                            # 免費註冊 trongrid.io 拎 key
```

### 3. Recreate api container(reload .env)

```bash
docker compose up -d --force-recreate api
docker compose logs --tail=10 api | grep tron
# 應該見:[tron] watcher started on mainnet (... per-order deposit addresses)
```

### 4. Fund hot wallet 做 sweep gas

每次 sweep 一個 deposit address,需要 ~30 TRX gas。預先入 hot wallet 一筆 TRX:

```
Hot wallet address: <gen-master-seed 輸出嘅 address>
建議入: 500 TRX(可 sweep ~16 個 order,大概 ~$50 一年用量)
```

買 TRX 嘅渠道:
- 印度:WazirX / CoinDCX
- 國際:Binance / Coinbase
- DEX:swap any USDT → TRX

入完之後系統 ready。

---

## 🔁 用戶充值流程(server 自動)

每次用戶 click `+ ADD → USDT → Continue`:

```
[1] POST /api/crypto/create
    └─ Counter.findOneAndUpdate $inc:1   ← atomic alloc derivIndex
    └─ wallet.deriveAccount(N)           ← BIP44 m/44'/195'/0'/0/N
    └─ CryptoOrder created with depositAddress
    └─ return { depositAddress, recommended_usdt, fxRate, expiresAt }

[2] Frontend show QR + address + "Send any amount ≥ 10 USDT"

[3] 用戶從佢自己 wallet 送 X USDT 過 depositAddress(任何 X ≥ 10)
    └─ tx 上鏈

[4] Backend watcher (每 30s):
    └─ for each pending order:
        └─ TronGrid.fetchIncoming(depositAddress, since=createdAt-60s)
        └─ if tx found: atomic findOneAndUpdate(pending → paid)
        └─ engine.creditBalance(userName, X * fxRate)
        └─ socket push rechargeUpdate + myInfo

[5] Frontend RechargeSheet → success
    └─ "Recharge complete +₹X.XX added"
    └─ Header balance: coin animation 飛入
```

---

## 💰 Sweep flow(operator 定期做)

USDT 收到之後**塞喺 deposit addresses**(每 order 一個 sub-address)。要將佢哋
嘅 USDT 轉去 hot wallet 統一管理。

### Manual sweep(隨時可以做)

```bash
ssh easyenglish
cd /opt/aviator/aviator-back

# Dry run(只 print 唔執行)
docker compose exec api node dist/tools/sweep-deposits.js --dry-run

# 真 sweep
docker compose exec api node dist/tools/sweep-deposits.js
```

腳本會:
1. 揾所有 `status=paid AND sweptAt=null` 嘅 orders
2. 對每個 order 嘅 depositAddress:
   - Query USDT 餘額(skip if 0)
   - Query TRX 餘額;如果 < 30 TRX,由 hot wallet 轉 TRX 入嚟做 gas
   - 用 derived privKey 簽 transfer USDT → hot wallet
   - DB 更新 sweptAt + sweptTxHash

### 自動化:加入 crontab

```bash
# /etc/crontab — 每日凌晨 3 點 sweep
0 3 * * * root cd /opt/aviator/aviator-back && docker compose exec -T api node dist/tools/sweep-deposits.js >> /var/log/aviator-sweep.log 2>&1
```

---

## 🛡 從 hot wallet 轉去 cold wallet

Hot wallet 唔應該長期攞太多 USDT(server compromise 風險)。建議:
- 每周 1 次,將 hot wallet 大部分 USDT(留低 ~30%)transfer 去 **cold wallet**
- Cold wallet = 你本人 TronLink 入面一個 mnemonic 從未碰過 server 嘅 wallet
- 唔需要 script,直接 TronLink 手動 send 即可

---

## 📊 Admin 觀察(現階段透過 API + DB)

```bash
# 多少未 sweep 嘅 funds
docker compose exec mongo mongosh aviator --quiet --eval '
  db.cryptoorders.aggregate([
    { $match: { status: "paid", sweptAt: null } },
    { $group: { _id: null, totalUsdt: { $sum: "$actualUsdt" }, count: { $sum: 1 } } }
  ]).toArray()
'

# 最近 10 個 paid order
docker compose exec mongo mongosh aviator --quiet --eval '
  db.cryptoorders.find({ status: "paid" })
    .sort({ paidAt: -1 }).limit(10).project({
      orderId:1, userName:1, actualUsdt:1, actualInr:1, depositAddress:1, sweptAt:1, _id:0
    }).toArray()
'

# Hot wallet USDT 餘額
docker compose exec api node -e '
  const tw = new (require("tronweb").TronWeb)({
    fullHost: process.env.TRON_NETWORK === "mainnet" ? "https://api.trongrid.io" : "https://api.shasta.trongrid.io"
  });
  (async () => {
    const c = await tw.contract().at(process.env.TRON_USDT_CONTRACT);
    const bal = await c.balanceOf("YOUR_HOT_WALLET_ADDRESS").call();
    console.log("Hot wallet USDT:", Number(bal) / 1e6);
  })();
'
```

---

## 🆘 災難恢復

| 情境 | 解決 |
|------|------|
| Server 死,DB 失蹤 | 用 mnemonic + 嘗試已知 derivIndex 範圍(0-1000),搵錢轉走 |
| Mnemonic 漏出去 | 即刻將 hot wallet + 所有 deposits 全部轉走去新 mnemonic 嘅 wallet,通知用戶停止充值 |
| 一個 derivIndex 撞咗(理論上不可能因為 atomic counter) | 寫 ad-hoc 腳本搜 chain 揾所有有 funds 嘅 sub-address,逐個 sweep |

---

## 🚦 從 Shasta 切去 Mainnet 嘅 checklist

```env
# 改 .env
TRON_NETWORK=mainnet
TRON_USDT_CONTRACT=TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t  # 真 Tether USDT
CRYPTO_MIN_CONFIRMATIONS=19    # 21 區塊確認 ~1分鐘,安全
TRONGRID_API_KEY=<必須有,mainnet rate limit 緊>
```

如果用相同 mnemonic — Shasta 上 deploy 嘅 MockUSDT 自動失效(係 Shasta-only)
但你 hot wallet 嘅 TRON address 喺 mainnet 上係**同一條**(BIP44 衍生路徑相同)。
直接 send TRX 入嗰個 address 做 gas,然後 launch 收 mainnet USDT。

---

## 📝 為咩用 per-order 而唔係 single receiver?

| 維度 | Single receiver (舊) | Per-order (現) |
|------|---------------------|----------------|
| Amount 必須精確 | 是(±0.01 都唔得) | 否(任何 ≥min) |
| 多 user 同時 | Ambiguous | 完全獨立 |
| Sweep | 不需要 | 需要(額外 gas 成本) |
| 資金集中風險 | 集中喺 1 個 wallet | 分散直到 sweep |
| Industry standard | ❌ | ✓ |
| User UX | 差(brittle) | 好(scan & pay) |

Per-order 嘅唯一缺點係 sweep gas 成本,~10-20 TRX 一筆 = $2-4。
對 ≥10 USDT 嘅 order 完全可接受(<5% gas overhead)。
