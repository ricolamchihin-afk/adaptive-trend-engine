# Adaptive Trend Engine

A single-book **BTC trend-following** strategy on the 4h timeframe, with an interactive
backtest lab, a dry-run order preview, and Telegram alerts. **Paper / dry-run only** —
there is no exchange write adapter, so nothing can place, cancel, or resize a live order.

## Strategy

Dynamic directional exposure (long / short / flat), driven by:

- **Trend filter:** daily EMA(150) regime gate (longs only above, shorts only below).
- **Entry:** Donchian breakout (34-bar) with an ADX trend and RSI(50/50) momentum gate.
- **Sizing:** ATR volatility position sizing — each trade risks a fixed % of equity
  (default 3%); leverage is a hard cap (20x) that the sizing rarely reaches.
- **Exit:** fast Donchian trailing stop (5-bar) + initial 3×ATR stop; winners run.
- **Take-profit:** dynamic, scaled by trend strength — `TP% = 1.0 × ADX` at entry
  (clamped 10–60%). Stronger trends get a larger target.

Optional, tunable in the lab: ADX threshold, RSI bounds, MACD-histogram filter,
EMA-slope filter, fixed take-profit.

## Backtest results (public Hyperliquid 4h candles)

Default config, validated 1/2/3 years and statistically significant (p<0.05) on 2y/3y:

| Window | CAGR | Sharpe | Sortino | Max DD |
| --- | --- | --- | --- | --- |
| 1Y | ~26% | 1.37 | 2.33 | ~11% |
| 2Y | ~49% | 2.05 | 3.57 | ~12% |
| 3Y | ~29% | 1.34 | 2.26 | ~23% |

Aggressive profile (risk 8% + dynamic ADX take-profit): ~137–172% CAGR at Sharpe ~2.3
and ~29% drawdown, with several +20%+ months — higher return for materially higher risk.
Past backtest performance is not a guarantee of live results.

## Run locally

```bash
npm install
npm test
npm run dev     # console on http://127.0.0.1:43871
```

Endpoints: `/api/snapshot` (live BTC signal + position), `/api/signal?symbol=AAPL`
(LONG/SHORT/FLAT + Grok playbook slice), `/api/playbook` (full indicator rules for a Grok
bot), `/api/universe` (Aster stock/crypto classification), `/api/screen` (every Aster
equity perp → one screening JSON), `/api/extract` (Yahoo daily dump
into `data/us-equity/`), `/api/backtest?symbol=AAPL&years=N&...` (tunable backtest),
`/api/sweep` (parameter sensitivity), `/api/dry-run` (order preview + Telegram),
`/api/connections` (health), `/api/go-live` (readiness checklist), `/api/health`.

## Aster preps + Grok bot

Same gates as the backtest: daily EMA(150) regime, Donchian 34/5, RSI 50/50, ATR sizing.

- **Crypto** (`BTC`, `ETH`, …): read Binance (or Binance.US), then Hyperliquid, then Aster.
- **US stocks / ETFs** (`AAPL`, `NVDA`, `QQQ`, …): read Yahoo cash daily + 1h (resampled to
  4h). Aster is the execution venue only.
- **Output:** paper `LONG` / `SHORT` / `FLAT`. There is still no Aster write adapter.

`GET /api/playbook` is the training document: indicator list, entry/exit text, output
contract, and a system prompt. AWS is not required — 20 names × 5y daily is kilobytes from
Yahoo ($0). A full US 1-minute SIP dump on S3 would be ~$1–5/month storage; paid tape is
tens to hundreds per month. Skip both unless you need official consolidated prints.

PyCharm / Windows: run `scripts/Screen-AsterEquityPerps.ps1` (working directory = repo
root). It pulls every TRADING Aster STOCK/ETF perp as the population and writes
`data/us-equity/aster-equity-screen.json`. If `npm run dev` is up it uses the engine
(`GET /api/screen`); otherwise it screens Yahoo/Aster candles in PowerShell.

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
