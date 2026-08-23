import { LIVE_ACTIONS_ENABLED, PRODUCTION_BOUNDARY } from "./spec";

export function productionBoundary() {
  return {
    ...PRODUCTION_BOUNDARY,
    live_actions_enabled: LIVE_ACTIONS_ENABLED,
    statement:
      "No research component can place, cancel, resize, or close an exchange order. The long/short/grid regimes are paper only; this is not live authorization.",
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
