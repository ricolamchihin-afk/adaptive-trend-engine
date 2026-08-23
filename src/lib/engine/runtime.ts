import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { loadMarket, type MarketSnapshot } from "./market-data";
import { phoenixLeverageTable, phoenixMakerRoundTripRoePct } from "./leverage";
import { evaluatePromotion } from "./promotion";
import { productionBoundary } from "./production";
import { EPOCH_ID, EPOCH_TITLE, SELECTED_CANDIDATE, SPEC_HASH, VENUES } from "./spec";
import {
  advanceRuntime,
  applyPaperKill,
  createEmptyRuntime,
  mandateSummaries,
} from "./shadow";
import { loadVenueConfirmations } from "./venues";
import type { RuntimeState } from "./types";
import { planAllocation } from "./sizing";

const DATA_DIR = path.join(process.cwd(), "data", "phase7_9_readiness");
const STATE_PATH = path.join(DATA_DIR, "state.json");
const HEARTBEAT_PATH = path.join(DATA_DIR, "heartbeat.json");

type GlobalRuntime = {
  state: RuntimeState | null;
  inflight: Promise<void> | null;
  lastMarketAt: number;
  market: MarketSnapshot | null;
};

const globalForRuntime = globalThis as typeof globalThis & {
  __smartGridRuntime?: GlobalRuntime;
};

function slot(): GlobalRuntime {
  if (!globalForRuntime.__smartGridRuntime) {
    globalForRuntime.__smartGridRuntime = {
      state: null,
      inflight: null,
      lastMarketAt: 0,
      market: null,
    };
  }
  return globalForRuntime.__smartGridRuntime;
}

async function readStateFromDisk(): Promise<RuntimeState | null> {
  try {
    const raw = await readFile(STATE_PATH, "utf8");
    return JSON.parse(raw) as RuntimeState;
  } catch {
    return null;
  }
}

async function persist(state: RuntimeState): Promise<void> {
  await mkdir(DATA_DIR, { recursive: true });
  await writeFile(STATE_PATH, `${JSON.stringify(state)}\n`, "utf8");
  await writeFile(
    HEARTBEAT_PATH,
    `${JSON.stringify(
      {
        epoch: state.epoch,
        specHash: state.specHash,
        updatedAt: state.updatedAt,
        executionCursor: state.executionCursor,
        thesis: state.lastHierarchy?.thesis ?? null,
        live_actions_enabled: false,
        paperKillSwitch: state.paperKillSwitch,
      },
      null,
      2,
    )}\n`,
    "utf8",
  );
}

async function ensureAdvanced(): Promise<RuntimeState> {
  const memory = slot();
  if (memory.inflight) {
    await memory.inflight;
    if (memory.state && Date.now() - memory.lastMarketAt < 15_000) {
      return memory.state;
    }
  }
  if (memory.state && Date.now() - memory.lastMarketAt < 15_000) {
    return memory.state;
  }
  const work = (async () => {
    const now = Date.now();
    const market =
      memory.market && now - memory.lastMarketAt < 20_000
        ? memory.market
        : await loadMarket(now);
    memory.market = market;
    const existing = memory.state ?? (await readStateFromDisk());
    const firstOpen = market.series.oneMinute[0]?.openTime;
    if (!firstOpen) {
      throw new Error("no_closed_one_minute_candles");
    }
    let state =
      existing && existing.epoch === EPOCH_ID && existing.specHash === SPEC_HASH
        ? existing
        : createEmptyRuntime(now, firstOpen);
    state = advanceRuntime(
      state,
      market.series,
      market.source,
      state.paperKillSwitch,
    );
    memory.state = state;
    memory.lastMarketAt = Date.now();
    await persist(state);
  })();
  memory.inflight = work;
  try {
    await work;
  } finally {
    if (memory.inflight === work) {
      memory.inflight = null;
    }
  }
  if (!memory.state) {
    throw new Error("runtime_unavailable");
  }
  return memory.state;
}

export async function getSnapshot() {
  const [state, venues] = await Promise.all([ensureAdvanced(), loadVenueConfirmations()]);
  const market = slot().market ?? (await loadMarket());
  const summaries = mandateSummaries(state);
  const conservative = summaries.find((row) => row.mandate === "conservative");
  const promotion = evaluatePromotion(state, conservative, market.source);
  const hierarchy = state.lastHierarchy;
  const mark = market.mark ?? state.books[0]?.lastMark ?? 0;
  const allocation =
    hierarchy?.extensionScore !== null && hierarchy?.pace
      ? planAllocation("conservative", hierarchy.extensionScore, hierarchy.pace, mark)
      : null;

  return {
    generatedAt: new Date().toISOString(),
    epoch: EPOCH_ID,
    title: EPOCH_TITLE,
    specHash: SPEC_HASH,
    selectedCandidate: SELECTED_CANDIDATE,
    verdict: promotion.verdict,
    market: {
      source: market.source,
      fetchedAt: new Date(market.fetchedAt).toISOString(),
      lastClosed1m: market.lastClosed1m
        ? new Date(market.lastClosed1m.openTime).toISOString()
        : null,
      mark,
      warning: market.warning,
      evidenceEligible: market.source === "hyperliquid_public",
    },
    production: productionBoundary(),
    hierarchy,
    allocation,
    leverage: {
      ...phoenixLeverageTable(mark),
      makerRoundTripFeeRoePct: phoenixMakerRoundTripRoePct(10),
    },
    mandates: summaries.map((row) => ({
      ...row,
      books: row.books.map((book) => ({
        ...book,
        workingOrders: book.workingOrders.length,
      })),
    })),
    conservativeBooks: (conservative?.books ?? []).map((book) => ({
      ...book,
      workingOrderCount: book.workingOrders.length,
      workingOrders: undefined,
    })),
    promotion,
    venues: {
      rows: venues,
      feeSchedules: VENUES,
    },
    intents: state.intents.slice(-40).reverse(),
    events: state.events.slice(-30).reverse(),
    runtime: {
      createdAt: new Date(state.createdAt).toISOString(),
      updatedAt: new Date(state.updatedAt).toISOString(),
      executionCursor: new Date(state.executionCursor).toISOString(),
      epochStart: new Date(state.epochStartOpenTime).toISOString(),
      paperDurationHours: state.paperDurationMs / 3600000,
      independentLongTransitions: state.independentLongTransitions,
      paperKillSwitch: state.paperKillSwitch,
      invariants: state.invariants,
    },
  };
}

export type Snapshot = Awaited<ReturnType<typeof getSnapshot>>;

export async function triggerPaperKill() {
  const memory = slot();
  const state = await ensureAdvanced();
  const mark = state.books[0]?.lastMark || 0;
  const next = applyPaperKill(state, mark, Date.now());
  memory.state = next;
  await persist(next);
  return getSnapshot();
}
