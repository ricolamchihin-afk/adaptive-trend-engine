import { loadYearMarket } from "./market-data";
import { overlayEqualDollar, scoreEquityPath, type PortfolioScore } from "./portfolio";
import { PAPER_BOOKS, type PaperBook } from "./paperBooks";
import { defaultSimConfig, runSimulation } from "./simulate";
import { buildFeatures } from "./strategy";
import { STRATEGY } from "./spec";

export interface PaperBookReport {
  book: PaperBook;
  ok: boolean;
  error?: string;
  durationDays: number;
  shortHistory: boolean;
  bars: number;
  sharpe: number | null;
  sortino: number | null;
  cagrPct: number;
  totalReturnPct: number;
  maxDrawdownPct: number;
  trades: number;
  winRatePct: number | null;
  pValue: number | null;
  buyHoldReturnPct: number;
  marketSource: string;
  epochStart?: string;
  epochEnd?: string;
  warmupBlocked: boolean;
}

export interface PaperLabReport {
  paperOnly: true;
  liveOrders: false;
  venue: "decibel";
  years: number;
  sleeveCapitalUsd: number;
  portfolio: {
    all: PortfolioScore;
    crypto: PortfolioScore;
    equity: PortfolioScore;
  };
  books: PaperBookReport[];
  note: string;
}

function emptyBook(book: PaperBook, error: string): PaperBookReport {
  return {
    book,
    ok: false,
    error,
    warmupBlocked: false,
    durationDays: 0,
    shortHistory: true,
    bars: 0,
    sharpe: null,
    sortino: null,
    cagrPct: 0,
    totalReturnPct: 0,
    maxDrawdownPct: 0,
    trades: 0,
    winRatePct: null,
    pValue: null,
    buyHoldReturnPct: 0,
    marketSource: "none",
  };
}

function scoreSleeve(
  label: string,
  rows: Array<{ book: PaperBook; bars: Array<{ t: number; equity: number }> }>,
  cashUsd: number,
): PortfolioScore {
  const names = rows.map((r) => r.book.label);
  return scoreEquityPath(
    overlayEqualDollar(
      rows.map((r) => r.bars),
      cashUsd,
    ),
    cashUsd * Math.max(1, rows.length),
    label,
    names,
  );
}

export async function runPaperLab(years = 1): Promise<PaperLabReport> {
  const days = Math.min(5, Math.max(1, years)) * 365;
  const cashUsd = STRATEGY.capitalUsd;
  const books: PaperBookReport[] = [];
  const sleeveRows: Array<{ book: PaperBook; bars: Array<{ t: number; equity: number }> }> = [];

  for (const book of PAPER_BOOKS) {
    try {
      const market = await loadYearMarket(Date.now(), days, book.coin);
      const exec = market.series.fourHour;
      if (!exec.length) {
        books.push(emptyBook(book, "no_four_hour_candles"));
        continue;
      }
      const sim = runSimulation(buildFeatures(market.series), defaultSimConfig());
      const first = exec[0].openTime;
      const last = exec[exec.length - 1].openTime;
      const durationDays = (last - first) / 86_400_000;
      const yearsFrac = durationDays / 365;
      const growth = sim.finalEquityUsd / sim.startEquityUsd;
      const buyHold = exec[0].close > 0 ? (exec[exec.length - 1].close / exec[0].close - 1) * 100 : 0;
      books.push({
        book,
        ok: market.source === "hyperliquid_public" && !sim.blownUp,
        warmupBlocked: market.series.daily.length < STRATEGY.dailyEmaPeriod,
        durationDays,
        shortHistory: durationDays < 180,
        bars: exec.length,
        sharpe: sim.sharpe,
        sortino: sim.sortino,
        cagrPct: yearsFrac > 0 && growth > 0 ? (growth ** (1 / yearsFrac) - 1) * 100 : 0,
        totalReturnPct: sim.totalReturnPct,
        maxDrawdownPct: sim.maxDrawdownPct,
        trades: sim.trades,
        winRatePct: sim.winRatePct,
        pValue: sim.pValue,
        buyHoldReturnPct: buyHold,
        marketSource: market.source,
        epochStart: new Date(first).toISOString(),
        epochEnd: new Date(last).toISOString(),
      });
      if (book.role === "candidate" && market.source === "hyperliquid_public") {
        sleeveRows.push({ book, bars: sim.equityBars });
      }
    } catch (error) {
      books.push(emptyBook(book, error instanceof Error ? error.message : "paper_book_failed"));
    }
  }

  const crypto = sleeveRows.filter((r) => r.book.sleeve === "crypto");
  const equity = sleeveRows.filter((r) => r.book.sleeve === "equity");
  return {
    paperOnly: true,
    liveOrders: false,
    venue: "decibel",
    years,
    sleeveCapitalUsd: cashUsd,
    portfolio: {
      all: scoreSleeve("Decibel portfolio", sleeveRows, cashUsd),
      crypto: scoreSleeve("Crypto sleeve", crypto, cashUsd),
      equity: scoreSleeve("Equity sleeve", equity, cashUsd),
    },
    books,
    note:
      "Headline Sharpe is the equal-dollar Decibel portfolio (ETH + BNB + equities, BTC excluded). Each name gets $1000; unlisted names sit in cash. Individual rows are contribution only. Paper; no Decibel or Phoenix orders.",
  };
}
