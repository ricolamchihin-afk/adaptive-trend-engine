import type { Feature } from "./strategy";
import type { Regime } from "./types";

export interface GateConfig {
  adxThreshold: number;
  rsiLongMin: number;
  rsiShortMax: number;
  macdFilter: number;
  emaSlopeMinPct: number;
}

export type SetupAction = "ENTER_LONG" | "ENTER_SHORT" | "WAIT" | "FLAT";

export interface SetupGates {
  dailyDir: 1 | -1 | 0;
  adxOk: boolean;
  rsiOk: boolean;
  macdOk: boolean;
  slopeOk: boolean;
  atrOk: boolean;
  donchianReady: boolean;
  breakout: boolean;
}

export interface Setup {
  bias: Regime;
  action: SetupAction;
  reasons: string[];
  gates: SetupGates;
}

function adxOk(feature: Feature, cfg: GateConfig): boolean {
  return feature.adx !== null && feature.adx >= cfg.adxThreshold;
}

function atrOk(feature: Feature): boolean {
  return feature.atr !== null && feature.atr > 0;
}

// Same entry predicates the simulator uses. One place so the Grok playbook,
// live signal, and backtest cannot drift.
export function canEnterLong(feature: Feature, cfg: GateConfig): boolean {
  const rsiOk = cfg.rsiLongMin <= 0 || (feature.rsi !== null && feature.rsi >= cfg.rsiLongMin);
  const macdOk = cfg.macdFilter < 1 || (feature.macdHist !== null && feature.macdHist > 0);
  const slopeOk =
    cfg.emaSlopeMinPct <= 0 ||
    (feature.dailyEmaSlopePct !== null && feature.dailyEmaSlopePct >= cfg.emaSlopeMinPct);
  return (
    adxOk(feature, cfg) &&
    atrOk(feature) &&
    feature.dailyDir > 0 &&
    rsiOk &&
    macdOk &&
    slopeOk &&
    feature.entryHigh !== null &&
    feature.candle.high >= feature.entryHigh
  );
}

export function canEnterShort(feature: Feature, cfg: GateConfig): boolean {
  const rsiOk = cfg.rsiShortMax >= 100 || (feature.rsi !== null && feature.rsi <= cfg.rsiShortMax);
  const macdOk = cfg.macdFilter < 1 || (feature.macdHist !== null && feature.macdHist < 0);
  const slopeOk =
    cfg.emaSlopeMinPct <= 0 ||
    (feature.dailyEmaSlopePct !== null && feature.dailyEmaSlopePct <= -cfg.emaSlopeMinPct);
  return (
    adxOk(feature, cfg) &&
    atrOk(feature) &&
    feature.dailyDir < 0 &&
    rsiOk &&
    macdOk &&
    slopeOk &&
    feature.entryLow !== null &&
    feature.candle.low <= feature.entryLow
  );
}

export function evaluateSetup(feature: Feature, cfg: GateConfig): Setup {
  const longBreakout = canEnterLong(feature, cfg);
  const shortBreakout = canEnterShort(feature, cfg);
  const rsiLong = cfg.rsiLongMin <= 0 || (feature.rsi !== null && feature.rsi >= cfg.rsiLongMin);
  const rsiShort = cfg.rsiShortMax >= 100 || (feature.rsi !== null && feature.rsi <= cfg.rsiShortMax);
  const macdLong = cfg.macdFilter < 1 || (feature.macdHist !== null && feature.macdHist > 0);
  const macdShort = cfg.macdFilter < 1 || (feature.macdHist !== null && feature.macdHist < 0);
  const slopeLong =
    cfg.emaSlopeMinPct <= 0 ||
    (feature.dailyEmaSlopePct !== null && feature.dailyEmaSlopePct >= cfg.emaSlopeMinPct);
  const slopeShort =
    cfg.emaSlopeMinPct <= 0 ||
    (feature.dailyEmaSlopePct !== null && feature.dailyEmaSlopePct <= -cfg.emaSlopeMinPct);

  if (longBreakout) {
    return {
      bias: "LONG",
      action: "ENTER_LONG",
      reasons: ["Daily close above EMA", "Donchian entry high broken", "Momentum gates pass"],
      gates: {
        dailyDir: feature.dailyDir,
        adxOk: true,
        rsiOk: rsiLong,
        macdOk: macdLong,
        slopeOk: slopeLong,
        atrOk: true,
        donchianReady: feature.entryHigh !== null,
        breakout: true,
      },
    };
  }
  if (shortBreakout) {
    return {
      bias: "SHORT",
      action: "ENTER_SHORT",
      reasons: ["Daily close below EMA", "Donchian entry low broken", "Momentum gates pass"],
      gates: {
        dailyDir: feature.dailyDir,
        adxOk: true,
        rsiOk: rsiShort,
        macdOk: macdShort,
        slopeOk: slopeShort,
        atrOk: true,
        donchianReady: feature.entryLow !== null,
        breakout: true,
      },
    };
  }

  if (feature.dailyDir > 0 && adxOk(feature, cfg) && rsiLong && macdLong && slopeLong) {
    return {
      bias: "LONG",
      action: "WAIT",
      reasons: ["Regime is long-only; waiting for a Donchian breakout"],
      gates: {
        dailyDir: feature.dailyDir,
        adxOk: true,
        rsiOk: rsiLong,
        macdOk: macdLong,
        slopeOk: slopeLong,
        atrOk: atrOk(feature),
        donchianReady: feature.entryHigh !== null,
        breakout: false,
      },
    };
  }
  if (feature.dailyDir < 0 && adxOk(feature, cfg) && rsiShort && macdShort && slopeShort) {
    return {
      bias: "SHORT",
      action: "WAIT",
      reasons: ["Regime is short-only; waiting for a Donchian breakdown"],
      gates: {
        dailyDir: feature.dailyDir,
        adxOk: true,
        rsiOk: rsiShort,
        macdOk: macdShort,
        slopeOk: slopeShort,
        atrOk: atrOk(feature),
        donchianReady: feature.entryLow !== null,
        breakout: false,
      },
    };
  }

  const reasons: string[] = [];
  if (feature.dailyDir === 0) reasons.push("Daily EMA regime unavailable");
  if (!adxOk(feature, cfg)) reasons.push("ADX below threshold");
  if (feature.dailyDir > 0 && !rsiLong) reasons.push("RSI below long gate");
  if (feature.dailyDir < 0 && !rsiShort) reasons.push("RSI above short gate");
  if (!reasons.length) reasons.push("Gates conflict; stay flat");
  return {
    bias: "FLAT",
    action: "FLAT",
    reasons,
    gates: {
      dailyDir: feature.dailyDir,
      adxOk: adxOk(feature, cfg),
      rsiOk: feature.dailyDir < 0 ? rsiShort : rsiLong,
      macdOk: feature.dailyDir < 0 ? macdShort : macdLong,
      slopeOk: feature.dailyDir < 0 ? slopeShort : slopeLong,
      atrOk: atrOk(feature),
      donchianReady: feature.entryHigh !== null || feature.entryLow !== null,
      breakout: false,
    },
  };
}
