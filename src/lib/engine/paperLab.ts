import { runBacktest, type BacktestReport } from "./backtest";
import { loadYearMarket } from "./market-data";
import { PAPER_BOOKS, type PaperBook } from "./paperBooks";

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
}

export interface PaperLabReport {
  paperOnly: true;
  liveOrders: false;
  years: number;
  books: PaperBookReport[];
  note: string;
}

function summarize(book: PaperBook, report: BacktestReport): PaperBookReport {
  return {
    book,
    ok: report.marketSource === "hyperliquid_public" && !report.blownUp,
    durationDays: report.durationDays,
    shortHistory: report.durationDays < 180,
    bars: report.bars,
    sharpe: report.sharpe,
    sortino: report.sortino,
    cagrPct: report.cagrPct,
    totalReturnPct: report.totalReturnPct,
    maxDrawdownPct: report.maxDrawdownPct,
    trades: report.trades,
    winRatePct: report.winRatePct,
    pValue: report.pValue,
    buyHoldReturnPct: report.buyHoldReturnPct,
    marketSource: report.marketSource,
    epochStart: report.epochStart,
    epochEnd: report.epochEnd,
  };
}

export async function runPaperLab(years = 1): Promise<PaperLabReport> {
  const days = Math.min(5, Math.max(1, years)) * 365;
  const books: PaperBookReport[] = [];
  for (const book of PAPER_BOOKS) {
    try {
      const market = await loadYearMarket(Date.now(), days, book.coin);
      const report = runBacktest(market.series, market.source, years);
      books.push(summarize(book, report));
    } catch (error) {
      books.push({
        book,
        ok: false,
        error: error instanceof Error ? error.message : "paper_book_failed",
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
      });
    }
  }
  return {
    paperOnly: true,
    liveOrders: false,
    years,
    books,
    note:
      "Independent $1000 paper books, same Turtle defaults as live BTC. Do not add Sharpes: BTC/ETH/BNB move together. Equities are the diversifier. Phoenix live BTC is untouched.",
  };
}
