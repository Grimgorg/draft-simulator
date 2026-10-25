/**
 * Reality Fracture (FRA) Play Boosters, as docs/sets/fra-reality-fracture.md describes them. That file is the
 * spec: the collector-number ranges, slot odds, weights and rules below come from it, and a change here
 * belongs there too.
 */
import type { Card } from "@draft-simulator/shared";
import {
  drawFromSheet,
  evenSheet,
  sheetWithVersions,
  type RandomSource,
  type SheetEntry,
} from "./boosterSheets.js";
import type { SetPrinting } from "./setPrinting.js";

export const REALITY_FRACTURE_PRINTING_SETS = ["fra", "spg"] as const;

function numbers(from: number, to: number): number[] {
  return Array.from({ length: to - from + 1 }, (_, i) => from + i);
}

const MAIN_SET = numbers(1, 194);
const COMMON_DUAL_LANDS = [175, 177, 178, 182, 183, 184, 190, 192, 193, 194];
const ECHOED_PAIRS = numbers(195, 280);
const DEFAULT_BASICS = numbers(281, 290);
const BORDERLESS_ECHOED_PAIRS = numbers(291, 320);
const SHATTERED_MIRROR = numbers(321, 333);
const SCULPTORS_STRONGHOLD = numbers(334, 358);
const BRAINTWISTER = numbers(359, 381);
const TOWER_BASICS = numbers(382, 396);
const PORTAL_VIEW_LANDS = numbers(397, 401);
/** SPG numbers, not FRA ones. */
const SPECIAL_GUESTS = numbers(159, 168);

/** The 43 echoed pairs by collector number, mythic pairs first. Their borderless versions are found by oracle id. */
export const ECHOED_PAIR_NUMBERS: [number, number][] = [
  [195, 242], [212, 244], [229, 259], // mythic
  [198, 230], [200, 231], [201, 217], [216, 276], [220, 251], [272, 279], [277, 278], // rare
  [196, 227], [197, 260], [199, 248], [202, 234], [203, 275], [204, 236], [205, 214], [206, 253], [207, 239],
  [208, 255], [209, 269], [210, 226], [211, 243], [213, 258], [215, 271], [218, 235], [219, 265], [221, 252],
  [222, 280], [223, 254], [224, 267], [225, 241], [228, 245], [232, 262], [233, 274], [237, 266], [238, 268],
  [240, 256], [246, 261], [247, 273], [249, 263], [250, 264], [257, 270], // uncommon
];

const SPECIAL_GUEST_CHANCE = 1 / 55;
const COMMON_IN_COMMON_OR_UNCOMMON_SLOT = 0.23;
/** The braintwister version's share of an uncommon's weight in slots 2 and 3 (weights 1 : 2). */
const UNCOMMON_VERSION_SHARE = 1 / 3;
/** A booster-fun or borderless version's share of its card's weight in slots 4, 5 and 6 (weights 1 : 7). */
const VERSION_SHARE = 1 / 8;

const ECHOED_WEIGHTS: Record<string, number> = { uncommon: 5, rare: 2, mythic: 1 };
const RARE_SLOT_WEIGHTS: Record<string, number> = { rare: 2, mythic: 1 };
const ANY_RARITY_WEIGHTS: Record<string, number> = { common: 40, uncommon: 22, rare: 6, mythic: 3 };
const LAND_WEIGHTS = { defaultBasic: 1, towerBasic: 1, commonDual: 3 };

export interface SetBooster {
  /** Cards that can be opened, counting a booster-fun version as its regular card. */
  cardCount: number;
  generatePack: (random: RandomSource) => Card[];
}

interface EchoedPair {
  cards: [SetPrinting, SetPrinting];
  borderless?: [SetPrinting, SetPrinting];
  weight: number;
}

function weightOf(weights: Record<string, number>) {
  return (printing: SetPrinting): number => {
    const weight = weights[printing.rarity];
    if (weight === undefined) throw new Error(`No weight for rarity "${printing.rarity}"`);
    return weight;
  };
}

/**
 * Builds the booster from the imported FRA and SPG printings. Throws if any printing the packs need is
 * missing, so a draft can't start with a card database that predates the set.
 */
