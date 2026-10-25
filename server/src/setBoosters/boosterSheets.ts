import type { SetPrinting } from "./setPrinting.js";

/** A printing a slot can draw, with its weight: the chance of drawing it is its weight over the slot's total. */
export interface SheetEntry {
  printing: SetPrinting;
  weight: number;
}

/** Returns a number in [0, 1), like Math.random, which is the default. Tests pass a seeded one. */
export type RandomSource = () => number;

/**
 * Draws one printing, skipping cards already in the pack (by oracle id, so a booster-fun version counts as
 * its regular card). Skipping them gives the same odds as redrawing until a new card comes up.
 */
export function drawFromSheet(sheet: SheetEntry[], taken: Set<string>, random: RandomSource): SetPrinting {
  const available = sheet.filter((entry) => !taken.has(entry.printing.oracleId));
  const total = available.reduce((sum, entry) => sum + entry.weight, 0);
  if (total <= 0) throw new Error("A booster slot has no cards left to draw");

  let remaining = random() * total;
  for (const entry of available) {
    remaining -= entry.weight;
    if (remaining < 0) return entry.printing;
  }
  // Only reachable through floating-point rounding at the very end of the range.
  return available[available.length - 1]!.printing;
}

/** Every printing at the same weight. */
export function evenSheet(printings: SetPrinting[], weight = 1): SheetEntry[] {
  return printings.map((printing) => ({ printing, weight }));
}

/**
 * A sheet of regular printings in which a card that has booster-fun versions shares its weight with them:
 * each version gets `versionShare` of it and the regular printing the rest. A card without versions keeps
 * all of it. `cardWeight` gives each regular card's weight.
 */
export function sheetWithVersions(
  regulars: SetPrinting[],
  versions: SetPrinting[],
  versionShare: number,
  cardWeight: (printing: SetPrinting) => number
): SheetEntry[] {
  const sheet: SheetEntry[] = [];
  for (const regular of regulars) {
    const weight = cardWeight(regular);
    const own = versions.filter((version) => version.oracleId === regular.oracleId);
    for (const version of own) sheet.push({ printing: version, weight: weight * versionShare });
    sheet.push({ printing: regular, weight: weight * (1 - versionShare * own.length) });
  }
  return sheet;
}

export function totalWeight(sheet: SheetEntry[]): number {
  return sheet.reduce((sum, entry) => sum + entry.weight, 0);
}
