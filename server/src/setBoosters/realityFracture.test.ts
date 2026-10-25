import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import type { Card } from "@draft-simulator/shared";
import { testCard } from "../draftEngine/testHelpers.js";
import { buildRealityFractureBooster, ECHOED_PAIR_NUMBERS, REALITY_FRACTURE_PRINTING_SETS } from "./realityFracture.js";
import { generateSetPacks } from "./setBoosters.js";
import type { SetPrinting } from "./setPrinting.js";

/** A small seeded generator (mulberry32), so the statistical tests below always see the same packs. */
function seededRandom(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function numbers(from: number, to: number): number[] {
  return Array.from({ length: to - from + 1 }, (_, i) => from + i);
}

const DUALS = [175, 177, 178, 182, 183, 184, 190, 192, 193, 194];

/**
 * Stand-in FRA and SPG printings with the real set's shape (docs/sets/fra-reality-fracture.md): the same
 * collector-number ranges, rarity counts, pairs and booster-fun versions, one version per card at most.
 * Card ids are "<set>-<number>"; a version's oracle id is its regular card's.
 */
function fakePrintings(): SetPrinting[] {
  const printings: SetPrinting[] = [];
  const add = (setCode: string, number: number, rarity: string, oracleId: string) =>
    printings.push({ card: testCard(`${setCode}-${number}`), setCode, collectorNumber: String(number), rarity, oracleId });

  const byRarity: Record<string, number[]> = { common: [], uncommon: [], rare: [], mythic: [] };
  const regular = numbers(1, 194).filter((n) => !DUALS.includes(n));
  regular.forEach((n, i) => {
    const rarity = i < 71 ? "common" : i < 114 ? "uncommon" : i < 164 ? "rare" : "mythic";
    byRarity[rarity]!.push(n);
    add("fra", n, rarity, `o-${n}`);
  });
  for (const n of DUALS) add("fra", n, "common", `o-${n}`);

  const borderlessHalves: [number, string][] = [];
  ECHOED_PAIR_NUMBERS.forEach(([a, b], i) => {
    const rarity = i < 3 ? "mythic" : i < 10 ? "rare" : "uncommon";
    add("fra", a, rarity, `o-${a}`);
    add("fra", b, rarity, `o-${b}`);
    // Every rare and mythic pair and five uncommon ones have borderless versions.
    if (i < 15) borderlessHalves.push([a, rarity], [b, rarity]);
  });
  borderlessHalves.forEach(([half, rarity], i) => add("fra", 291 + i, rarity, `o-${half}`));

  const basics = ["plains", "island", "swamp", "mountain", "forest"];
  numbers(281, 290).forEach((n, i) => add("fra", n, "common", `o-${basics[Math.floor(i / 2)]}`));
  numbers(382, 396).forEach((n, i) => add("fra", n, "common", `o-${basics[Math.floor(i / 3)]}`));

  // Booster-fun versions take regular cards in order: shattered mirror, stronghold, braintwister, portal view.
  const next = { uncommon: 0, rare: 0, mythic: 0 };
  let number = 321;
  const versions = (rarity: "uncommon" | "rare" | "mythic", count: number) => {
    for (let i = 0; i < count; i++) add("fra", number++, rarity, `o-${byRarity[rarity]![next[rarity]++]}`);
  };
  versions("rare", 5);
  versions("mythic", 8);
  versions("rare", 18);
  versions("mythic", 7);
  versions("uncommon", 5);
  versions("rare", 15);
  versions("mythic", 3);
  number = 397;
  versions("rare", 5);

  for (const n of numbers(159, 168)) add("spg", n, "mythic", `o-spg-${n}`);
  return printings;
}

const printings = fakePrintings();
const byId = new Map(printings.map((p) => [p.card.scryfallId, p]));
const info = (card: Card) => byId.get(card.scryfallId)!;
const numberOf = (card: Card) => Number(info(card).collectorNumber);
const isEchoed = (card: Card) => info(card).setCode === "fra" && numberOf(card) >= 195 && numberOf(card) <= 320 &&
  !(numberOf(card) >= 281 && numberOf(card) <= 290);
const pairOf = (card: Card) =>
  ECHOED_PAIR_NUMBERS.findIndex(([a, b]) => [`o-${a}`, `o-${b}`].includes(info(card).oracleId));

function openPacks(count: number, seed = 1): Card[][] {
  const booster = buildRealityFractureBooster(printings);
  const random = seededRandom(seed);
  return Array.from({ length: count }, () => booster.generatePack(random));
}

const PACKS = openPacks(10_000);

function share(predicate: (pack: Card[]) => boolean): number {
  return PACKS.filter(predicate).length / PACKS.length;
}

function assertNear(actual: number, expected: number, tolerance: number, what: string): void {
  assert.ok(Math.abs(actual - expected) <= tolerance, `${what}: ${(actual * 100).toFixed(2)}%, expected about ${expected * 100}%`);
}

test("every pack has 14 cards and no card twice, counting a booster-fun version as its regular card", () => {
  for (const pack of PACKS) {
    assert.equal(pack.length, 14);
    assert.equal(new Set(pack.map((card) => info(card).oracleId)).size, 14);
  }
});

test("lays packs out slot by slot: commons, uncommon, common or uncommon, echoed pair and one more, rare, any, land", () => {
  for (const pack of PACKS) {
    const rarities = pack.map((card) => info(card).rarity);
    const guest = info(pack[5]!).setCode === "spg";
    assert.deepEqual(rarities.slice(0, guest ? 5 : 6), Array(guest ? 5 : 6).fill("common"));
    assert.equal(rarities[6], "uncommon");
    assert.ok(["common", "uncommon"].includes(rarities[7]!));
    assert.ok(["rare", "mythic"].includes(rarities[11]!), "every pack has a rare or mythic");
    for (const card of pack.slice(0, 8)) assert.ok(!isEchoed(card), "no echoed cards in slots 1 to 3");
    assert.ok(!isEchoed(pack[11]!), "no echoed cards in the rare slot");
  }
});

test("slot 4 holds a complete echoed pair of one rarity plus a card from another pair", () => {
  for (const pack of PACKS) {
    const [first, second, third] = pack.slice(8, 11);
    for (const card of [first!, second!, third!]) assert.ok(isEchoed(card));
    assert.equal(pairOf(first!), pairOf(second!));
    assert.notEqual(info(first!).oracleId, info(second!).oracleId);
    assert.equal(info(first!).rarity, info(second!).rarity);
    assert.notEqual(pairOf(third!), pairOf(first!));
    // A borderless pair is borderless as a whole.
    assert.equal(numberOf(first!) >= 291, numberOf(second!) >= 291);
  }
});

test("common dual lands and basics appear only in the land slot", () => {
  for (const pack of PACKS) {
    pack.forEach((card, index) => {
      const n = numberOf(card);
      const isLand = info(card).setCode === "fra" && (DUALS.includes(n) || (n >= 281 && n <= 290) || (n >= 382 && n <= 396));
      assert.equal(isLand, index === 13, `card ${card.scryfallId} at position ${index}`);
    });
  }
});

test("matches the documented odds", () => {
  const land = (from: number, to: number) => share((pack) => numberOf(pack[13]!) >= from && numberOf(pack[13]!) <= to);
  assertNear(share((pack) => pack.some((card) => info(card).setCode === "spg")), 1 / 55, 0.004, "Special Guest");
  assertNear(share((pack) => info(pack[7]!).rarity === "common"), 0.23, 0.015, "common in slot 3");
  assertNear(share((pack) => numberOf(pack[6]!) >= 359), 0.0388, 0.006, "braintwister uncommon in slot 2");
  assertNear(share((pack) => info(pack[8]!).rarity === "uncommon"), 0.9066, 0.01, "uncommon pair");
  assertNear(share((pack) => info(pack[8]!).rarity === "mythic"), 0.0165, 0.004, "mythic pair");
  assertNear(share((pack) => info(pack[8]!).rarity === "uncommon" && numberOf(pack[8]!) >= 291), 0.0172, 0.004, "borderless uncommon pair");
  assertNear(share((pack) => info(pack[11]!).rarity === "rare"), 0.8333, 0.012, "rare in slot 5");
  assertNear(share((pack) => numberOf(pack[11]!) >= 321 && numberOf(pack[11]!) <= 333), 0.0187, 0.004, "shattered mirror");
  // 49.82% by weight, but the pack's 6 or 7 commons can't come up again (rule 8), which takes out about a tenth.
  assertNear(share((pack) => info(pack[12]!).rarity === "common"), 0.48, 0.012, "common in slot 6");
  assertNear(share((pack) => info(pack[12]!).rarity === "mythic"), 0.0137, 0.004, "mythic in slot 6");
  assertNear(land(281, 290), 0.1818, 0.012, "default basic");
  assertNear(land(382, 396), 0.2727, 0.012, "tower basic");
});

test("never shows a shattered mirror version in slot 6", () => {
  for (const pack of PACKS) {
    const n = numberOf(pack[12]!);
    assert.ok(!(n >= 321 && n <= 333));
  }
});

test("refuses to build without every printing the packs need", () => {
  assert.throws(() => buildRealityFractureBooster([]), /has no Reality Fracture cards yet/);
  const withoutOne = printings.filter((p) => !(p.setCode === "fra" && p.collectorNumber === "250"));
  assert.throws(() => buildRealityFractureBooster(withoutOne), /missing 1 Reality Fracture card\(s\) \(FRA 250\)/);
});

test("opens a fresh pack for every seat and round", () => {
  const queue = generateSetPacks(buildRealityFractureBooster(printings), 3, 2, seededRandom(7));
  assert.deepEqual(
    queue.map((round) => round.map((pack) => [pack.id, pack.packNumber, pack.cards.length])),
    [
      [["pack-1-0", 1, 14], ["pack-1-1", 1, 14]],
      [["pack-2-0", 2, 14], ["pack-2-1", 2, 14]],
      [["pack-3-0", 3, 14], ["pack-3-1", 3, 14]],
    ]
  );
});

const DB_PATH = fileURLToPath(new URL("../../data/cards.sqlite3", import.meta.url));

function realPrintings(): SetPrinting[] | undefined {
  if (!fs.existsSync(DB_PATH)) return undefined;
  const db = new Database(DB_PATH, { readonly: true });
  try {
    const hasTable = db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'set_printings'").get();
    if (!hasTable) return undefined;
    const rows = db
      .prepare(`SELECT * FROM set_printings WHERE set_code IN (${REALITY_FRACTURE_PRINTING_SETS.map(() => "?").join(", ")})`)
      .all(...REALITY_FRACTURE_PRINTING_SETS) as {
      scryfall_id: string;
      name: string;
      set_code: string;
      collector_number: string;
      rarity: string;
      oracle_id: string | null;
    }[];
    if (rows.length === 0) return undefined;
    return rows.map((row) => ({
      card: { ...testCard(row.scryfall_id), name: row.name },
      setCode: row.set_code,
      collectorNumber: row.collector_number,
      rarity: row.rarity,
      oracleId: row.oracle_id ?? row.name,
    }));
  } finally {
    db.close();
  }
}

const real = realPrintings();

test(
  "the real card data has the shape the booster assumes",
  { skip: !real && "needs a card cache with set printings: npm run import-cards --workspace server" },
  () => {
    const fra = new Map(real!.filter((p) => p.setCode === "fra").map((p) => [Number(p.collectorNumber), p]));
    const regular = [...fra.entries()].filter(([n]) => n <= 280).map(([, p]) => p);

    // The main set's rarities as the doc counts them, the common dual lands left out.
    const counts: Record<string, number> = {};
    for (const [n, p] of fra) {
      if (n <= 194 && ![175, 177, 178, 182, 183, 184, 190, 192, 193, 194].includes(n)) counts[p.rarity] = (counts[p.rarity] ?? 0) + 1;
    }
    assert.deepEqual(counts, { common: 71, uncommon: 43, rare: 50, mythic: 20 });

    // Both halves of a pair share their rarity, and every echoed card is in exactly one pair.
    const paired = ECHOED_PAIR_NUMBERS.flat();
    assert.equal(new Set(paired).size, 86);
    for (const [a, b] of ECHOED_PAIR_NUMBERS) assert.equal(fra.get(a)!.rarity, fra.get(b)!.rarity, `pair ${a}/${b}`);

    // Every alternate printing the packs draw is a version of exactly one regular card of the same rarity.
    for (const [n, version] of fra) {
      if (n < 291 || n > 401 || (n >= 382 && n <= 396)) continue;
      const bases = regular.filter((p) => p.oracleId === version.oracleId);
      assert.equal(bases.length, 1, `FRA ${n} ${version.card.name}`);
      assert.equal(bases[0]!.rarity, version.rarity, `FRA ${n} ${version.card.name}`);
      // Borderless echoed cards are versions of echoed cards, the rest of main-set cards.
      assert.equal(Number(bases[0]!.collectorNumber) >= 195, n <= 320, `FRA ${n} ${version.card.name}`);
    }

    const booster = buildRealityFractureBooster(real!);
    const random = seededRandom(3);
    for (let i = 0; i < 500; i++) assert.equal(booster.generatePack(random).length, 14);
  }
);
