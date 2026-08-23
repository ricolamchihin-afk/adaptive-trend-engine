import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { VENUES } from "./spec";
import { rejectSecretFields } from "./production";
import type { VenueConfirmation, VenueId } from "./types";

const VENUE_PATH = path.join(process.cwd(), "data", "phase7_9_readiness", "venues.json");

export function emptyVenueConfirmations(): VenueConfirmation[] {
  return VENUES.map((venue) => ({
    id: venue.id,
    label: venue.label,
    confirmed: false,
    accountLabel: "",
    reportedFreeCollateralUsd: null,
    btcContract: "",
    collateralMode: "",
    notes: "",
    updatedAt: null,
  }));
}

export async function loadVenueConfirmations(): Promise<VenueConfirmation[]> {
  try {
    const raw = await readFile(VENUE_PATH, "utf8");
    const parsed = JSON.parse(raw) as VenueConfirmation[];
    const byId = new Map(parsed.map((row) => [row.id, row]));
    return emptyVenueConfirmations().map((row) => ({ ...row, ...byId.get(row.id) }));
  } catch {
    return emptyVenueConfirmations();
  }
}

export async function saveVenueConfirmations(
  updates: Array<Partial<VenueConfirmation> & { id: VenueId }>,
): Promise<VenueConfirmation[]> {
  for (const update of updates) {
    const banned = rejectSecretFields(update as Record<string, unknown>);
    if (banned) {
      throw new Error(banned);
    }
  }
  const current = await loadVenueConfirmations();
  const next = current.map((row) => {
    const update = updates.find((item) => item.id === row.id);
    if (!update) {
      return row;
    }
    return {
      ...row,
      confirmed: Boolean(update.confirmed),
      accountLabel: String(update.accountLabel ?? row.accountLabel).slice(0, 80),
      reportedFreeCollateralUsd:
        update.reportedFreeCollateralUsd === null ||
        update.reportedFreeCollateralUsd === undefined ||
        update.reportedFreeCollateralUsd === ("" as unknown)
          ? null
          : Number(update.reportedFreeCollateralUsd),
      btcContract: String(update.btcContract ?? row.btcContract).slice(0, 40),
      collateralMode: String(update.collateralMode ?? row.collateralMode).slice(0, 40),
      notes: String(update.notes ?? row.notes).slice(0, 240),
      updatedAt: Date.now(),
    };
  });
  await mkdir(path.dirname(VENUE_PATH), { recursive: true });
  await writeFile(VENUE_PATH, `${JSON.stringify(next, null, 2)}\n`, "utf8");
  return next;
}

export function venueReadiness(rows: VenueConfirmation[]) {
  const confirmed = rows.filter((row) => row.confirmed && row.accountLabel && row.reportedFreeCollateralUsd);
  const capital = confirmed.reduce(
    (sum, row) => sum + (row.reportedFreeCollateralUsd ?? 0),
    0,
  );
  return {
    confirmedCount: confirmed.length,
    requiredCount: 5,
    allConfirmed: confirmed.length === 5,
    reportedAggregateUsd: capital,
    note: "Reported balances are operator-entered. This screen never accepts credentials and never reads an exchange account.",
  };
}
