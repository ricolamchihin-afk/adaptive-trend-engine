import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { planAutoTick, tpPrice, trailStop, type AutoBook } from "./autoLoop";
import { planDryRun } from "./dryrun";
import { getExecutor } from "./executor";
import { liveConfig, liveEquityUsd } from "./liveConfig";
import { sendTelegram } from "./notify";
import { PhoenixPerpExecutor } from "./phoenixExecutor";
import { getSnapshot, isPaperKilled, setPaperKill } from "./runtime";
import { STRATEGY } from "./spec";
import { defaultSimConfig } from "./simulate";

const STATE_PATH = path.join(process.cwd(), "data", "auto-loop-state.json");
const TICK_MS = 60_000;
const ReduceOnlyClose = true;

export interface AutoLoopStatus {
  running: boolean;
  autoEnabled: boolean;
  canTrade: boolean;
  killed: boolean;
  lastHandledBarMs: number | null;
  book: AutoBook | null;
  lastTick: {
    at: string;
    action: string;
    reason: string;
    submitted: boolean;
    message: string;
  } | null;
}

interface Persisted {
  killed: boolean;
  lastHandledBarMs: number | null;
  book: AutoBook | null;
  lastTick: AutoLoopStatus["lastTick"];
}

const g = globalThis as typeof globalThis & {
  __ateAutoLoop?: { started: boolean; ticking: boolean; persist: Persisted };
};

function bag(): { started: boolean; ticking: boolean; persist: Persisted } {
  if (!g.__ateAutoLoop) {
    g.__ateAutoLoop = {
      started: false,
      ticking: false,
      persist: { killed: false, lastHandledBarMs: null, book: null, lastTick: null },
    };
  }
  return g.__ateAutoLoop;
}

async function loadPersist(): Promise<void> {
  const b = bag();
  try {
    const raw = await readFile(STATE_PATH, "utf8");
    const parsed = JSON.parse(raw) as Persisted;
    b.persist = {
      killed: Boolean(parsed.killed),
      lastHandledBarMs: typeof parsed.lastHandledBarMs === "number" ? parsed.lastHandledBarMs : null,
      book: parsed.book ?? null,
      lastTick: parsed.lastTick ?? null,
    };
    if (b.persist.killed) setPaperKill(true);
  } catch {
    // first boot
  }
}

async function savePersist(): Promise<void> {
  const b = bag();
  await mkdir(path.dirname(STATE_PATH), { recursive: true });
  await writeFile(STATE_PATH, JSON.stringify(b.persist, null, 2));
}

export function autoLoopStatus(): AutoLoopStatus {
  const b = bag();
  const cfg = liveConfig();
  const executor = getExecutor(cfg);
  return {
    running: b.started,
    autoEnabled: cfg.auto4h,
    canTrade: executor.canTrade,
    killed: b.persist.killed || isPaperKilled(),
    lastHandledBarMs: b.persist.lastHandledBarMs,
    book: b.persist.book,
    lastTick: b.persist.lastTick,
  };
}

function formatAutoTelegram(action: string, reason: string, mark: number, submitted: boolean, message: string): string {
  return [
    "[AUTO 4h] Adaptive Trend Engine",
    `BTC mark: $${Math.round(mark).toLocaleString("en-US")}`,
    `Action: ${action}  |  ${reason}`,
    `Submitted: ${submitted}`,
    message,
  ].join("\n");
}

