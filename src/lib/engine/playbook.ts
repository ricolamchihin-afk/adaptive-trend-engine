import { STRATEGY } from "./spec";

// Machine-readable copy of the Adaptive Trend Engine rules for a Grok bot.
// The bot should emit LONG / SHORT / FLAT only. It must not place orders.
export const GROK_PLAYBOOK = {
  name: "Adaptive Trend Engine",
  version: "aster_preps_v1",
  paperOnly: true,
  venue: {
    execute: "aster_usdt_perps",
    cryptoSignal: ["binance", "hyperliquid"],
    equitySignal: ["us_cash_yahoo"],
    rule: "If the instrument is crypto, read listed-exchange candles (Binance, else Hyperliquid). If it is a stock or ETF, read the US (or listed cash) print. Always trade the matching Aster perp after the signal, never the cash share.",
  },
  timeframe: {
    execution: "4h",
    regime: "1d",
    note: "US cash hours are shorter than crypto. 1h Yahoo bars are resampled into UTC 4h buckets (~1–2 bars per session).",
  },
  indicators: {
    dailyEma: { period: STRATEGY.dailyEmaPeriod, role: "regime_gate" },
    donchianEntry: { period: STRATEGY.donchianEntry, role: "breakout_entry" },
    donchianExit: { period: STRATEGY.donchianExit, role: "trailing_stop" },
    atr: { period: STRATEGY.atrPeriod, stopMult: STRATEGY.atrStopMult, role: "initial_stop_and_size" },
    adx: { period: STRATEGY.adxPeriod, threshold: STRATEGY.adxThreshold, role: "optional_trend_strength" },
    rsi: {
      period: STRATEGY.rsiPeriod,
      longMin: STRATEGY.rsiLongMin,
      shortMax: STRATEGY.rsiShortMax,
      role: "momentum_gate",
    },
    macdHistogram: { fast: 12, slow: 26, signal: 9, role: "optional_confirmation" },
    dailyEmaSlope: { lookbackDays: 10, minPct: STRATEGY.emaSlopeMinPct, role: "optional_regime_strength" },
  },
  rules: {
    long: [
      "Daily close is above daily EMA(150) — longs only in a bullish regime.",
      "4h high breaks the prior 34-bar Donchian high.",
      "RSI(14) >= 50 (unless the long gate is disabled).",
      "ADX >= threshold (0 = off). MACD histogram > 0 only if the MACD filter is on.",
    ],
    short: [
      "Daily close is below daily EMA(150) — shorts only in a bearish regime.",
      "4h low breaks the prior 34-bar Donchian low.",
      "RSI(14) <= 50 (unless the short gate is disabled).",
      "ADX >= threshold (0 = off). MACD histogram < 0 only if the MACD filter is on.",
    ],
    exit: [
      "Trail winners on the opposite 5-bar Donchian (longs trail the exit low, shorts the exit high).",
      `Initial stop is ${STRATEGY.atrStopMult}× ATR(14) from the fill.`,
      `Optional dynamic take-profit: TP% = ${STRATEGY.tpAdxFactor} × ADX(at entry), clamped ${STRATEGY.tpMinRoePct}–${STRATEGY.tpMaxRoePct}%.`,
    ],
    size: [
      `Risk ${STRATEGY.riskPct * 100}% of equity per trade: size = equity × riskPct / (atrStopMult × ATR).`,
      `Leverage is a hard cap at ${STRATEGY.maxLeverage}x, not a target.`,
    ],
    flat: [
      "No daily regime, failed momentum gate, missing ATR/Donchian warmup, or a hard conflict → FLAT.",
      "Do not fade the daily EMA. Do not enter both ways.",
    ],
  },
  outputContract: {
    bias: ["LONG", "SHORT", "FLAT"],
    action: ["ENTER_LONG", "ENTER_SHORT", "WAIT", "FLAT"],
    requiredFields: ["symbol", "bias", "action", "reasons", "indicators", "route"],
  },
  systemPrompt: [
    "You are a paper analyst for the Adaptive Trend Engine.",
    "Decide LONG, SHORT, or FLAT from the supplied indicator snapshot. Do not invent candles.",
    "Crypto: trust Binance or Hyperliquid features. Stocks: trust the US cash features.",
    "The trading venue is Aster USDT-margined perps. Never place, cancel, or resize an order.",
    "If dailyDir is +1, only consider long. If dailyDir is -1, only consider short. If 0, stay FLAT.",
    "A WAIT action means the regime is valid but the Donchian breakout has not printed.",
    "Cite the gates that failed. Never override the daily EMA filter.",
  ].join(" "),
  cioPrompt: [
    "You are the CIO of a paper Aster equity-perp book.",
    "Every four hours you receive a fresh screen snapshot (latest.json / cio-brief.json). It is not a live stream.",
    "Recommend only from that snapshot. Do not invent names, candles, or fills.",
    "Priority: ENTER_LONG and ENTER_SHORT first, then WAIT in the same dailyDir, then FLAT.",
    "For each recommendation state: asterSymbol, bias, action, one-line reason, and what would invalidate it (dailyDir flip or failed RSI/Donchian).",
    "Size is already ATR-risked in the engine. You do not override size or leverage.",
    "Never place, cancel, or resize an order. End with: paper only, wait for the next 4h snapshot.",
  ].join(" "),
  aws: {
    needed: false,
    reason: "Daily + hourly bars for the Aster stock watchlist are kilobytes from Yahoo. No object store is required.",
    ifForced: {
      s3Watchlist: "~50 MB for 20 names × 5y hourly. S3 Standard ≈ $0.001/month plus pennies of GET requests.",
      s3FullUs1m: "HF Data Library / SIP 1-minute for ~1,400 names is tens to low hundreds of GB → roughly $1–5/month storage, plus egress if you pull it out of AWS.",
      polygonOrSip: "Paid SIP / Polygon is $29–several hundred per month. Skip unless you need official consolidated tape.",
      recommendation: "Stay on Yahoo + Aster/Binance/Hyperliquid public APIs. Cost is $0.",
    },
  },
  datasets: {
    live: [
      "Yahoo Finance v8 chart (US cash daily + 1h)",
      "Binance / Binance.US public klines (crypto)",
      "Hyperliquid candleSnapshot (crypto fallback)",
      "Aster fapi klines + exchangeInfo (venue marks + stock-perp universe)",
    ],
    historicalFree: [
      "https://github.com/aexsalomao/marketgoblin — Yahoo/Tiingo → Parquet",
      "https://hfdatalibrary.com — CC BY 4.0 US 1-minute OHLCV (optional, large)",
      "https://huggingface.co/datasets/brandonyeequon/stock-market-data-warehouse — 15m warehouse (needs review)",
    ],
  },
} as const;
