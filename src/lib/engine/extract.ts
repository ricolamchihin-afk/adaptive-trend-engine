import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fetchYahooBars } from "./feeds";
import { US_EQUITY_WATCHLIST } from "./universe";

export interface ExtractedSeries {
  symbol: string;
  ticker: string;
  source: "yahoo_public";
  interval: "1d";
  bars: Array<[number, number, number, number, number, number]>;
}

export interface ExtractReport {
  writtenAt: string;
  dir: string;
  files: string[];
  symbols: Array<{ symbol: string; bars: number; first: string | null; last: string | null }>;
}

const DIR = path.join(process.cwd(), "data", "us-equity");

export async function extractUsEquity(
  symbols: readonly string[] = US_EQUITY_WATCHLIST,
  now = Date.now(),
): Promise<ExtractReport> {
  await mkdir(DIR, { recursive: true });
  const files: string[] = [];
  const summary: ExtractReport["symbols"] = [];
  for (const symbol of symbols) {
    const candles = await fetchYahooBars(symbol, "1d", "5y", now);
    const payload: ExtractedSeries = {
      symbol,
      ticker: symbol,
      source: "yahoo_public",
      interval: "1d",
      bars: candles.map((c) => [c.openTime, c.open, c.high, c.low, c.close, c.volume]),
    };
    const file = `${symbol}.json`;
    await writeFile(path.join(DIR, file), `${JSON.stringify(payload)}\n`, "utf8");
    files.push(file);
    summary.push({
      symbol,
      bars: candles.length,
      first: candles[0] ? new Date(candles[0].openTime).toISOString() : null,
      last: candles.length ? new Date(candles[candles.length - 1].openTime).toISOString() : null,
    });
  }
  const manifest = {
    writtenAt: new Date(now).toISOString(),
    source: "yahoo_public",
    interval: "1d",
    range: "5y",
    note: "US cash daily OHLCV for Aster stock-perp names. Use with the Adaptive Trend Engine playbook. Not for live orders.",
    symbols: summary,
  };
  await writeFile(path.join(DIR, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  files.push("manifest.json");
  return { writtenAt: manifest.writtenAt, dir: DIR, files, symbols: summary };
}
