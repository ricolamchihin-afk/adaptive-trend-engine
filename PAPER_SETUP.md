# Decibel paper portfolio setup

Isolated from live Phoenix BTC. Launch a **new** Cloud Agent on this branch. Do not check this branch out on the live go-live agent.

This book is a **portfolio** (ETH + BNB + equity perps) intended for **Decibel** (Aptos). It is not a Phoenix strategy.

## Names (use these exactly)

| What | Name |
| --- | --- |
| Live agent (leave it alone) | Phoenix adapter / go-live on `cursor/go-live-dynamic-921b` |
| New paper agent | `Adaptive Trend paper — Decibel portfolio` |
| Paper branch | `cursor/multi-asset-paper-921b` |
| Repo | `ricolamchihin-afk/adaptive-trend-engine` |
| Paper Cloud environment (optional hard wall) | `adaptive-trend-decibel-paper` |
| Target venue | Decibel (Aptos perps) — `https://docs.decibel.trade` |
| Paper lab tab | **Decibel portfolio** |
| Paper API | `GET /api/paper-lab?years=1` |

## Launch the paper agent

1. In Cursor Cloud, start a **new** agent. Do not reuse the live Phoenix run.
2. Agent name: `Adaptive Trend paper — Decibel portfolio`
3. Repository: `ricolamchihin-afk/adaptive-trend-engine`
4. Branch / ref: `cursor/multi-asset-paper-921b`
5. Environment: a **new** environment named `adaptive-trend-decibel-paper` (preferred), or the existing Cloud env **with Phoenix secrets removed**.
6. Secrets on the paper agent:
   - `PAPER_ONLY=true`
   - `LIVE_TRADING_ENABLED=false`
   - `EXCHANGE=decibel`
   - **Do not set** `PHOENIX_PRIVATE_KEY`, `PHOENIX_KEYPAIR_PATH`, or `PHOENIX_ADAPTER_VERIFIED=true`
   - Do **not** attach Decibel API wallet / Geomi keys yet — this pass is paper Sharpe only
   - Market data is public Hyperliquid (long 4h history). Decibel listing check comes after Sharpe looks acceptable.
7. Prompt the paper agent: `Run GET /api/paper-lab?years=1 and report the Decibel portfolio Sharpe (all / crypto sleeve / equity sleeve). Individual names are contribution only.`

## Portfolio

Equal-dollar overlay: each candidate name gets $1000. A name that is not listed yet sits in cash. BTC is **not** in this book (Phoenix live standalone).

| Sleeve | Symbols | In portfolio? |
| --- | --- | --- |
| Crypto | ETH, BNB | yes |
| Equity | TSLA, NVDA, AAPL, MSFT, GOOGL, AMZN, META, SP500 | yes |
| Reference | BTC | no |

Same Turtle defaults as live BTC (EMA150, Donchian 34/5, ATR 3, 3% risk, 20x cap) for the first look. Equities may need their own params later.

Research feed: public Hyperliquid 4h (core perps + HIP-3 `xyz:TICKER`). Intended live venue: Decibel. Confirm Decibel lists these names before any live wiring (Geomi bearer required on `GET /api/v1/markets`).

## How to read Sharpe

- Headline = **Decibel portfolio** Sharpe (combined equity path).
- Crypto sleeve and equity sleeve are sub-portfolios, not names to add together.
- Per-name rows are contribution / diagnostics. Do not add those Sharpes.
- SP500 has ~5 months of HL candles, so EMA150 may never fire; it sits in cash.

## Local

```bash
# on cursor/multi-asset-paper-921b
cp .env.example .env.local   # PAPER_ONLY=true, EXCHANGE=decibel, live flags false
# do not copy the live Phoenix signer
npm test
npm run dev                  # http://127.0.0.1:43871 → Decibel portfolio → Run 1y portfolio Sharpe
```
