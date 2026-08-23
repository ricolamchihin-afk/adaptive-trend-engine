import { LIVE_ACTIONS_ENABLED, PRODUCTION_BOUNDARY } from "./spec";
import type { DryRunIntent } from "./types";

export function productionBoundary() {
  return {
    ...PRODUCTION_BOUNDARY,
    live_actions_enabled: LIVE_ACTIONS_ENABLED,
    statement:
      "No research component can place, cancel, resize, or close an exchange order. Selection of Conservative LONG is not live authorization.",
    missing_write_adapter: true,
    credential_import_forbidden: true,
  };
}

export function rejectSecretFields(payload: Record<string, unknown>): string | null {
  const banned = [
    "apikey",
    "api_key",
    "secret",
    "apisecret",
    "api_secret",
    "passphrase",
    "privatekey",
    "private_key",
    "mnemonic",
    "seed",
    "password",
    "token",
    "authorization",
  ];
  for (const key of Object.keys(payload)) {
    if (banned.includes(key.toLowerCase().replace(/[\s-]/g, "_"))) {
      return `rejected_secret_field:${key}`;
    }
  }
  return null;
}

export function markIntentPaperOnly(intent: DryRunIntent): DryRunIntent {
  return {
    ...intent,
    liveSubmitted: false,
    note: intent.note || "Dry-run intent only. No exchange write adapter exists.",
  };
}

export function assertNoLiveSubmit(intent: DryRunIntent): void {
  if (intent.liveSubmitted) {
    throw new Error("Dry-run intents cannot be marked liveSubmitted.");
  }
  if (LIVE_ACTIONS_ENABLED) {
    throw new Error("live_actions_enabled must remain false.");
  }
}
