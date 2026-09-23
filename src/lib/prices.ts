const FALLBACK: Record<string, number> = {
  BTC: 65_000,
  ETH: 3_200,
  BNB: 600,
  USDC: 1,
  USTB: 1,
  ixUSDC: 1,
};

let cache: { at: number; prices: Record<string, number> } | null = null;
const TTL_MS = 5 * 60 * 1000;

export async function getPrices(): Promise<Record<string, number>> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.prices;
  const prices = { ...FALLBACK };
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 4000);
    const res = await fetch(
      "https://api.coingecko.com/api/v3/simple/price?ids=bitcoin,ethereum,binancecoin&vs_currencies=usd",
      { signal: ctrl.signal, cache: "no-store" },
    );
    clearTimeout(t);
    if (res.ok) {
      const json = (await res.json()) as { bitcoin?: { usd?: number }; ethereum?: { usd?: number }; binancecoin?: { usd?: number } };
      if (json.bitcoin?.usd) prices.BTC = json.bitcoin.usd;
      if (json.ethereum?.usd) prices.ETH = json.ethereum.usd;
      if (json.binancecoin?.usd) prices.BNB = json.binancecoin.usd;
    }
  } catch {
    // keep fallbacks; prices are illustrative on testnet
  }
  cache = { at: Date.now(), prices };
  return prices;
}

let volCache: { at: number; value: number | null } | null = null;
const VOL_TTL_MS = 60 * 60 * 1000;

/**
 * Realized 30-day BTC volatility (annualized, in %) from daily closes. Returns null when the
 * market data API is unavailable so callers can skip volatility-based warnings honestly.
 */
export async function getBtcVolatility30d(): Promise<number | null> {
  if (volCache && Date.now() - volCache.at < VOL_TTL_MS) return volCache.value;
  let value: number | null = null;
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 5000);
    const res = await fetch("https://api.coingecko.com/api/v3/coins/bitcoin/market_chart?vs_currency=usd&days=30&interval=daily", { signal: ctrl.signal, cache: "no-store" });
    clearTimeout(t);
    if (res.ok) {
      const json = (await res.json()) as { prices?: [number, number][] };
      const closes = (json.prices ?? []).map((p) => p[1]).filter((v) => v > 0);
      if (closes.length >= 10) {
        const returns = closes.slice(1).map((c, i) => Math.log(c / closes[i]));
        const mean = returns.reduce((s, r) => s + r, 0) / returns.length;
        const variance = returns.reduce((s, r) => s + (r - mean) ** 2, 0) / (returns.length - 1);
        value = Math.round(Math.sqrt(variance) * Math.sqrt(365) * 1000) / 10;
      }
    }
  } catch {
    value = null;
  }
  volCache = { at: Date.now(), value };
  return value;
}
