import type { LiveConfig } from "./liveConfig";

export interface OrderIntent {
  action: string;
  side: "LONG" | "SHORT" | "FLAT";
  sizeBtc: number;
  notionalUsd: number;
  price: number;
}

export interface ExecutionResult {
  submitted: boolean;
  live: boolean;
  message: string;
}

// The execution seam. Live trading requires a real, trade-capable Executor; until
// one exists the system uses PaperExecutor and cannot touch an exchange.
export interface Executor {
  readonly name: string;
  readonly canTrade: boolean;
  submit(intent: OrderIntent): Promise<ExecutionResult>;
}

export class PaperExecutor implements Executor {
  readonly name = "paper";
  readonly canTrade = false;
  async submit(intent: OrderIntent): Promise<ExecutionResult> {
    return { submitted: false, live: false, message: `Dry run: ${intent.action} not sent.` };
  }
}

// Placeholder for the real Phoenix venue adapter. It intentionally refuses to trade:
// real order submission must be implemented against Phoenix's verified API and proven
// on testnet / minimal size before `canTrade` is flipped true. Faking this risks funds.
export class PhoenixLiveExecutor implements Executor {
  readonly name = "phoenix-live";
  readonly canTrade = false;
  async submit(): Promise<ExecutionResult> {
    throw new Error(
      "phoenix_live_adapter_not_implemented: build and testnet-verify the Phoenix order adapter before enabling live trading",
    );
  }
}

// Returns the paper executor unless a genuinely trade-capable live adapter exists AND
// live trading is enabled. The Phoenix adapter is not yet trade-capable, so this stays
// on paper by construction.
export function getExecutor(cfg: LiveConfig): Executor {
  if (cfg.liveTradingEnabled) {
    const live = new PhoenixLiveExecutor();
    if (live.canTrade) {
      return live;
    }
  }
  return new PaperExecutor();
}
