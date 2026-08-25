import type { Executor, ExecutionResult, OrderIntent } from "./executor";
import { collateralLiteFromPhoenix, fillLiteFromPhoenix, type CollateralEventLite, type FillLite } from "./equityCurve";

// Phoenix Perpetuals adapter (Ellipsis Labs Rise SDK). Read paths (exchange metadata,
// collateral/funded check) are safe. Order submission is GATED: it builds the real
// order instruction but only signs+sends when the adapter is testnet-verified
// (PHOENIX_ADAPTER_VERIFIED=true) AND live trading is enabled.
//
// The SDK is loaded dynamically so it never enters the client bundle, and every call
// is defensive: the app must keep working (dry-run) even if a field or key is missing.

export interface PhoenixEnv {
  apiUrl: string;
  rpcUrl: string;
  privateKey: string; // signer secret (base58 or JSON byte array)
  keypairPath: string; // alternative: path to a Solana keypair JSON file
  authorityPubkey: string; // trader authority public key (optional; else derived from signer)
  marketSymbol: string;
  traderPdaIndex: number;
  verified: boolean;
}

// Reads Phoenix config, accepting the common variable-name variants.
export function phoenixEnv(): PhoenixEnv {
  return {
    apiUrl: process.env.PHOENIX_API_URL ?? "",
    rpcUrl: process.env.PHOENIX_SOLANA_RPC ?? process.env.SOLANA_RPC_URL ?? "",
    privateKey: process.env.PHOENIX_PRIVATE_KEY ?? "",
    keypairPath: process.env.PHOENIX_KEYPAIR_PATH ?? "",
    authorityPubkey: process.env.PHOENIX_AUTHORITY ?? "",
    marketSymbol: process.env.PHOENIX_MARKET_SYMBOL ?? "BTC",
    traderPdaIndex: Number(process.env.PHOENIX_TRADER_INDEX ?? 0) || 0,
    verified: (process.env.PHOENIX_ADAPTER_VERIFIED ?? "").toLowerCase() === "true",
  };
}

export function phoenixConfigured(): boolean {
  const e = phoenixEnv();
  return Boolean(e.apiUrl && (e.privateKey || e.keypairPath || e.authorityPubkey));
}

export function phoenixHasSigner(): boolean {
  const e = phoenixEnv();
  return Boolean(e.privateKey || e.keypairPath);
}

// Rise trader-state snapshot stores collateral as quote lots (1e6 = $1), not collateralUsd.
export function collateralUsdFromTraderSnapshot(snap: {
  snapshot?: { collateralUsd?: number; subaccounts?: Array<{ collateral?: string }> };
}): number | undefined {
  if (typeof snap?.snapshot?.collateralUsd === "number") return snap.snapshot.collateralUsd;
  const lots = Number(snap?.snapshot?.subaccounts?.[0]?.collateral);
  if (!Number.isFinite(lots)) return undefined;
  return lots / 1_000_000; // ponytail: Rise QUOTE_LOTS_PER_USD is 1e6; use getTrader().collateralBalance if that view is populated
}

export function baseLotsToBtc(lots: number, decimals = 4): number {
  if (!Number.isFinite(lots) || lots === 0) return 0;
  // Fill history sometimes already stores BTC in the lots field (e.g. "0.0001").
  if (!Number.isInteger(lots) || Math.abs(lots) < 1) return Math.abs(lots);
  const d = Number.isFinite(decimals) && decimals >= 0 ? decimals : 4;
  return Math.abs(lots) / 10 ** d;
}

export interface PhoenixBtcPosition {
  side: "LONG" | "SHORT" | "FLAT";
  sizeBtc: number;
  entryUsd: number | null;
}

