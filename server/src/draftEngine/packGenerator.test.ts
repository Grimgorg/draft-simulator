import assert from "node:assert/strict";
import test from "node:test";
import { generatePacks } from "./packGenerator.js";
import { testCard } from "./testHelpers.js";

test("splits the card pool into the right number of packs of the right size", () => {
  const pool = Array.from({ length: 12 }, (_, i) => testCard(`c${i}`));
  const queue = generatePacks(pool, { cubeId: "x", packCount: 2, packSize: 2, playerCount: 3 }, 3);

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
    () => generatePacks(pool, { cubeId: "x", packCount: 2, packSize: 2, playerCount: 3 }, 3),
    /needed/
  );
});
