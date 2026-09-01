# AI-Trader, studied for this paper Aster book

**Paper only.** Advise only. Principal clicks. This pack does not place, cancel,
modify, or withdraw orders. It does not register on [ai4trade.ai](https://ai4trade.ai).
It does not enable Binance, Coinbase, IB, Aster live, or copy-trade execution.

Studied read-only from [HKUDS/AI-Trader](https://github.com/HKUDS/AI-Trader) at
`d03ff6c` (2026-06-11). Companion [HKUDS/Vibe-Trading](https://github.com/HKUDS/Vibe-Trading)
was skimmed for broker-adapter noise only. Nothing was pushed to those repos.

This book is already defined. Do not invent a new edge.

| Piece | Rule |
| --- | --- |
| Signal | US cash print when Yahoo answers. Aster public klines are the working tape today (Yahoo 429). |
| Venue | Matching Aster USDT STOCK/ETF perp. Never the cash share. |
| Gates | Daily EMA150 `dailyDir`, Donchian 34, RSI 14/50, ATR 14 × 3 stop. ADX / MACD / slope computed, off. |
| ENTER | Only when the **closed 4h snapshot** already says `ENTER_*`. Do not promote `WAIT`. |
| Overlay | $10,000 USDC, $100 stop-risk, TP 1.5R / 2R **in price**, 20× cap rescale. No sized card on `WAIT`. |
| CIO | Gertrude reads `cio-brief.json` every 4h. Snapshot, not a stream. |

The Aster screen, `evaluateSetup`, and 4h mission live on
`cursor/aster-equity-signals-98c0` ([PR #7](https://github.com/ricolamchihin-afk/adaptive-trend-engine/pull/7)).
This pack does not change those files.

---

## Verdict

**Steal research quality. Do not steal their trading surface.**

The hypothesis holds:

- **Useful:** experiment keys / variant assignment / a written process log, and
  challenge **mark-to-market** scoring (`return_pct`, `max_drawdown`, optional
  risk-adjusted score, no score if there are no trades).
- **Useful as a pattern, not as a library:** preferred cash print, then a
  documented fallback when that print 429s or is empty. Their fallback is
  `yfinance` (still Yahoo). Ours is already Aster public klines.
- **Not useful for this book:** agent copy-trading, broker sync, marketplace
  registration, discussion/reply “debate,” team contribution scores, or treating
  a leaderboard as permission to enter.

This book is engine-gated. A marketplace signal is not an `ENTER`.

---

## (a) What to steal for research quality

### 1. Named experiment + frozen enrollment + a process log

AI-Trader does not “try stuff.” They freeze a cohort, name variants, dry-run
notifications, then write every step in a table.

- `service/server/experiments.py` — `DEFAULT_VARIANTS` is `control` / `treatment`
  with weights; `experiment_config` freezes `enrollment_max_unit_id`,
  `enrollment_closed_at`, `enrollment_status`. Assignment is hashed and stable.
- `research/experiment_process_log.md` — experiment key
  `agent-collab-compete-season-001`, fixed cohort `agent_id <= 5289`, dry-run
  before any send, then a dated step table (action, scope, result, decision).
- `research/README.md` + `research/scripts/analyze_experiments.py` — export
  CSVs, then A/B / DiD / bootstrap CI / FDR tables. Primary metric family is
  declared (`EXPERIMENT_PRIMARY_METRIC_FAMILY` in `experiments.py`).
- `service/server/experiment_metrics.py` — windowed snapshots: `return_pct`,
  `max_drawdown`, trade/discussion counts. Collaboration counts are extra; we
  only need the P&L window.

**For this book:** one key, two arms, a written log, no gate edits mid-run.
See [the next experiment](#c-next-experiment-aster-4h-enter-mtm-001).

### 2. Challenge / leaderboard MTM (the scoring math)

`service/server/challenge_scoring.py` is the useful kernel:

- Replay trades in time order. Invalid side / oversell → `disqualified_reason`,
  `final_score = None`.
- Open inventory is marked: long `mark * qty`; short
  `(2 * entry - mark) * abs(qty)` (`_position_value`).
- Live marks append one more equity point (`marked_to_market`, `live_marks`,
  `mark_timestamp`).
- `return_pct = (ending_value - starting_cash) / starting_cash * 100`.
- Peak-to-trough `max_drawdown` on the equity curve.
- `risk_adjusted_score = return_pct - max(0, max_drawdown - allowed) * penalty`
  when `scoring_method == "risk-adjusted"`.
- `rank_scored_results` drops DQ and **zero-trade** rows from the ranking.
- Challenge portfolios are isolated from the $100k paper cash
  (`skills/ai4trade/SKILL.md` “Challenge Competitions”).

`README.md` (2026-06-11) says the Experiment Console uses this same live MTM
for variant leaderboards.

The helper in `src/lib/research/paper-mtm.ts` is that math, sized to **this**
overlay, and it refuses `WAIT`.

### 3. Cash-print fallback pattern (not their Yahoo client)

`service/server/price_fetcher.py` `get_price_from_market`:

- US stock: Alpha Vantage if a real key exists; otherwise, or if AV returns
  nothing, `_get_yfinance_us_stock_price`.
- 429 / 5xx activate a provider cooldown (`_RETRYABLE_STATUS_CODES`,
  `_activate_provider_cooldown`).
- yfinance itself: 1m window first, then daily; last close **at or before**
  `executed_at`; refuse non-positive prices.

Tests in `service/server/tests/test_price_fetcher.py` pin “prefer primary, fall
back when primary is None.”

**Map onto this book (already true on PR #7, do not re-implement as a new edge):**

- Preferred signal: US cash (`fetchYahooBars` in `src/lib/engine/feeds.ts`).
- On 429 / empty / parse miss: Aster `fapi` klines
  (`loadResolvedMarket` in `src/lib/engine/asset-market.ts` on the Aster branch).
- Record `source` (`yahoo_public` vs `aster_public`) on the card. Score MTM on
  the **venue** tape (Aster). Do not invent a third print.

Do **not** add `yfinance`. It is still Yahoo. Yahoo is 429. Aster is the working
tape.

### 4. What their “debate” actually is (context only)

There is no hidden alpha model. “Collective intelligence” is:

- Signal types `strategy` / `discussion` / `operation` (`skills/ai4trade/SKILL.md`).
- Replies + author-accept (`POST /api/signals/{id}/replies/{id}/accept`).
- Team challenge votes `approve` / `reject` / `revise`.
- `service/server/team_scoring.py` — score from message length and self-reported
  confidence, not from fills.
- `service/server/signal_quality.py` — heuristic text quality, `heuristic-v1`.
- `experiment_metrics.py` `build_network_edges` — reply / follow / mention /
  `copied_trade` edges.

Gertrude already has a job: read `cio-brief.json`, rank `ENTER_*` then `WAIT`,
do not invent names. Importing debate would be a second, untested gate.

---

## (b) What we must not import

| AI-Trader surface | Where | Why it is forbidden here |
| --- | --- | --- |
| Agent self-register / login | `skills/ai4trade/SKILL.md`, `docs/README_AGENT.md` | User said do not register on ai4trade.ai. |
| Copy-trade follow + 1:1 position sync | `skills/copytrade/SKILL.md` (`autoCopyPositions`, “New Position → you automatically open”) | This book is engine-gated. A leader’s `position` is not `ENTER`. |
| Trade sync / realtime publish | `skills/tradesync/SKILL.md` (`POST /api/signals/realtime`) | Publishing or mirroring fills is execution-adjacent and not our edge. |
| Marketplace as permission | `docs/README_AGENT.md` “Marketplace - Buy and sell trading signals” | A bought signal does not pass EMA150 / Donchian 34 / RSI 50. |
| Broker sync (Binance, Coinbase, IB) | `README.md` “Already Trading Elsewhere?”, `skills/ai4trade/SKILL.md` Method 1 | User forbade live broker adapters. |
| Vibe-Trading live connectors | Vibe-Trading README: Alpaca / IBKR / OKX / Futu / Binance USD-M, kill-switch flatten | Companion is a live-agent product. Do not vendor it. |
| Challenge **trade** POST | `skills/ai4trade/SKILL.md` `POST /api/challenges/{key}/trade` | That writes a portfolio. We only **score** after the fact. |
| Heartbeat / auto-follow | `skills/heartbeat/SKILL.md`, copytrade `AUTO_FOLLOW_ENABLED` | Would treat platform mail as a trigger. |
| Points → simulated cash | `skills/ai4trade/SKILL.md` 1 point = $1,000 | Not our $10k / $100 overlay. |
| Polymarket paper book | `skills/polymarket/SKILL.md`, `price_fetcher.py` | Different venue, different contract. |

`LIVE_ACTIONS_ENABLED` stays `false`. No new write adapter. No Aster live key.

---

## (c) Next experiment: `aster-4h-enter-mtm-001`

**Question:** On the existing 4h Aster STOCK/ETF screen, what is the paper P&L
of **already-`ENTER_*`** cards if we size them with the current overlay and
mark them on the **next closed 4h Aster bar** — and does tape source
(Yahoo vs Aster-fallback) change that number?

**Not a question:** whether we should loosen RSI, promote `WAIT`, or copy
ai4trade agents.

### Arms

| Variant | What changes | What must not change |
| --- | --- | --- |
| `control` | Score only `ENTER_LONG` / `ENTER_SHORT` from that snapshot. Size $100 stop-risk, 3×ATR stop, TP 1.5R and 2R in price, 20× cap. Mark on the next closed Aster 4h close. | Gates, CIO prompt, universe. |
| `tape_covariate` | Same cards, same marks. Split the report by `source` (`yahoo_public` vs `aster_public`). Not a second entry rule. | Do not prefer a name because Yahoo 429’d. |

No `wait_promoted` arm. Promoting `WAIT` is out of scope and would invent an edge.

### Protocol (principal clicks; agent does not send orders)

1. Run the existing 4h mission (`scripts/Invoke-FourHourMission.ps1` on the Aster
   branch). Keep `cio-brief.json` and `mission-*.json`.
2. Feed the brief into `scoreCioBrief` in `src/lib/research/paper-mtm.ts`
   **after** you have the next closed 4h Aster marks. The helper sizes `ENTER_*`
   only. `WAIT` / `FLAT` produce no card.
3. Log one row per snapshot: `experiment_key`, `fourHourBucket`, `source` mix,
   `enter_count`, `wait_count`, `return_pct`, `max_drawdown`, `final_score`,
   `marked_to_market`.
4. After ≥20 independent 4h buckets, summarize like
   `challenge_scoring.rank_scored_results`: drop buckets with zero ENTERs from
   the rank; keep them in the “how often do we actually enter?” count.
5. Gertrude still only reads the brief. She does not override size or flip
   `WAIT` → `ENTER`.

### Scoring (stolen, then narrowed)

Same fields as `score_agent_trades`: `starting_cash` = 10_000, `ending_value`
from overlay MTM, `return_pct`, `max_drawdown`, `risk_adjusted_score` with
`allowed_drawdown = 100` and `drawdown_penalty = 1` so the default
`final_score` is return-only (their default `return-only`). Perp MTM is
`signedQty * (mark - entry)` added to cash — we do not copy their cash-debit
spot replay.

### Stop conditions (paper)

- A card whose snapshot `action` is not `ENTER_*` is not sized. Period.
- Missing ATR or mark → skip that name, increment `failed`, do not invent.
- If Yahoo is 429, the working tape is Aster. That is a data note, not a gate.

### Why this stays paper-only

The helper never imports `executor`, `phoenixExecutor`, `golive`, or any
AI-Trader skill URL. It never calls `fapi` order endpoints. It never writes
`LIVE_ACTIONS_ENABLED`. CIO copy is unchanged: “Never place, cancel, or resize
an order.”

---

## File map (this pack)

| Path | Role |
| --- | --- |
| `docs/paper-research/AI_TRADER_FOR_THIS_BOOK.md` | This memo. |
| `src/lib/research/paper-mtm.ts` | Overlay size + ENTER-only MTM + tape fallback classifier. |
| `src/lib/research/paper-mtm.test.ts` | The check: WAIT is unsized; 429 → Aster tape; MTM math. |
