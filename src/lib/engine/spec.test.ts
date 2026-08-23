import { describe, expect, it } from "vitest";
import {
  FROZEN_SPEC,
  LIVE_ACTIONS_ENABLED,
  PRODUCTION_BOUNDARY,
  SPEC_HASH,
  STRATEGY,
  assertLiveActionsDisabled,
  directionalNotionalUsd,
  hashFrozenSpec,
  venueFeeRate,
} from "./spec";
import { rejectSecretFields } from "./production";

describe("dynamic directional specification", () => {
  it("keeps live writes disabled", () => {
    expect(LIVE_ACTIONS_ENABLED).toBe(false);
    expect(PRODUCTION_BOUNDARY.live_actions_enabled).toBe(false);
    expect(PRODUCTION_BOUNDARY.write_adapter).toBeNull();
    expect(() => assertLiveActionsDisabled()).not.toThrow();
  });

  it("hashes the strategy spec deterministically", () => {
    expect(SPEC_HASH).toMatch(/^[a-f0-9]{64}$/);
    expect(hashFrozenSpec()).toBe(SPEC_HASH);
    expect(FROZEN_SPEC.strategy).toBe("dynamic_directional_exposure");
    expect(FROZEN_SPEC.regimes).toContain("SHORT");
    expect(FROZEN_SPEC.retired).toContain("80");
  });

  it("uses Phoenix, 1000 USDC at 10x", () => {
    expect(STRATEGY.venue).toBe("phoenix");
    expect(STRATEGY.capitalUsd).toBe(1000);
    expect(STRATEGY.leverage).toBe(10);
    expect(directionalNotionalUsd(1000)).toBe(10_000);
    expect(directionalNotionalUsd(1500)).toBe(15_000);
  });

  it("exposes the Phoenix fee schedule", () => {
    expect(venueFeeRate("taker")).toBeCloseTo(0.0004, 8);
    expect(venueFeeRate("maker")).toBeCloseTo(0.00012, 8);
  });
});

describe("production boundary", () => {
  it("rejects credential-like fields", () => {
    expect(rejectSecretFields({ apiKey: "x" })).toContain("apiKey");
    expect(rejectSecretFields({ accountLabel: "phoenix-1" })).toBeNull();
  });
});
