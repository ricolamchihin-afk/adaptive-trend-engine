import type { Executor, ExecutionResult, OrderIntent } from "./executor";

// Phoenix Perpetuals adapter (Ellipsis Labs Rise SDK). Read paths (exchange metadata,
// collateral/funded check) are safe. Order submission is GATED: it builds the real
// order instruction but only signs+sends when the adapter has been explicitly marked
// testnet-verified (PHOENIX_ADAPTER_VERIFIED=true) AND live trading is enabled.
//
// The SDK is loaded dynamically so it never enters the client bundle, and every call
// is defensive: the app must keep working (dry-run) even if a field or key is missing.

export interface PhoenixEnv {
  apiUrl: string;
  rpcUrl: string;
  authority: string;
  marketSymbol: string;
  traderPdaIndex: number;
  verified: boolean;
}

export function phoenixEnv(): PhoenixEnv {
  return {
    apiUrl: process.env.PHOENIX_API_URL ?? "",
    rpcUrl: process.env.SOLANA_RPC_URL ?? "",
    authority: process.env.PHOENIX_AUTHORITY ?? "",
    marketSymbol: process.env.PHOENIX_MARKET_SYMBOL ?? "BTC",
    traderPdaIndex: Number(process.env.PHOENIX_TRADER_INDEX ?? 0) || 0,
    verified: (process.env.PHOENIX_ADAPTER_VERIFIED ?? "").toLowerCase() === "true",
  };
}

// Parses PHOENIX_AUTHORITY into a Solana Keypair (signer) if it is a secret key
// (JSON byte array or base58), else returns just the public key string.
async function loadSigner(
  web3: typeof import("@solana/web3.js"),
  secret: string,
): Promise<{ keypair: import("@solana/web3.js").Keypair | null; pubkey: string }> {
  const trimmed = secret.trim();
  try {
    if (trimmed.startsWith("[")) {
      const bytes = Uint8Array.from(JSON.parse(trimmed) as number[]);
      const kp = web3.Keypair.fromSecretKey(bytes);
      return { keypair: kp, pubkey: kp.publicKey.toBase58() };
    }
    const bs58 = (await import("bs58")).default;
    const bytes = bs58.decode(trimmed);
    if (bytes.length === 64) {
      const kp = web3.Keypair.fromSecretKey(bytes);
      return { keypair: kp, pubkey: kp.publicKey.toBase58() };
    }
  } catch {
    // fall through: treat the value as a public key
  }
  return { keypair: null, pubkey: trimmed };
}

export class PhoenixPerpExecutor implements Executor {
  readonly name = "phoenix-perp";

  get canTrade(): boolean {
    const e = phoenixEnv();
    return Boolean(e.verified && e.apiUrl && e.rpcUrl && e.authority);
  }

  // Read-only: collateral / open position for the funded check. Never trades.
  async accountState(): Promise<{ ok: boolean; collateralUsd?: number; detail: string }> {
    const e = phoenixEnv();
    if (!e.apiUrl || !e.rpcUrl || !e.authority) {
      return { ok: false, detail: "PHOENIX_API_URL, SOLANA_RPC_URL and PHOENIX_AUTHORITY must be set." };
    }
    try {
      const rise = (await import("@ellipsis-labs/rise")) as unknown as {
        createPhoenixClient: (o: unknown) => { exchange: { ready: () => Promise<unknown> }; api: { traders: () => { getTraderStateSnapshot: (a: string, o: unknown) => Promise<unknown> } } };
      };
      const web3 = await import("@solana/web3.js");
      const { pubkey } = await loadSigner(web3, e.authority);
      const client = rise.createPhoenixClient({ apiUrl: e.apiUrl, rpcUrl: e.rpcUrl });
      await client.exchange.ready();
      const snap = (await client.api.traders().getTraderStateSnapshot(pubkey, {
        traderPdaIndex: e.traderPdaIndex,
      })) as { snapshot?: { collateralUsd?: number } };
      const collateralUsd = snap?.snapshot?.collateralUsd;
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
      const { keypair, pubkey } = await loadSigner(web3, e.authority);
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

      // Hard safety gate: only sign + send once the adapter is testnet-verified.
      if (!this.canTrade) {
        return {
          submitted: false,
          live: false,
          message: `Built real Phoenix ${intent.side} order for ${Math.abs(intent.sizeBtc)} ${e.marketSymbol} — NOT sent (adapter not testnet-verified).`,
        };
      }
      if (!keypair) {
        return { submitted: false, live: false, message: "PHOENIX_AUTHORITY is not a signing key; cannot sign." };
      }
      const connection = new web3.Connection(e.rpcUrl, "confirmed");
      const tx = new web3.Transaction().add(ix as import("@solana/web3.js").TransactionInstruction);
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
