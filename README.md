# Adaptive Trend Engine

A single-book **BTC trend-following** strategy on the 4h timeframe, with an interactive
backtest lab, a dry-run order preview, and Telegram alerts. **Paper / dry-run only** —
there is no exchange write adapter, so nothing can place, cancel, or resize a live order.

## Strategy

Dynamic directional exposure (long / short / flat), driven by:

- **Trend filter:** daily EMA(150) regime gate (longs only above, shorts only below).
- **Entry:** Donchian breakout (55-bar) with an RSI(50/50) momentum gate.
- **Sizing:** ATR volatility position sizing — each trade risks 10% of equity;
  leverage is a hard cap (20x). Typical effective leverage is ~4x, not 20x.
- **Exit:** Donchian trailing stop (7-bar) + initial 2×ATR stop; winners run.
- **Take-profit:** dynamic, `TP% = 1.2 × ADX` at entry (clamped 10–60%).

Optional, tunable in the lab: ADX threshold, RSI bounds, MACD-histogram filter,
EMA-slope filter, fixed take-profit.

## Backtest results (public Hyperliquid 4h candles)

Live mix (Donchian 55/7, risk 10%, ATR 2×, TP×ADX 1.2, RSI 50/50), ~2.28y to 2026-08-24:

| Window | Return | Sharpe | Sortino | Max DD | Trades / mo |
| --- | --- | --- | --- | --- | --- |
| ~2.28y | ~15.5x | 1.89 | 3.21 | ~38% | ~3.5 |

Past backtest performance is not a guarantee of live results. Live size is
`min($2000 capital, Phoenix collateral)` so a deposit to ~$2000 is used; extra
above $2000 still sits as buffer until capital is raised again.

## Run locally

```bash
npm install
npm test
npm run dev     # console on http://127.0.0.1:43871
```

Endpoints: `/api/snapshot` (live signal + position), `/api/backtest?years=N&...` (tunable
backtest), `/api/sweep` (parameter sensitivity), `/api/dry-run` (order preview + Telegram),
`/api/connections` (health), `/api/go-live` (readiness checklist), `/api/health`.

## Configuration

Copy `.env.example` to `.env` and edit. `.env` is git-ignored — never commit secrets.
The strategy parameters, risk limits, exchange/wallet placeholders, and the
`TELEGRAM_*` alert settings live there. `DRY_RUN=true` and `LIVE_TRADING_ENABLED=false`
by default.

## Going live

The console is dry-run only. Real order submission requires a **vetted, testnet-verified
exchange write adapter** implementing the `Executor` interface, plus a funded wallet and
the hard risk limits enforced. The **Go-live** tab / `/api/go-live` shows a readiness
checklist; the final adapter + testnet test is a deliberate, separate step.

## Safety

- `live_actions_enabled` is false and there is no write adapter — the app cannot trade.
- Never commit API keys / signing keys; use `.env` (git-ignored) or a secrets manager.
- Validate any live integration on testnet / minimal size before real funds.
