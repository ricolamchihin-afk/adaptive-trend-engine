# Smart Grid — Read This First

Operating and research handoff for the Phase 7.9 Conservative LONG readiness
console. Intended for Codex, Claude, or another engineer taking over.

Last verified: **2026-08-23**.

## Executive status

The user selected **Phase 7.8.2 Conservative LONG** as the sole candidate for a
future live deployment. This repository freezes that candidate, continues paper
observation on public closed candles, and ships a **disabled** production
boundary.

Selection does not constitute live authorization.

- Original Classic Grid source was not copied here and must not be modified.
- Phase 7.3.2 / 7.6.1 / 7.8 / 7.8.1 / 7.8.2 ledgers are not present and must
  not be invented or merged.
- Conservative LONG is the selected production candidate.
- Moderate and Aggressive are exposure/leverage sensitivity arms, not independent
  alpha ideas and not live candidates.
- No component can place, cancel, resize, or close an exchange order.
- `live_actions_enabled` is a compile-time false constant.

## What this epoch does

Phase 7.9 walks already-closed one-minute BTC candles from the public
Hyperliquid `candleSnapshot` feed. It does not manufacture fills on unclosed
bars. Higher-timeframe decisions use a candle only when
`available_at = open + interval <= decision_time`.

When the daily/4h hierarchy is eligible and LONG, all three mandates deploy
positive long exposure. Only loss of the LONG thesis, data ineligibility, a
hard conflict/transition/safety event, a liquidation-buffer breach, or the
paper kill switch can flatten a mandate. Opening shorts are prohibited.

| Mandate | Target while LONG | Leverage | Buffer floor | Role |
|---|---|---:|---:|---|
| Conservative | 25% floor → 100% as extension falls | 10x | 40% | Selected candidate |
| Moderate | 50% floor → 100% | 15x | 25% | Research benchmark |
| Aggressive | 75% floor → 100% | 20x | 15% | Research benchmark |

Shared frozen controls: 20% margin allocation, 80 grid levels, fixed ±5% range,
aggressive persistent replenishment, 4% flat-only re-anchor, placeholder venue
fee schedules, zero funding P&L, closed-candle timing, both low-first and
high-first paths.

The 10x label applies to **deployed margin**, not total collateral. Research
books remain USD 800 × 5 venues = USD 4,000. Maximum Conservative notional is
approximately USD 1,600 per venue / USD 8,000 aggregate.

## Live-readiness status: selected, not cleared

Open blockers are unchanged:

1. Fewer than 20 independent closed-candle LONG transitions.
2. Funding is still a zero placeholder even when a native rate is displayed.
3. The five live venue/account identities are unconfirmed.
4. There is no enabled exchange-write adapter.
5. Tick/lot/min-notional, restart recovery and venue-native mark/liq schedules
   are not verified against live accounts.
6. Hard operational limits are drafts, not approvals.
7. No canary capital or duration has been authorized.

## Coding standard

Cursor agents in this folder follow Ponytail (lazy senior, not careless).
Read `.cursor/rules/ponytail.mdc` before adding files. Do not vendor unused
agent adapters. Do not rebuild a working paper engine to look simpler.

## Safety rules

1. Do not enable live exchange writes or require API keys.
2. Do not add a credential or order-placement module.
3. Do not switch `live_actions_enabled` to true.
4. Do not brute-force TP/SL, grid width, leverage, or indicator thresholds.
5. Do not describe inventory mark-to-market as grid harvest.
6. Do not claim live readiness while any promotion gate fails.
7. Do not treat this epoch as a continuation of Phase 7.8.2 state.

## Operating commands

```bash
npm test
npm run dev
```

Inspect:

- `GET /api/health`
- `GET /api/snapshot`
- `data/phase7_9_readiness/heartbeat.json` after the first snapshot

There is intentionally no live-start command.

## Immediate next step

Continue collecting Conservative evidence and confirm the five live accounts
before any production connection:

- current exposure versus target and deployment gap
- staged market allocation under each 15m pace
- target increases when extension falls
- long-to-non-long flatten
- after-cost P&L and inventory attribution under both paths
- no-short, exposure-cap and buffer invariants
- independent LONG-transition count and paper duration
- operator-confirmed venue identities and reported free collateral

Do not optimize the frozen controls while this sample accumulates.
