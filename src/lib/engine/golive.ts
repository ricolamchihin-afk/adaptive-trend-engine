import { getExecutor } from "./executor";
import type { LiveConfig } from "./liveConfig";
import { phoenixEnv, phoenixHasSigner } from "./phoenixExecutor";

export interface ReadinessItem {
  id: string;
  label: string;
  ok: boolean;
  detail: string;
  blocking: boolean;
}

export interface GoLiveReadiness {
  ready: boolean;
  mode: "dry_run" | "live";
  executor: string;
  items: ReadinessItem[];
  blockers: string[];
}

// Honest go-live checklist. Everything is stageable except the two hard gates that
// must not be faked: a testnet-verified write adapter, and a funded wallet.
export function goLiveReadiness(
  cfg: LiveConfig,
  ctx: { marketOk: boolean; telegramOk: boolean },
): GoLiveReadiness {
  const executor = getExecutor(cfg);
  const phoenix = phoenixEnv();
  const signerPresent = phoenixHasSigner() || Boolean(process.env.PHOENIX_AUTHORITY);

  const items: ReadinessItem[] = [
    {
      id: "strategy",
      label: "Strategy backtested & validated",
      ok: true,
      detail: "1/2/3-year backtests; significant (p<0.05) on 2y/3y.",
      blocking: false,
    },
    {
      id: "market",
      label: "Market data feed connected",
      ok: ctx.marketOk,
      detail: ctx.marketOk ? "Hyperliquid public feed live." : "Feed unavailable.",
      blocking: true,
    },
    {
      id: "env",
      label: "Config loaded from .env",
      ok: true,
      detail: `Capital $${cfg.capitalUsd}, ${cfg.maxLeverage}x cap, risk ${(cfg.riskPct * 100).toFixed(1)}%.`,
      blocking: false,
    },
    {
      id: "risk",
      label: "Hard risk limits set",
      ok: cfg.maxNotionalUsd > 0 && cfg.dailyLossLimitUsd > 0,
      detail: `Max notional $${cfg.maxNotionalUsd || 0}, daily loss $${cfg.dailyLossLimitUsd || 0}, max DD ${cfg.maxDrawdownPct || 0}%.`,
      blocking: true,
    },
    {
      id: "creds",
      label: "Exchange credentials present",
      ok: signerPresent,
      detail: signerPresent ? "API key / signer detected in .env." : "Missing API key or signer.",
      blocking: true,
    },
    {
      id: "alerts",
      label: "Telegram alerts configured",
      ok: ctx.telegramOk,
      detail: ctx.telegramOk ? "Bot reachable." : "Not configured (optional).",
      blocking: false,
    },
    {
      id: "adapter",
      label: "Exchange write adapter implemented (Phoenix Rise SDK)",
      ok: executor.name === "phoenix-perp",
      detail:
        executor.name === "phoenix-perp"
          ? "Phoenix Perpetuals adapter wired (build/sign/send via @ellipsis-labs/rise)."
          : "Phoenix not configured (set PHOENIX_API_URL, SOLANA_RPC_URL, PHOENIX_AUTHORITY).",
      blocking: true,
    },
    {
      id: "verified",
      label: "Adapter testnet-verified (PHOENIX_ADAPTER_VERIFIED)",
      ok: phoenix.verified,
      detail: phoenix.verified
        ? "Marked verified — order submission is enabled."
        : "Not verified. Prove the adapter on testnet with tiny size, then set PHOENIX_ADAPTER_VERIFIED=true.",
      blocking: true,
    },
    {
      id: "rpc",
      label: "Solana RPC endpoint configured",
      ok: Boolean(phoenix.rpcUrl),
      detail: phoenix.rpcUrl ? "Solana RPC set." : "Set PHOENIX_SOLANA_RPC (or SOLANA_RPC_URL).",
      blocking: true,
    },
    {
      id: "funded",
      label: "Wallet funded (collateral on Phoenix)",
      ok: false,
      detail: "Verify collateral via the Phoenix adapter's account read before enabling; keep unfunded until testnet passes.",
      blocking: true,
    },
    {
      id: "flag",
      label: "LIVE_TRADING_ENABLED",
      ok: cfg.liveTradingEnabled,
      detail: cfg.liveTradingEnabled ? "Live flag ON." : "Live flag off (safe default).",
      blocking: false,
    },
  ];

  const blockers = items.filter((i) => i.blocking && !i.ok).map((i) => i.label);
  return {
    ready: blockers.length === 0,
    mode: executor.canTrade && cfg.liveTradingEnabled ? "live" : "dry_run",
    executor: executor.name,
    items,
    blockers,
  };
}
