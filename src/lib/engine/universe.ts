export type AssetClass = "crypto" | "equity" | "commodity" | "unknown";
export type DataFeed = "yahoo" | "binance" | "hyperliquid" | "aster";

export interface ResolvedSymbol {
  input: string;
  base: string;
  assetClass: AssetClass;
  // Cash-market ticker used for signal generation (Yahoo). Null if none.
  cashTicker: string | null;
  // Listed-exchange crypto symbol (Binance-style).
  binanceSymbol: string | null;
  hyperliquidCoin: string | null;
  // Aster USDT-margined perp to trade after the signal is decided.
  asterSymbol: string;
  preferredFeed: DataFeed;
  fallbackFeeds: DataFeed[];
  note: string;
}

const ASTER_INFO = "https://fapi.asterdex.com/fapi/v1/exchangeInfo";

// Aster base → Yahoo cash ticker when they differ (US first, then ADRs / foreign).
export const CASH_ALIAS: Record<string, string> = {
  PAYP: "PYPL",
  BRKB: "BRK-B",
  SAMSUNG: "005930.KS",
  SKHYNIX: "000660.KS",
  SKHY: "000660.KS",
  TENCENT: "0700.HK",
  XIAOMI: "1810.HK",
  KUAISHOU: "1024.HK",
  MEITUAN: "3690.HK",
  HYUNDAI: "005380.KS",
  POPMART: "9992.HK",
};

const COMMODITY_CASH: Record<string, string> = {
  XAU: "GC=F",
  XAG: "SI=F",
  CL: "CL=F",
  NATGAS: "NG=F",
  PAXG: "GC=F",
};

const COMMODITY = new Set(Object.keys(COMMODITY_CASH));

// Liquid US names Aster lists as STOCK/ETF perps. Used when Aster info is down
// and for the default Grok watchlist / extract.
export const US_EQUITY_WATCHLIST = [
  "AAPL",
  "TSLA",
  "NVDA",
  "AMZN",
  "META",
  "MSFT",
  "GOOGL",
  "QQQ",
  "SPY",
  "MU",
  "AMD",
  "AVGO",
  "PLTR",
  "COIN",
  "HOOD",
  "MSTR",
  "NFLX",
  "TSM",
  "INTC",
  "ORCL",
] as const;

const STATIC_STOCK = new Set<string>([
  ...US_EQUITY_WATCHLIST,
  "ADBE",
  "AMAT",
  "ARM",
  "ASML",
  "ASTS",
  "BABA",
  "COST",
  "CRM",
  "CRWD",
  "CSCO",
  "DELL",
  "DIS",
  "GME",
  "HD",
  "IBM",
  "IREN",
  "IWM",
  "JPM",
  "LLY",
  "MRVL",
  "NVO",
  "QCOM",
  "RIVN",
  "RKLB",
  "SNDK",
  "SOXL",
  "TQQQ",
  "UBER",
  "V",
  "WMT",
  "CRCL",
  "PAYP",
  "BRKB",
]);

const STATIC_CRYPTO = new Set([
  "BTC",
  "ETH",
  "SOL",
  "BNB",
  "XRP",
  "DOGE",
  "ADA",
  "AVAX",
  "LINK",
  "SUI",
  "HYPE",
  "ASTER",
  "LTC",
  "BCH",
  "DOT",
  "NEAR",
  "UNI",
  "AAVE",
  "TAO",
  "WIF",
  "PEPE",
  "1000PEPE",
  "TRUMP",
]);

export function stripQuote(raw: string): string {
  return raw.trim().toUpperCase().replace(/[-_]?USDT$/i, "").replace(/[-_]?USD$/i, "");
}

export function cashTickerFor(base: string): string | null {
  if (COMMODITY_CASH[base]) return COMMODITY_CASH[base];
  if (CASH_ALIAS[base]) return CASH_ALIAS[base];
  if (STATIC_STOCK.has(base)) return base;
  return null;
}

export function describeRoute(assetClass: AssetClass): string {
  switch (assetClass) {
    case "crypto":
      return "Signal from Binance or Hyperliquid public candles; execute on Aster perps.";
    case "equity":
      return "Signal from US (or listed cash) market data; execute on Aster stock perps.";
    case "commodity":
      return "Signal from the cash/futures print when mapped; otherwise Aster venue candles.";
    case "unknown":
      return "Unclassified. Try a listed Aster base (AAPL, BTC) or a Yahoo ticker.";
    default: {
      const neverClass: never = assetClass;
      return neverClass;
    }
  }
}

