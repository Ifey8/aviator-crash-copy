import { config } from "../config";
import { hotWallet } from "./wallet";

/**
 * Hot-wallet status helpers — used by:
 *   • Admin dashboard (live balance display)
 *   • USDT withdrawal flow (deciding "manual_queue" vs "processing")
 *
 * We query TronGrid REST so we don't need a tronweb full-node connection
 * just for read-only balances.
 */

const SHASTA_BASE = "https://api.shasta.trongrid.io";
const MAINNET_BASE = "https://api.trongrid.io";

const apiBase = (): string =>
  config.tronNetwork === "mainnet" ? MAINNET_BASE : SHASTA_BASE;

export interface HotWalletBalance {
  address: string;
  network: string;
  trxBalance: number;       // for paying gas on outgoing transfers
  usdtBalance: number;      // available to fulfil USDT withdrawals
  contract: string;
  fetchedAt: Date;
}

/** Fetch TRX + USDT balance of the hot wallet (index 0). */
export const getHotWalletBalance = async (): Promise<HotWalletBalance | null> => {
  if (!config.tronNetwork) return null;
  let address: string;
  try {
    address = hotWallet().address;
  } catch {
    return null;
  }

  const headers: Record<string, string> = { accept: "application/json" };
  if (config.trongridApiKey) headers["TRON-PRO-API-KEY"] = config.trongridApiKey;

  let trxBalance = 0;
  let usdtBalance = 0;
  try {
    const accRes = await fetch(`${apiBase()}/v1/accounts/${address}`, {
      headers,
      signal: AbortSignal.timeout(5000),
    });
    if (accRes.ok) {
      const j = (await accRes.json()) as { data?: Array<{ balance?: number }> };
      const sun = j?.data?.[0]?.balance || 0;
      trxBalance = sun / 1_000_000;
    }
  } catch {
    /* tolerate; report 0 */
  }
  try {
    if (config.tronContract) {
      const tokRes = await fetch(
        `${apiBase()}/v1/accounts/${address}?only_visible=true`,
        { headers, signal: AbortSignal.timeout(5000) },
      );
      if (tokRes.ok) {
        // Use TRC20 balanceOf via /wallet/triggerconstantcontract for accuracy.
        const balanceOfBody = {
          owner_address: address,
          contract_address: config.tronContract,
          function_selector: "balanceOf(address)",
          parameter:
            "000000000000000000000000" +
            (require("tronweb").TronWeb.address.toHex(address) as string).slice(2),
          visible: true,
        };
        const r = await fetch(`${apiBase()}/wallet/triggerconstantcontract`, {
          method: "POST",
          headers: { ...headers, "content-type": "application/json" },
          body: JSON.stringify(balanceOfBody),
          signal: AbortSignal.timeout(5000),
        });
        if (r.ok) {
          const j = (await r.json()) as { constant_result?: string[] };
          const hex = j?.constant_result?.[0];
          if (hex) {
            // USDT-TRC20 has 6 decimals
            const raw = BigInt("0x" + hex);
            usdtBalance = Number(raw) / 1_000_000;
          }
        }
      }
    }
  } catch {
    /* tolerate */
  }

  return {
    address,
    network: config.tronNetwork,
    trxBalance: +trxBalance.toFixed(4),
    usdtBalance: +usdtBalance.toFixed(4),
    contract: config.tronContract || "",
    fetchedAt: new Date(),
  };
};
