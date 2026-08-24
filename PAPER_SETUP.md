# Paper multi-asset setup

Isolated from live BTC. Launch a **new** Cloud Agent on this branch. Do not check this branch out on the live go-live agent.

## Names (use these exactly)

| What | Name |
| --- | --- |
| Live agent (leave it alone) | Phoenix adapter / go-live on `cursor/go-live-dynamic-921b` |
| New paper agent | `Adaptive Trend paper — ETH BNB equities` |
| Paper branch | `cursor/multi-asset-paper-921b` |
| Repo | `ricolamchihin-afk/adaptive-trend-engine` |
| Paper Cloud environment (optional hard wall) | `adaptive-trend-paper` |
| Paper lab tab | **Paper books** |
| Paper API | `GET /api/paper-lab?years=1` |

## Launch the paper agent

1. In Cursor Cloud, start a **new** agent. Do not reuse the live go-live run.
2. Agent name: `Adaptive Trend paper — ETH BNB equities`
3. Repository: `ricolamchihin-afk/adaptive-trend-engine`
4. Branch / ref: `cursor/multi-asset-paper-921b`
5. Environment: either a **new** environment named `adaptive-trend-paper`, or the existing Cloud env **with live secrets removed**.
6. Secrets on the paper agent:
   - `PAPER_ONLY=true`
   - `LIVE_TRADING_ENABLED=false`
   - `PHOENIX_ADAPTER_VERIFIED=false`
   - **Do not set** `PHOENIX_PRIVATE_KEY` or `PHOENIX_KEYPAIR_PATH`
   - Market data is public Hyperliquid; no Phoenix signer is required
7. Prompt the paper agent: `Run the Paper books lab (GET /api/paper-lab?years=1) and report Sharpe / CAGR / max DD per book.`

## Books

Same Turtle defaults as live BTC (EMA150, Donchian 34/5, ATR 3, 3% risk, 20x cap). Independent $1000 paper books.

| Sleeve | Symbols | Feed |
| --- | --- | --- |
| Crypto (reference) | BTC | Core HL perp. Live book — do not trade from this agent. |
| Crypto (candidates) | ETH, BNB | Core HL perps |
| Equity (candidates) | TSLA, NVDA, AAPL, MSFT, GOOGL, AMZN, META, SP500 | HIP-3 `xyz:TICKER` (trade.xyz) |

Equity history on HL starts ~Nov 2025 (SP500 ~Mar 2026). Short windows make Sharpe noisy.

## How to read Sharpe

- Report **per book**. Do not add Sharpes.
- BTC + ETH + BNB are highly correlated. 3% risk × 3 names is not 3% portfolio risk.
- Equities are the real diversifier and a **different venue** than Phoenix BTC.
- Combined-book / one-collateral overlay comes after individual Sharpes look acceptable.

## Local

```bash
# on cursor/multi-asset-paper-921b
cp .env.example .env.local   # already PAPER_ONLY=true, live flags false
# do not copy the live Phoenix signer
npm test
npm run dev                  # http://127.0.0.1:43871 → Paper books → Run 1y Sharpe
```
