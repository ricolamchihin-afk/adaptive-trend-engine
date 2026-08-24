import { describe, expect, it } from "vitest";
import { HL_4H_START_MS, researchWindows } from "./research";

describe("research holdout windows", () => {
  it("ends the pre-HL holdout where Hyperliquid 4h begins", () => {
    const windows = researchWindows(Date.UTC(2026, 7, 24), Date.UTC(2017, 7, 17));
    const hold = windows.find((w) => w.id === "holdout_pre_hl");
    const overlap = windows.find((w) => w.id === "overlap_hl");
    expect(hold?.endMs).toBe(HL_4H_START_MS);
    expect(overlap?.startMs).toBe(HL_4H_START_MS);
    expect(new Date(HL_4H_START_MS).toISOString().slice(0, 10)).toBe("2024-05-13");
  });
});
