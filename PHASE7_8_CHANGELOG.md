# Phase 7.8 / 7.9 changelog

## 2026-08-23 — Phase 7.9 Conservative LONG production boundary

This repository is a new readiness epoch. It does not contain the original
Windows Classic Grid tree and does not resume Phase 7.8.2 ledgers.

Added:

- Frozen, SHA-256 hashed Conservative LONG candidate specification.
- Disabled production boundary (`live_actions_enabled = false`, no write adapter).
- Dry-run intent ledger with idempotent client-order IDs.
- Read-only Hyperliquid public candle feed and paper walk-forward.
- Three-mandate register: Conservative selected; Moderate and Aggressive remain
  exposure/leverage benchmarks.
- Promotion-gate panel that still holds for live clearance.
- Operator venue registry that rejects credential fields.
- Paper-only kill switch.

Not added, by design:

- Exchange credentials, signing, or order placement.
- A canary write path.
- Merging of Phase 7.3.2 / 7.6.1 / 7.8.x state.
- Parameter optimization of the frozen controls.

## Prior epochs (reference only)

Phase 7.8.2 Conservative LONG remains the selected production candidate
described in the 2026-08-21 HKT handoff. This repo prepares that candidate; it
does not authorize live trading.
