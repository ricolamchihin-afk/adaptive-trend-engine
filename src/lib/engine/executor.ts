import type { LiveConfig } from "./liveConfig";
import { PhoenixPerpExecutor, phoenixConfigured } from "./phoenixExecutor";

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

// Returns the Phoenix Perpetuals adapter when it is configured (API + authority set),
// otherwise the safe paper executor. The Phoenix adapter still refuses to actually
// send orders until it is testnet-verified and live trading is enabled (its canTrade
// gate), so this stays paper-safe until that deliberate step.
export function getExecutor(cfg: LiveConfig): Executor {
  void cfg;
  if (phoenixConfigured()) {
    return new PhoenixPerpExecutor();
  }
  return new PaperExecutor();
}