export function resolveSymbol(
  raw: string,
  asterStockBases?: Set<string>,
  asterCommodityBases?: Set<string>,
): ResolvedSymbol {
  const base = stripQuote(raw);
  const asterSymbol = `${base}USDT`;
  const stock = asterStockBases?.has(base) ?? STATIC_STOCK.has(base);
  const commodity = asterCommodityBases?.has(base) ?? COMMODITY.has(base);
  const crypto = STATIC_CRYPTO.has(base) && !stock;

  if (stock || (!crypto && !commodity && cashTickerFor(base) && STATIC_STOCK.has(base))) {
    const cash = cashTickerFor(base) ?? base;
    return {
      input: raw,
      base,
      assetClass: "equity",
      cashTicker: cash,
      binanceSymbol: null,
      hyperliquidCoin: null,
      asterSymbol,
      preferredFeed: "yahoo",
      fallbackFeeds: ["aster"],
      note: describeRoute("equity"),
    };
  }
  if (commodity) {
    return {
      input: raw,
      base,
      assetClass: "commodity",
      cashTicker: COMMODITY_CASH[base] ?? null,
      binanceSymbol: null,
      hyperliquidCoin: null,
      asterSymbol,
      preferredFeed: COMMODITY_CASH[base] ? "yahoo" : "aster",
      fallbackFeeds: ["aster"],
      note: describeRoute("commodity"),
    };
  }
  if (crypto || STATIC_CRYPTO.has(base)) {
    return {
      input: raw,
      base,
      assetClass: "crypto",
      cashTicker: null,
      binanceSymbol: asterSymbol,
      hyperliquidCoin: base === "1000PEPE" ? "kPEPE" : base,
      asterSymbol,
      preferredFeed: "binance",
      fallbackFeeds: ["hyperliquid", "aster"],
      note: describeRoute("crypto"),
    };
  }
  // Unknown: if it looks like a US ticker, treat as equity; else crypto on listed venues.
  if (/^[A-Z]{1,5}$/.test(base)) {
    return {
      input: raw,
      base,
      assetClass: "equity",
      cashTicker: base,
      binanceSymbol: null,
      hyperliquidCoin: null,
      asterSymbol,
      preferredFeed: "yahoo",
      fallbackFeeds: ["aster"],
      note: describeRoute("equity"),
    };
  }
  return {
    input: raw,
    base,
    assetClass: "unknown",
    cashTicker: null,
    binanceSymbol: asterSymbol,
    hyperliquidCoin: base,
    asterSymbol,
    preferredFeed: "binance",
    fallbackFeeds: ["hyperliquid", "aster"],
    note: describeRoute("unknown"),
  };
}

interface AsterSymbolRow {
  symbol?: string;
  baseAsset?: string;
  status?: string;
  underlyingSubType?: string[];
}

export interface AsterUniverse {
  fetchedAt: number;
  stockBases: string[];
  etfBases: string[];
  commodityBases: string[];
  cryptoBases: string[];
}

export async function fetchAsterUniverse(now = Date.now()): Promise<AsterUniverse> {
  const response = await fetch(ASTER_INFO, { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`aster_exchange_info_${response.status}`);
  }
  const payload = (await response.json()) as { symbols?: AsterSymbolRow[] };
  const stock = new Set<string>();
  const etf = new Set<string>();
  const commodity = new Set<string>();
  const crypto = new Set<string>();
  for (const row of payload.symbols ?? []) {
    if ((row.status ?? "").toUpperCase() !== "TRADING") continue;
    const base = (row.baseAsset ?? "").toUpperCase();
    if (!base) continue;
    const sub = (row.underlyingSubType ?? []).map((s) => s.toUpperCase());
    if (sub.includes("STOCK") || sub.includes("ETF")) {
      if (sub.includes("ETF")) etf.add(base);
      if (sub.includes("STOCK") || sub.includes("ETF")) stock.add(base);
      continue;
    }
    if (sub.includes("COMMODITIES") || COMMODITY.has(base)) {
      commodity.add(base);
      continue;
    }
    crypto.add(base);
  }
  return {
    fetchedAt: now,
    stockBases: [...stock].sort(),
    etfBases: [...etf].sort(),
    commodityBases: [...commodity].sort(),
    cryptoBases: [...crypto].sort(),
  };
}

export function asterEquityBases(universe: AsterUniverse): string[] {
  return [...new Set([...universe.stockBases, ...universe.etfBases])].sort();
}

export function resolveAgainstUniverse(raw: string, universe: AsterUniverse | null): ResolvedSymbol {
  if (!universe) return resolveSymbol(raw);
  const stock = new Set([...universe.stockBases, ...universe.etfBases]);
  const commodity = new Set(universe.commodityBases);
  const resolved = resolveSymbol(raw, stock, commodity);
  const base = resolved.base;
  if (stock.has(base)) {
    return {
      ...resolved,
      assetClass: "equity",
      cashTicker: cashTickerFor(base) ?? (/^[A-Z.]{1,8}$/.test(base) ? base : resolved.cashTicker),
      preferredFeed: "yahoo",
      fallbackFeeds: ["aster"],
      note: describeRoute("equity"),
    };
  }
  if (commodity.has(base)) {
    return {
      ...resolved,
      assetClass: "commodity",
      cashTicker: COMMODITY_CASH[base] ?? resolved.cashTicker,
      preferredFeed: COMMODITY_CASH[base] ? "yahoo" : "aster",
      fallbackFeeds: ["aster"],
      note: describeRoute("commodity"),
    };
  }
  if (universe.cryptoBases.includes(base) || resolved.assetClass === "crypto") {
    return {
      ...resolved,
      assetClass: "crypto",
      cashTicker: null,
      binanceSymbol: `${base}USDT`,
      hyperliquidCoin: base,
      preferredFeed: "binance",
      fallbackFeeds: ["hyperliquid", "aster"],
      note: describeRoute("crypto"),
    };
  }
  return resolved;
}
