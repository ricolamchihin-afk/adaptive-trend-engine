import type { Executor, ExecutionResult, OrderIntent } from "./executor";

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

export class PhoenixPerpExecutor implements Executor {
  readonly name = "phoenix-perp";

  get canTrade(): boolean {
    const e = phoenixEnv();
    const liveOn = (process.env.LIVE_TRADING_ENABLED ?? "").toLowerCase() === "true";
    return Boolean(liveOn && e.verified && e.apiUrl && e.rpcUrl && phoenixHasSigner());
  }

  // Read-only: collateral / open position for the funded check. Never trades.
  async accountState(): Promise<{ ok: boolean; collateralUsd?: number; detail: string }> {
    const e = phoenixEnv();
    if (!e.apiUrl || !e.rpcUrl) {
      return { ok: false, detail: "Set PHOENIX_API_URL and PHOENIX_SOLANA_RPC." };
    }
    try {
      const rise = (await import("@ellipsis-labs/rise")) as unknown as {
        createPhoenixClient: (o: unknown) => {
          exchange: { ready: () => Promise<unknown> };
          api: { traders: () => { getTraderStateSnapshot: (a: string, o: unknown) => Promise<unknown> } };
        };
      };
      const web3 = await import("@solana/web3.js");
      const { pubkey } = await resolveSigner(web3);
      if (!pubkey) {
        return { ok: false, detail: "No signer or authority public key available." };
      }
      const client = rise.createPhoenixClient({ apiUrl: e.apiUrl, rpcUrl: e.rpcUrl });
      await client.exchange.ready();
      const snap = (await client.api.traders().getTraderStateSnapshot(pubkey, {
        traderPdaIndex: e.traderPdaIndex,
      })) as { snapshot?: { collateralUsd?: number; subaccounts?: Array<{ collateral?: string }> } };
      const collateralUsd = collateralUsdFromTraderSnapshot(snap);
      return {
        ok: typeof collateralUsd === "number" && collateralUsd > 0,
        collateralUsd,
        detail: `Trader ${pubkey.slice(0, 6)}… on ${e.marketSymbol}; collateral ${collateralUsd ?? "unknown"}.`,
      };
    } catch (error) {
      return { ok: false, detail: `Phoenix read failed: ${error instanceof Error ? error.message : "unknown"}` };
    }
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
