# Smart Grid: Conservative LONG readiness

Phase 7.9 production-preparation console for the **Conservative LONG** candidate
selected on 2026-08-21 HKT. This is a paper observation and disabled production
boundary. It is **not** live authorization.

GitHub (private): https://github.com/ricolamchihin-afk/smart-grid-conservative-readiness

## Open in VS Code

The clone can succeed and `code` can still fail. That only means the `code`
command is not on PATH. Do not paste `copilot-debug` or any text with `<`.

1. Open the Start menu.
2. Type Visual Studio Code and open it. Install it from
   https://code.visualstudio.com/ if Windows cannot find it.
3. File: Open Folder: `C:\\Users\\user\\Cursor`.
4. In the VS Code terminal, run `npm install`, then `npm test`, then
   `npm run dev`.

Full steps: [VSCODE.md](VSCODE.md).

If you still want a fresh clone, run these as two separate lines:

```powershell
cd C:\\Users\\user
```

```powershell
git clone https://github.com/ricolamchihin-afk/smart-grid-conservative-readiness.git Cursor
```

The original Classic Grid / Phase 7.8.2 Windows tree is not in this repository.
This epoch starts from public closed Hyperliquid BTC candles and does not resume
or overwrite those ledgers.

## What this is

- Frozen Conservative specification: 25% floor to 100% as extension falls, 10x
  on deployed margin, 20% allocation, 40% liquidation-buffer floor.
- Three equal-capital paper mandates (USD 4,000 research reference each).
  Conservative is the only live candidate. Moderate and Aggressive are
  leverage/exposure benchmarks.
- Bloomberg-inspired hierarchy: daily/4h direction, continuous extension
  sizing, 15m pace only, hard halt on conflict/transition/tail/gap.
- Dry-run intents that are never sent. `live_actions_enabled` is hardcoded
  false. There is no exchange-write adapter and no credential import.
- Read-only public market data from Hyperliquid `candleSnapshot`.

## What this is not

- A go-live switch.
- A continuation of the Phase 7.3.2 paper broker files.
- An optimizer for TP/SL, grid width, leverage, or indicator thresholds.

## Run locally

```bash
npm install
npm test
npm run dev
```

The console listens on [http://127.0.0.1:43871](http://127.0.0.1:43871).

Endpoints:

| Method | Path | Purpose |
|---|---|
| GET | `/` | Readiness console |
| GET | `/api/snapshot` | Paper state, hierarchy, gates, intents |
| GET | `/api/health` | Liveness; always reports writes disabled |
| POST | `/api/venues` | Operator-entered venue labels only |
| POST | `/api/kill` | Paper flatten only |
| POST/PUT/PATCH | `/api/health` | 405 |

## Promotion status

**CONSERVATIVE LONG SELECTED / HOLD FOR LIVE CLEARANCE.**

The nine fixed gates from the 2026-08-21 handoff still apply. A short
correlated LONG sample, a positive inventory mark, or a green smoke test is
not institutional evidence.

## Safety

Do not enable live writes from this tree. Do not paste API keys into the venue
form. Do not treat the USD 4,000 research books as approved canary capital.

## Ponytail

Cursor follows [Ponytail](https://github.com/DietrichGebert/ponytail) from
`.cursor/rules/ponytail.mdc`: write only what the task needs, reuse what is
already here, and never cut validation, safety, or the frozen Conservative
controls. The other 19 agent adapters from that repo were not copied.
