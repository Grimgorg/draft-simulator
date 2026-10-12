import assert from "node:assert/strict";
import test from "node:test";
import { generatePacks } from "./packGenerator.js";
import { testCard } from "./testHelpers.js";

test("splits the card pool into the right number of packs of the right size", () => {
  const pool = Array.from({ length: 12 }, (_, i) => testCard(`c${i}`));
  const queue = generatePacks(pool, { cubeId: "x", packCount: 2, packSize: 2, playerCount: 3, alternatingDraft: true }, 3);

  assert.equal(queue.length, 2);
  for (const round of queue) {
    assert.equal(round.length, 3);
    for (const pack of round) {
      assert.equal(pack.cards.length, 2);
    }
  }

  const allCardIds = queue.flat().flatMap((pack) => pack.cards.map((c) => c.scryfallId));
  assert.equal(allCardIds.length, 12);
  assert.equal(new Set(allCardIds).size, 12);
});

test("throws when the cube doesn't have enough cards", () => {
  const pool = Array.from({ length: 5 }, (_, i) => testCard(`c${i}`));
  assert.throws(
    () => generatePacks(pool, { cubeId: "x", packCount: 2, packSize: 2, playerCount: 3, alternatingDraft: true }, 3),
    /needed/
  );
});

test("uses each card at most once, leaves surplus cards out, and numbers packs by round", () => {
  const pool = Array.from({ length: 7 }, (_, i) => testCard(`c${i}`));
  const queue = generatePacks(pool, { cubeId: "x", packCount: 3, packSize: 1, playerCount: 2, alternatingDraft: true }, 2);

  assert.deepEqual(
    queue.map((round) => round.map((pack) => [pack.id, pack.packNumber])),
    [
      [["pack-1-0", 1], ["pack-1-1", 1]],
      [["pack-2-0", 2], ["pack-2-1", 2]],
      [["pack-3-0", 3], ["pack-3-1", 3]],
    ]
  );
  const dealt = queue.flat().flatMap((pack) => pack.cards.map((c) => c.scryfallId));
  assert.equal(new Set(dealt).size, 6);
  assert.equal(pool.length, 7, "the cube's card list itself isn't consumed");
});

test("deals both copies of a card the cube runs twice", () => {
  const pool = [testCard("fetch"), testCard("fetch"), testCard("bolt"), testCard("bolt")];
  const queue = generatePacks(pool, { cubeId: "x", packCount: 1, packSize: 2, playerCount: 2, alternatingDraft: true }, 2);

  const dealt = queue.flat().flatMap((pack) => pack.cards.map((c) => c.scryfallId));
  assert.deepEqual(dealt.sort(), ["bolt", "bolt", "fetch", "fetch"]);
});