export async function tickAutoLoop(): Promise<AutoLoopStatus> {
  const b = bag();
  if (b.ticking) return autoLoopStatus();
  b.ticking = true;
  try {
    const cfg = liveConfig();
    const executor = getExecutor(cfg);
    const snapshot = await getSnapshot();
    const last = snapshot.position.bar;
    const mark = snapshot.market.mark;
    if (!last || mark <= 0) {
      b.persist.lastTick = {
        at: new Date().toISOString(),
        action: "HOLD",
        reason: "No closed 4h bar / mark.",
        submitted: false,
        message: "",
      };
      await savePersist();
      return autoLoopStatus();
    }

    const funded = await new PhoenixPerpExecutor().accountState().catch(() => ({
      ok: false as const,
      collateralUsd: undefined,
      position: { side: "FLAT" as const, sizeBtc: 0, entryUsd: null },
    }));
    const phoenix = funded.position ?? { side: "FLAT" as const, sizeBtc: 0, entryUsd: null };
    const equityUsd = liveEquityUsd(cfg.capitalUsd, funded.collateralUsd);
    const simCfg = defaultSimConfig();

    const book = b.persist.book;
    const liveSide = phoenix.side === "FLAT" ? book?.side ?? "FLAT" : phoenix.side;
    let stop: number | null = book?.stop ?? null;
    if (liveSide === "LONG" || liveSide === "SHORT") {
      const initial =
        stop ??
        (phoenix.entryUsd && snapshot.position.atr > 0
          ? liveSide === "LONG"
            ? phoenix.entryUsd - STRATEGY.atrStopMult * snapshot.position.atr
            : phoenix.entryUsd + STRATEGY.atrStopMult * snapshot.position.atr
          : snapshot.position.stopPrice);
      stop = trailStop(liveSide, initial, snapshot.position.exitLow, snapshot.position.exitHigh);
    }

    const sizeForTp = Math.abs(phoenix.sizeBtc) || book?.sizeBtc || 0;
    const entry = book?.entry ?? phoenix.entryUsd ?? mark;
    const adx = snapshot.position.adx ?? 0;
    const roe =
      simCfg.tpAdxFactor > 0
        ? Math.min(simCfg.tpMaxRoePct, Math.max(simCfg.tpMinRoePct, simCfg.tpAdxFactor * adx))
        : simCfg.takeProfitRoePct;
    const tp =
      book?.tp ??
      (liveSide === "LONG" || liveSide === "SHORT"
        ? tpPrice(liveSide, entry, sizeForTp, equityUsd, roe)
        : null);

    const openPlan = planDryRun(
      { side: snapshot.position.side, sizeBtc: snapshot.position.sizeBtc, stopPrice: snapshot.position.stopPrice },
      mark,
      cfg,
      STRATEGY.capitalUsd,
      {
        equityUsd,
        atr: snapshot.position.atr,
        atrStopMult: STRATEGY.atrStopMult,
        freshEntry: snapshot.position.freshEntry,
        paperSide: snapshot.position.paperSide,
      },
    );

    const openTp =
      (snapshot.position.paperSide === "LONG" || snapshot.position.paperSide === "SHORT") &&
      openPlan.sizeBtc !== 0
        ? tpPrice(
            snapshot.position.paperSide,
            mark,
            Math.abs(openPlan.sizeBtc),
            equityUsd,
            roe,
          )
        : null;

    const planned = planAutoTick({
      killed: b.persist.killed || isPaperKilled(),
      autoEnabled: cfg.auto4h,
      canTrade: executor.canTrade,
      lastHandledBarMs: b.persist.lastHandledBarMs,
      barOpenMs: last.openTime,
      mark,
      bar: { open: last.open, high: last.high, low: last.low, close: last.close },
      phoenixSide: phoenix.side,
      phoenixSizeBtc: phoenix.sizeBtc || book?.sizeBtc || 0,
      book,
      stop,
      tp: phoenix.side === "FLAT" ? openTp : tp,
      freshEntry: snapshot.position.freshEntry,
      signalSide: snapshot.position.paperSide,
      openSizeBtc: openPlan.sizeBtc,
      openStop: openPlan.stopPrice,
    });

    let submitted = false;
    let message = planned.reason;
    if (planned.action === "CLOSE" && planned.closeSizeBtc > 0 && planned.closeSide !== "FLAT") {
      const closeSide = planned.closeSide === "LONG" ? "SHORT" : "LONG";
      const execution = await executor.submit({
        action: "CLOSE",
        side: closeSide,
        sizeBtc: planned.closeSizeBtc,
        notionalUsd: planned.closeSizeBtc * mark,
        price: mark,
        reduceOnly: ReduceOnlyClose,
      });
      submitted = execution.submitted;
      message = execution.message;
    } else if (planned.action === "OPEN_LONG" || planned.action === "OPEN_SHORT") {
      const execution = await executor.submit({
        action: planned.action,
        side: planned.action === "OPEN_SHORT" ? "SHORT" : "LONG",
        sizeBtc: openPlan.sizeBtc,
        notionalUsd: openPlan.notionalUsd,
        price: mark,
      });
      submitted = execution.submitted;
      message = execution.message;
    }

    b.persist.lastHandledBarMs = planned.lastHandledBarMs;
    b.persist.book = planned.book;
    if (planned.action === "HOLD" && (phoenix.side === "LONG" || phoenix.side === "SHORT") && stop !== null) {
      const held = b.persist.book ?? {
        side: phoenix.side,
        sizeBtc: Math.abs(phoenix.sizeBtc) || book?.sizeBtc || 0,
        entry,
        stop,
        tp,
        openedBarMs: last.openTime,
      };
      held.stop = stop;
      if (held.tp === null) held.tp = tp;
      b.persist.book = held;
    }
    if (planned.action === "CLOSE") b.persist.book = null;

    b.persist.lastTick = {
      at: new Date().toISOString(),
      action: planned.action,
      reason: planned.reason,
      submitted,
      message,
    };
    await savePersist();

    if (planned.action !== "HOLD") {
      await sendTelegram(formatAutoTelegram(planned.action, planned.reason, mark, submitted, message));
    }
    return autoLoopStatus();
  } finally {
    b.ticking = false;
  }
}

export async function killLive(): Promise<AutoLoopStatus> {
  const b = bag();
  b.persist.killed = true;
  setPaperKill(true);
  await savePersist();
  return tickAutoLoop();
}

export function startAutoLoop(): void {
  const b = bag();
  if (b.started) return;
  b.started = true;
  void loadPersist().then(() => {
    setTimeout(() => void tickAutoLoop(), 8_000);
    setInterval(() => void tickAutoLoop(), TICK_MS);
  });
}
