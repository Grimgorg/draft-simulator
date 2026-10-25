import { DRAFTABLE_SETS, type DraftableSet, type Pack } from "@draft-simulator/shared";
import type { RandomSource } from "./boosterSheets.js";
import { buildRealityFractureBooster, REALITY_FRACTURE_PRINTING_SETS, type SetBooster } from "./realityFracture.js";
import type { SetPrinting } from "./setPrinting.js";

interface SetBoosterDefinition {
  /** The Scryfall sets whose printings its packs draw from (bonus sheets like Special Guests included). */
  printingSets: readonly string[];
  build: (printings: SetPrinting[]) => SetBooster;
}

const DEFINITIONS: Record<string, SetBoosterDefinition> = {
  fra: { printingSets: REALITY_FRACTURE_PRINTING_SETS, build: buildRealityFractureBooster },
};

/** Every set whose printings the card import keeps, for all draftable sets together. */
export const SET_PRINTING_CODES: readonly string[] = [
  ...new Set(Object.values(DEFINITIONS).flatMap((definition) => definition.printingSets)),
];

export function findDraftableSet(setCode: string): DraftableSet {
  const set = DRAFTABLE_SETS.find((candidate) => candidate.code === setCode);
  if (!set || !DEFINITIONS[setCode]) throw new Error(`"${setCode}" is not a set that can be drafted`);
  return set;
}

/** The printing sets to load for `setCode`'s booster. */
export function printingSetsFor(setCode: string): readonly string[] {
  findDraftableSet(setCode);
  return DEFINITIONS[setCode]!.printingSets;
}

/** Builds the set's booster from its printings; throws if the card database lacks any of them. */
export function buildSetBooster(setCode: string, printings: SetPrinting[]): SetBooster {
  findDraftableSet(setCode);
  return DEFINITIONS[setCode]!.build(printings);
}

/** packQueue[round][seat], like generatePacks for a cube: every pack opened fresh from the set's booster. */
export function generateSetPacks(
  booster: SetBooster,
  packCount: number,
  playerCount: number,
  random: RandomSource = Math.random
): Pack[][] {
  const packQueue: Pack[][] = [];
  for (let round = 0; round < packCount; round++) {
    const roundPacks: Pack[] = [];
    for (let seat = 0; seat < playerCount; seat++) {
      roundPacks.push({ id: `pack-${round + 1}-${seat}`, packNumber: round + 1, cards: booster.generatePack(random) });
    }
    packQueue.push(roundPacks);
  }
  return packQueue;
}
