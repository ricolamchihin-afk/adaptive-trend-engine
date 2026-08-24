export type PaperSleeve = "crypto" | "equity";

export interface PaperBook {
  id: string;
  label: string;
  coin: string;
  sleeve: PaperSleeve;
  role: "reference" | "candidate";
  note?: string;
}

// Paper-only universe. Phoenix BTC stays live on the go-live branch.
// Decibel portfolio = candidate books only. Research candles are public Hyperliquid
// (core perps + trade.xyz HIP-3 `xyz:TICKER`); Decibel is the intended live venue.
export const PAPER_BOOKS: readonly PaperBook[] = [
  { id: "btc", label: "BTC", coin: "BTC", sleeve: "crypto", role: "reference", note: "Phoenix live standalone. Not in the Decibel portfolio." },
  { id: "eth", label: "ETH", coin: "ETH", sleeve: "crypto", role: "candidate" },
  { id: "bnb", label: "BNB", coin: "BNB", sleeve: "crypto", role: "candidate" },
  { id: "tsla", label: "TSLA", coin: "xyz:TSLA", sleeve: "equity", role: "candidate" },
  { id: "nvda", label: "NVDA", coin: "xyz:NVDA", sleeve: "equity", role: "candidate" },
  { id: "aapl", label: "AAPL", coin: "xyz:AAPL", sleeve: "equity", role: "candidate" },
  { id: "msft", label: "MSFT", coin: "xyz:MSFT", sleeve: "equity", role: "candidate" },
  { id: "googl", label: "GOOGL", coin: "xyz:GOOGL", sleeve: "equity", role: "candidate" },
  { id: "amzn", label: "AMZN", coin: "xyz:AMZN", sleeve: "equity", role: "candidate" },
  { id: "meta", label: "META", coin: "xyz:META", sleeve: "equity", role: "candidate" },
  { id: "sp500", label: "SP500", coin: "xyz:SP500", sleeve: "equity", role: "candidate", note: "Index perp; shorter HL history than single names." },
];

export const DECIBEL_PORTFOLIO_BOOKS: readonly PaperBook[] = PAPER_BOOKS.filter((b) => b.role === "candidate");