export function buildRealityFractureBooster(printings: SetPrinting[]): SetBooster {
  const fra = new Map(printings.filter((p) => p.setCode === "fra").map((p) => [p.collectorNumber, p]));
  const spg = new Map(printings.filter((p) => p.setCode === "spg").map((p) => [p.collectorNumber, p]));

  const missing: string[] = [];
  let wantedCount = 0;
  function pick(from: Map<string, SetPrinting>, setCode: string, wanted: number[]): SetPrinting[] {
    const found: SetPrinting[] = [];
    wantedCount += wanted.length;
    for (const number of wanted) {
      const printing = from.get(String(number));
      if (printing) found.push(printing);
      else missing.push(`${setCode.toUpperCase()} ${number}`);
    }
    return found;
  }

  const mainSet = pick(fra, "fra", MAIN_SET.filter((n) => !COMMON_DUAL_LANDS.includes(n)));
  const commonDuals = pick(fra, "fra", COMMON_DUAL_LANDS);
  const echoed = pick(fra, "fra", ECHOED_PAIRS);
  const defaultBasics = pick(fra, "fra", DEFAULT_BASICS);
  const borderlessEchoed = pick(fra, "fra", BORDERLESS_ECHOED_PAIRS);
  const shatteredMirror = pick(fra, "fra", SHATTERED_MIRROR);
  const boosterFun = pick(fra, "fra", [...SCULPTORS_STRONGHOLD, ...BRAINTWISTER, ...PORTAL_VIEW_LANDS]);
  const towerBasics = pick(fra, "fra", TOWER_BASICS);
  const specialGuests = pick(spg, "spg", SPECIAL_GUESTS);
  if (missing.length > 0) {
    throw new Error(
      missing.length === wantedCount
        ? "The card database has no Reality Fracture cards yet. Wait for its update to finish, or restart " +
            "Draft Simulator to update it."
        : `The card database is missing ${missing.length} Reality Fracture card(s) (${missing.slice(0, 5).join(", ")}` +
            `${missing.length > 5 ? ", ..." : ""}). Restart Draft Simulator once the card database has updated.`
    );
  }

  const ofRarity = (list: SetPrinting[], ...rarities: string[]) => list.filter((p) => rarities.includes(p.rarity));
  const commons = ofRarity(mainSet, "common");
  const uncommons = ofRarity(mainSet, "uncommon");
  const raresAndMythics = ofRarity(mainSet, "rare", "mythic");
  const uncommonVersions = ofRarity(boosterFun, "uncommon");
  const rareVersions = ofRarity([...shatteredMirror, ...boosterFun], "rare", "mythic");

  const commonSheet = evenSheet(commons);
  const uncommonSheet = sheetWithVersions(uncommons, uncommonVersions, UNCOMMON_VERSION_SHARE, () => 1);
  const rareSheet = sheetWithVersions(raresAndMythics, rareVersions, VERSION_SHARE, weightOf(RARE_SLOT_WEIGHTS));
  const echoedSheet = sheetWithVersions(echoed, borderlessEchoed, VERSION_SHARE, weightOf(ECHOED_WEIGHTS));
  const anyRarity = weightOf(ANY_RARITY_WEIGHTS);
  const anyRaritySheet: SheetEntry[] = [
    ...evenSheet(commons, ANY_RARITY_WEIGHTS.common),
    ...sheetWithVersions(uncommons, uncommonVersions, UNCOMMON_VERSION_SHARE, anyRarity),
    // Shattered mirror cards have no version in this slot (it's the real pack's foil, and they have no foil).
    ...sheetWithVersions(raresAndMythics, ofRarity(boosterFun, "rare", "mythic"), VERSION_SHARE, anyRarity),
    ...sheetWithVersions(echoed, borderlessEchoed, VERSION_SHARE, anyRarity),
  ];
  const landSheet: SheetEntry[] = [
    ...evenSheet(defaultBasics, LAND_WEIGHTS.defaultBasic),
    ...evenSheet(towerBasics, LAND_WEIGHTS.towerBasic),
    ...evenSheet(commonDuals, LAND_WEIGHTS.commonDual),
  ];
  const specialGuestSheet = evenSheet(specialGuests);

  const byNumber = new Map(echoed.map((p) => [Number(p.collectorNumber), p]));
  const pairs: EchoedPair[] = ECHOED_PAIR_NUMBERS.map(([a, b]) => {
    const cards: [SetPrinting, SetPrinting] = [byNumber.get(a)!, byNumber.get(b)!];
    const versions = cards.map((card) => borderlessEchoed.find((v) => v.oracleId === card.oracleId));
    return {
      cards,
      ...(versions[0] && versions[1] ? { borderless: [versions[0], versions[1]] as [SetPrinting, SetPrinting] } : {}),
      weight: weightOf(ECHOED_WEIGHTS)(cards[0]),
    };
  });
  const pairSheet = pairs.map((pair, index) => ({ index, weight: pair.weight }));
  const pairTotal = pairSheet.reduce((sum, entry) => sum + entry.weight, 0);

  function drawPair(random: RandomSource): EchoedPair {
    let remaining = random() * pairTotal;
    for (const entry of pairSheet) {
      remaining -= entry.weight;
      if (remaining < 0) return pairs[entry.index]!;
    }
    return pairs[pairs.length - 1]!;
  }

  function generatePack(random: RandomSource): Card[] {
    const pack: SetPrinting[] = [];
    const taken = new Set<string>();
    const add = (printing: SetPrinting) => {
      pack.push(printing);
      taken.add(printing.oracleId);
    };

    // Slot 1: six commons, one of them replaced by a Special Guest in 1 of 55 packs.
    const specialGuest = random() < SPECIAL_GUEST_CHANCE;
    for (let i = 0; i < (specialGuest ? 5 : 6); i++) add(drawFromSheet(commonSheet, taken, random));
    if (specialGuest) add(drawFromSheet(specialGuestSheet, taken, random));
    // Slots 2 and 3: an uncommon, then a common or an uncommon.
    add(drawFromSheet(uncommonSheet, taken, random));
    add(drawFromSheet(random() < COMMON_IN_COMMON_OR_UNCOMMON_SLOT ? commonSheet : uncommonSheet, taken, random));
    // Slot 4: a complete echoed pair, borderless together, then one echoed card from another pair.
    const pair = drawPair(random);
    const shown = pair.borderless && random() < VERSION_SHARE ? pair.borderless : pair.cards;
    shown.forEach(add);
    add(drawFromSheet(echoedSheet, taken, random));
    // Slots 5 to 7: a rare or mythic, a card of any rarity, a land.
    add(drawFromSheet(rareSheet, taken, random));
    add(drawFromSheet(anyRaritySheet, taken, random));
    add(drawFromSheet(landSheet, taken, random));

    return pack.map((printing) => printing.card);
  }

  const cardCount = new Set(
    [...mainSet, ...commonDuals, ...echoed, ...defaultBasics, ...specialGuests].map((p) => p.oracleId)
  ).size;
  return { cardCount, generatePack };
}