function numOrNull(raw: string | undefined): number | null {
  if (raw === undefined || raw === "") return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

// BTC book from a Rise trader snapshot. Prefers basePositionUnits (BTC). Integer
// lots are scaled by market baseLotsDecimals (BTC = 4 → 949 lots = 0.0949 BTC).
export function btcPositionFromTraderSnapshot(
  snap: {
    snapshot?: {
      subaccounts?: Array<{
        positions?: Array<{
          symbol?: string;
          basePositionLots?: string;
          basePositionUnits?: string;
          entryPriceUsd?: string;
        }>;
      }>;
    };
  },
  symbol = "BTC",
  baseLotsDecimals = 4,
): PhoenixBtcPosition {
  const want = symbol.toUpperCase();
  const positions = snap?.snapshot?.subaccounts?.flatMap((s) => s.positions ?? []) ?? [];
  const pos = positions.find((p) => (p.symbol ?? "").toUpperCase().includes(want));
  if (!pos) return { side: "FLAT", sizeBtc: 0, entryUsd: null };
  const units = numOrNull(pos.basePositionUnits);
  const lots = numOrNull(pos.basePositionLots) ?? 0;
  const signed = units !== null && units !== 0 ? units : lots;
  if (signed === 0) return { side: "FLAT", sizeBtc: 0, entryUsd: null };
  const sizeBtc = units !== null && units !== 0 ? Math.abs(units) : baseLotsToBtc(lots, baseLotsDecimals);
  return {
    side: signed > 0 ? "LONG" : "SHORT",
    sizeBtc,
    entryUsd: numOrNull(pos.entryPriceUsd),
  };
}

function decodeSecret(raw: string, bytesFromBase58: (s: string) => Uint8Array): Uint8Array | null {
  const trimmed = raw.trim();
  try {
    if (trimmed.startsWith("[")) {
      return Uint8Array.from(JSON.parse(trimmed) as number[]);
    }
    const bytes = bytesFromBase58(trimmed);
    return bytes.length === 64 ? bytes : null;
  } catch {
    return null;
  }
}

// Resolves the signer keypair (from PHOENIX_PRIVATE_KEY or PHOENIX_KEYPAIR_PATH) and
// the authority public key. Never logs the secret.
async function resolveSigner(
  web3: typeof import("@solana/web3.js"),
): Promise<{ keypair: import("@solana/web3.js").Keypair | null; pubkey: string }> {
  const e = phoenixEnv();
  const bs58 = (await import("bs58")).default;

  let secret = e.privateKey;
  if (!secret && e.keypairPath) {
    try {
      const fs = await import("node:fs/promises");
      secret = await fs.readFile(e.keypairPath, "utf8");
    } catch {
      secret = "";
    }
  }

  let keypair: import("@solana/web3.js").Keypair | null = null;
  if (secret) {
    const bytes = decodeSecret(secret, (s) => bs58.decode(s));
    if (bytes) {
      keypair = web3.Keypair.fromSecretKey(bytes);
    }
  }

  const pubkey = e.authorityPubkey || (keypair ? keypair.publicKey.toBase58() : "");
  return { keypair, pubkey };
}

function kitIxToWeb3(
  ix: { programAddress: string; accounts: Array<{ address: string; role: number }>; data: Uint8Array },
  web3: typeof import("@solana/web3.js"),
): import("@solana/web3.js").TransactionInstruction {
  return new web3.TransactionInstruction({
    programId: new web3.PublicKey(ix.programAddress),
    keys: ix.accounts.map((a) => ({
      pubkey: new web3.PublicKey(a.address),
      isSigner: a.role === 2 || a.role === 3,
      isWritable: a.role === 1 || a.role === 3,
    })),
    data: Buffer.from(ix.data),
  });
}

type RiseApi = {
  exchange: { ready: () => Promise<unknown> };
  api: {
    markets: () => {
      getLatestMarketStats: (s: string) => Promise<Record<string, unknown>>;
      getMarket: (s: string) => Promise<{ units?: { baseLotsDecimals?: number }; baseLotsDecimals?: number }>;
    };
    traders: () => { getTraderStateSnapshot: (a: string, o: unknown) => Promise<unknown> };
    collateral: () => {
      getTraderCollateralHistory: (
        a: string,
        r?: unknown,
      ) => Promise<{
        data?: Array<{ eventType: string; amount: number; collateralAfter: number; timestamp: number }>;
        nextCursor?: string | null;
        hasMore?: boolean;
      }>;
    };
    trades: () => {
      getTraderTradesHistory: (
        a: string,
        r?: unknown,
      ) => Promise<{
        data?: Array<{
          timestamp: number;
          price: string;
          realizedPnl: string;
          fees: string;
          baseLotsAfter: string;
        }>;
        nextCursor?: string | null;
        hasMore?: boolean;
      }>;
    };
  };
};

async function phoenixSession(): Promise<{ api: RiseApi; pubkey: string } | { error: string }> {
  const e = phoenixEnv();
  if (!e.apiUrl || !e.rpcUrl) return { error: "Set PHOENIX_API_URL and PHOENIX_SOLANA_RPC." };
  const rise = (await import("@ellipsis-labs/rise")) as unknown as {
    createPhoenixClient: (o: unknown) => RiseApi;
  };
  const web3 = await import("@solana/web3.js");
  const { pubkey } = await resolveSigner(web3);
  if (!pubkey) return { error: "No signer or authority public key available." };
  const api = rise.createPhoenixClient({ apiUrl: e.apiUrl, rpcUrl: e.rpcUrl });
  await api.exchange.ready();
  return { api, pubkey };
}

export function markFromMarketStats(raw: Record<string, unknown> | null | undefined): number | null {
  if (!raw) return null;
  const n = Number(raw.mark_price ?? raw.markPrice);
  return Number.isFinite(n) && n > 0 ? n : null;
}

const gLots = globalThis as typeof globalThis & { __ateBtcLotsDecimals?: { at: number; n: number } };

async function btcLotsDecimals(api: RiseApi): Promise<number> {
  const hit = gLots.__ateBtcLotsDecimals;
  if (hit && Date.now() - hit.at < 10 * 60_000) return hit.n;
  try {
    const m = await api.api.markets().getMarket(phoenixEnv().marketSymbol);
    const n = Number(m.units?.baseLotsDecimals ?? m.baseLotsDecimals);
    const d = Number.isFinite(n) && n >= 0 ? n : 4;
    gLots.__ateBtcLotsDecimals = { at: Date.now(), n: d };
    return d;
  } catch {
    return 4;
  }
}

export class PhoenixPerpExecutor implements Executor {
  readonly name = "phoenix-perp";

  get canTrade(): boolean {
    const e = phoenixEnv();
    const liveOn = (process.env.LIVE_TRADING_ENABLED ?? "").toLowerCase() === "true";
    return Boolean(liveOn && e.verified && e.apiUrl && e.rpcUrl && phoenixHasSigner());
  }

  // Read-only: collateral / open position for the funded check. Never trades.
  async accountState(): Promise<{
    ok: boolean;
    collateralUsd?: number;
    detail: string;
    position?: PhoenixBtcPosition;
  }> {
    const session = await phoenixSession();
    if ("error" in session) return { ok: false, detail: session.error };
    try {
      const e = phoenixEnv();
      const snap = (await session.api.api.traders().getTraderStateSnapshot(session.pubkey, {
        traderPdaIndex: e.traderPdaIndex,
      })) as {
        snapshot?: {
          collateralUsd?: number;
          subaccounts?: Array<{
            collateral?: string;
            positions?: Array<{
              symbol?: string;
              basePositionLots?: string;
              basePositionUnits?: string;
              entryPriceUsd?: string;
            }>;
          }>;
        };
      };
      const collateralUsd = collateralUsdFromTraderSnapshot(snap);
      const decimals = await btcLotsDecimals(session.api);
      const position = btcPositionFromTraderSnapshot(snap, e.marketSymbol, decimals);
      return {
        ok: typeof collateralUsd === "number" && collateralUsd > 0,
        collateralUsd,
        position,
        detail: `Trader ${session.pubkey.slice(0, 6)}… on ${e.marketSymbol}; collateral ${collateralUsd ?? "unknown"}; ${position.side}.`,
      };
    } catch (error) {
      return { ok: false, detail: `Phoenix read failed: ${error instanceof Error ? error.message : "unknown"}` };
    }
  }

  async btcMark(): Promise<number | null> {
    const session = await phoenixSession();
    if ("error" in session) return null;
    try {
      const stats = await session.api.api.markets().getLatestMarketStats(phoenixEnv().marketSymbol);
      return markFromMarketStats(stats);
    } catch {
      return null;
    }
  }

  async collateralEvents(): Promise<CollateralEventLite[]> {
    const session = await phoenixSession();
    if ("error" in session) return [];
    const rows: CollateralEventLite[] = [];
    let cursor: string | undefined;
    // ponytail: 20 pages × 200 = 4k events; raise if the book lives years and paging stalls.
    for (let page = 0; page < 20; page += 1) {
      const res = await session.api.api.collateral().getTraderCollateralHistory(session.pubkey, {
        limit: 200,
        pdaIndex: phoenixEnv().traderPdaIndex,
        ...(cursor ? { nextCursor: cursor } : {}),
      });
      rows.push(...(res.data ?? []).map(collateralLiteFromPhoenix));
      if (!res.hasMore || !res.nextCursor) break;
      cursor = res.nextCursor;
    }
    return rows;
  }

  async btcFills(): Promise<FillLite[]> {
    const session = await phoenixSession();
    if ("error" in session) return [];
    const rows: FillLite[] = [];
    let cursor: string | undefined;
    // ponytail: same 20-page ceiling as collateral; oldest fills drop off after that.
    for (let page = 0; page < 20; page += 1) {
      const res = await session.api.api.trades().getTraderTradesHistory(session.pubkey, {
        limit: 200,
        pdaIndex: phoenixEnv().traderPdaIndex,
        marketSymbol: phoenixEnv().marketSymbol,
        ...(cursor ? { cursor } : {}),
      });
      rows.push(...(res.data ?? []).map(fillLiteFromPhoenix));
      if (!res.hasMore || !res.nextCursor) break;
      cursor = res.nextCursor ?? undefined;
    }
    return rows;
  }

  async submit(intent: OrderIntent): Promise<ExecutionResult> {
    const e = phoenixEnv();
    if (intent.side === "FLAT" || intent.sizeBtc === 0) {
      return { submitted: false, live: false, message: "No position to open." };
    }
    let built = false;
    try {
      const rise = (await import("@ellipsis-labs/rise")) as unknown as {
        Side: { Bid: unknown; Ask: unknown };
        createPhoenixClient: (o: unknown) => {
          exchange: { ready: () => Promise<unknown> };
          orderPackets: { buildMarketOrderPacket: (o: unknown) => Promise<unknown> };
          ixs: { buildPlaceMarketOrder: (o: unknown) => Promise<unknown> };
        };
      };
      const web3 = await import("@solana/web3.js");
      const { keypair, pubkey } = await resolveSigner(web3);
      if (!pubkey) {
        return { submitted: false, live: false, message: "No signer/authority available." };
      }
      const client = rise.createPhoenixClient({ apiUrl: e.apiUrl, rpcUrl: e.rpcUrl });
      await client.exchange.ready();
      const orderPacket = await client.orderPackets.buildMarketOrderPacket({
        symbol: e.marketSymbol,
        side: intent.side === "LONG" ? rise.Side.Bid : rise.Side.Ask,
        baseUnits: Math.abs(intent.sizeBtc).toString(),
        // 128 = OrderFlags.ReduceOnly — flatten must not flip the book.
        ...(intent.reduceOnly ? { orderFlags: 128 } : {}),
      });
      const ix = await client.ixs.buildPlaceMarketOrder({
        authority: pubkey,
        symbol: e.marketSymbol,
        orderPacket,
        traderPdaIndex: e.traderPdaIndex,
        traderSubaccountIndex: 0,
      });
      built = true;

      // Hard safety gate: only sign + send once the adapter is testnet-verified & live.
      if (!this.canTrade) {
        return {
          submitted: false,
          live: false,
          message: `Built real Phoenix ${intent.side} order for ${Math.abs(intent.sizeBtc)} ${e.marketSymbol} — NOT sent (adapter not verified / live off).`,
        };
      }
      if (!keypair) {
        return { submitted: false, live: false, message: "PHOENIX_PRIVATE_KEY/KEYPAIR_PATH did not resolve to a signing key." };
      }
      const connection = new web3.Connection(e.rpcUrl, "confirmed");
      const raw = ix as { programAddress?: string; accounts?: unknown; data?: Uint8Array };
      const instruction =
        raw.programAddress && Array.isArray(raw.accounts) && raw.data
          ? kitIxToWeb3(
              raw as { programAddress: string; accounts: Array<{ address: string; role: number }>; data: Uint8Array },
              web3,
            )
          : (ix as import("@solana/web3.js").TransactionInstruction);
      // ponytail: Phoenix place-market-order blows the default 200k CU (observed ProgramFailedToComplete); 1.4M is the runtime cap.
      const tx = new web3.Transaction().add(
        web3.ComputeBudgetProgram.setComputeUnitLimit({ units: 1_400_000 }),
        web3.ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 10_000 }),
        instruction,
      );
      const sig = await web3.sendAndConfirmTransaction(connection, tx, [keypair]);
      return { submitted: true, live: true, message: `Submitted Phoenix ${intent.side} order. tx ${sig}` };
    } catch (error) {
      return {
        submitted: false,
        live: false,
        message: `${built ? "Order built but send failed" : "Order build failed"}: ${error instanceof Error ? error.message : "unknown"}`,
      };
    }
  }
}
