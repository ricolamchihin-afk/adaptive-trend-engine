import { describe, expect, it } from "vitest";
import {
  FROZEN_SPEC,
  LIVE_ACTIONS_ENABLED,
  PRODUCTION_BOUNDARY,
  SPEC_HASH,
  assertLiveActionsDisabled,
  hashFrozenSpec,
  maxNotionalUsd,
} from "./spec";
import { rejectSecretFields } from "./production";
import { paceFromFifteen, extensionScoreFromParts } from "./hierarchy";
import { planAllocation, targetNotionalUsd } from "./sizing";

describe("frozen Conservative specification", () => {
  it("keeps live writes disabled", () => {
    expect(LIVE_ACTIONS_ENABLED).toBe(false);
    expect(PRODUCTION_BOUNDARY.live_actions_enabled).toBe(false);
    expect(PRODUCTION_BOUNDARY.write_adapter).toBeNull();
    expect(() => assertLiveActionsDisabled()).not.toThrow();
  });

  it("hashes the frozen candidate deterministically", () => {
    expect(SPEC_HASH).toMatch(/^[a-f0-9]{64}$/);
    expect(hashFrozenSpec()).toBe(SPEC_HASH);
    expect(FROZEN_SPEC.candidate).toBe("conservative");
  });

  it("sizes Conservative from the 25% floor to 100% as extension falls", () => {
    expect(maxNotionalUsd("conservative")).toBe(1600);
    expect(targetNotionalUsd("conservative", 100)).toBe(400);
    expect(targetNotionalUsd("conservative", 0)).toBe(1600);
    expect(targetNotionalUsd("conservative", 50)).toBe(1000);
    const staged = planAllocation("conservative", 100, 0.25, 100_000);
    expect(staged.immediateNotional).toBe(100);
    expect(staged.gridRemainderNotional).toBe(300);
  });

  it("does not treat Moderate or Aggressive as live candidates", () => {
    expect(FROZEN_SPEC.mandates.moderate.role).toBe("research_benchmark");
    expect(FROZEN_SPEC.mandates.aggressive.role).toBe("research_benchmark");
    expect(FROZEN_SPEC.mandates.conservative.role).toBe("selected_production_candidate");
  });
});

describe("hierarchy mapping", () => {
  it("maps 15m evidence to pace only", () => {
    expect(paceFromFifteen(-0.2, 40)).toBe(1);
    expect(paceFromFifteen(0.4, 60)).toBe(0.5);
    expect(paceFromFifteen(1.4, 70)).toBe(0.25);
  });

  it("raises extension when the trend is stretched", () => {
    const tight = extensionScoreFromParts(-1.5, 45, 48);
    const stretched = extensionScoreFromParts(2.2, 78, 72);
    expect(stretched).toBeGreaterThan(tight);
  });
});

describe("production boundary", () => {
  it("rejects credential-like fields", () => {
    expect(rejectSecretFields({ apiKey: "x" })).toContain("apiKey");
    expect(rejectSecretFields({ accountLabel: "decibel-1" })).toBeNull();
  });
});
