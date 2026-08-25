import assert from "node:assert/strict";
import test from "node:test";
import { testCard } from "../draftEngine/testHelpers.js";
import {
  createMatch,
  createToken,
  deleteToken,
  drawCard,
  findOwnCard,
  flipFaceDown,
  moveCard,
  mulligan,
  peekLibrary,
  rollDie,
  setBattlefieldSlot,
  setCardCounter,
  setPlayerCounter,
  shuffleLibrary,
  tapCard,
  untapAll,
} from "./gameEngine.js";

test("deals a 7-card opening hand from a shuffled library for each player", () => {
  const deckA = Array.from({ length: 10 }, (_, i) => testCard(`a${i}`));
  const deckB = Array.from({ length: 10 }, (_, i) => testCard(`b${i}`));

  const match = createMatch("alice", deckA, "bob", deckB);

  assert.deepEqual(match.players, ["alice", "bob"]);
  const boardA = match.boards["alice"]!;
  const boardB = match.boards["bob"]!;

  assert.equal(boardA.hand.length, 7);
  assert.equal(boardA.library.length, 3);
  assert.equal(boardA.battlefield.length, 0);
  assert.equal(boardA.graveyard.length, 0);
  assert.equal(boardA.exile.length, 0);
  assert.equal(boardA.counters["life"], 20);

  assert.equal(boardB.hand.length, 7);
  assert.equal(boardB.library.length, 3);

  // Every dealt card instance still traces back to the original deck, none duplicated or invented.
  const dealtAIds = [...boardA.hand, ...boardA.library].map((inst) => inst.card!.scryfallId).sort();
  assert.deepEqual(
    dealtAIds,
    deckA.map((c) => c.scryfallId).sort()
  );
});

test("caps the opening hand at the deck size for a tiny deck", () => {
  const deck = [testCard("only1"), testCard("only2")];
  const match = createMatch("alice", deck, "bob", deck);
  assert.equal(match.boards["alice"]!.hand.length, 2);
  assert.equal(match.boards["alice"]!.library.length, 0);
});

test("drawCard moves the top of the library into hand, and errors once the library is empty", () => {
  const deck = [testCard("a"), testCard("b")];
  const match = createMatch("alice", deck, "bob", deck);
  const board = match.boards["alice"]!;
  board.library = [{ instanceId: "lib1", card: testCard("top") }];
  board.hand = [];

  drawCard(match, "alice");
  assert.equal(board.hand.length, 1);
  assert.equal(board.hand[0]!.card!.scryfallId, "top");
  assert.equal(board.library.length, 0);

  assert.throws(() => drawCard(match, "alice"), /empty/);
});

test("shuffleLibrary reorders without changing membership", () => {
  const deck = Array.from({ length: 20 }, (_, i) => testCard(`c${i}`));
  const match = createMatch("alice", deck, "bob", deck);
  const board = match.boards["alice"]!;
  const before = board.library.map((c) => c.instanceId).sort();

  shuffleLibrary(match, "alice");

  assert.deepEqual(
    board.library.map((c) => c.instanceId).sort(),
    before
  );
});

test("mulligan shuffles the hand back into the library and deals a fresh 7", () => {
  const deck = Array.from({ length: 10 }, (_, i) => testCard(`d${i}`));
  const match = createMatch("alice", deck, "bob", deck);
  const board = match.boards["alice"]!;
  const allIdsBefore = [...board.hand, ...board.library].map((c) => c.instanceId).sort();

  mulligan(match, "alice");

  assert.equal(board.hand.length, 7);
  assert.equal(board.library.length, 3);
  assert.deepEqual(
    [...board.hand, ...board.library].map((c) => c.instanceId).sort(),
    allIdsBefore
  );
});

test("moveCard relocates a card between zones and clears battlefield-only state on leaving the battlefield", () => {
  const deck = [testCard("a")];
  const match = createMatch("alice", deck, "bob", deck);
  const board = match.boards["alice"]!;
  const card = board.hand[0]!;

  moveCard(match, "alice", card.instanceId, "battlefield");
  assert.equal(board.hand.length, 0);
  assert.equal(board.battlefield.length, 1);
  assert.equal(board.battlefield[0]!.tapped, false);

  board.battlefield[0]!.tapped = true;
  board.battlefield[0]!.counters = { "+1/+1": 2 };

  moveCard(match, "alice", card.instanceId, "graveyard");
  assert.equal(board.battlefield.length, 0);
  assert.equal(board.graveyard.length, 1);
  assert.equal(board.graveyard[0]!.tapped, undefined);
  assert.equal(board.graveyard[0]!.counters, undefined);
  assert.equal(board.graveyard[0]!.row, undefined);
  assert.equal(board.graveyard[0]!.stackId, undefined);
});

test("moveCard can place a card on the top (default) or bottom of the library", () => {
  const deck = [testCard("a"), testCard("b")];
  const match = createMatch("alice", deck, "bob", deck);
  const board = match.boards["alice"]!;
  board.library = [{ instanceId: "existing", card: testCard("existing") }];
  const [first, second] = board.hand;

  moveCard(match, "alice", first!.instanceId, "library");
  assert.equal(board.library[0]!.instanceId, first!.instanceId);

  moveCard(match, "alice", second!.instanceId, "library", "bottom");
  assert.equal(board.library[board.library.length - 1]!.instanceId, second!.instanceId);
});

test("moveCard rejects a card that isn't in the caller's own hand/battlefield/graveyard/exile", () => {
  const deck = [testCard("a")];
  const match = createMatch("alice", deck, "bob", deck);
  const bobCardId = match.boards["bob"]!.hand[0]!.instanceId;

  assert.throws(() => moveCard(match, "alice", bobCardId, "battlefield"), /not found/i);
  assert.equal(match.boards["bob"]!.hand.length, 1);
});

test("moveCard clears faceDown when a card leaves the battlefield", () => {
  const deck = [testCard("a")];
  const match = createMatch("alice", deck, "bob", deck);
  const board = match.boards["alice"]!;
  const handCard = board.hand[0]!;
  moveCard(match, "alice", handCard.instanceId, "battlefield");
  flipFaceDown(match, "alice", handCard.instanceId, true);
  assert.equal(board.battlefield[0]!.faceDown, true);

  moveCard(match, "alice", handCard.instanceId, "graveyard");
  assert.equal(board.graveyard[0]!.faceDown, undefined);
});

test("tapCard toggles the tapped state of a battlefield card, and rejects a card not on the battlefield", () => {
  const deck = [testCard("a")];
  const match = createMatch("alice", deck, "bob", deck);
  const board = match.boards["alice"]!;
  const handCard = board.hand[0]!;
  moveCard(match, "alice", handCard.instanceId, "battlefield");

  tapCard(match, "alice", handCard.instanceId, true);
  assert.equal(board.battlefield[0]!.tapped, true);
  tapCard(match, "alice", handCard.instanceId, false);
  assert.equal(board.battlefield[0]!.tapped, false);

  assert.throws(() => tapCard(match, "alice", "nonexistent", true), /not found/i);
});

test("untapAll untaps every one of the caller's own battlefield cards", () => {
  const deck = [testCard("a"), testCard("b")];
  const match = createMatch("alice", deck, "bob", deck);
  const board = match.boards["alice"]!;
  for (const card of [...board.hand]) moveCard(match, "alice", card.instanceId, "battlefield");
  for (const card of board.battlefield) card.tapped = true;

  untapAll(match, "alice");
  assert.ok(board.battlefield.every((c) => c.tapped === false));
});

test("setCardCounter accumulates and removes the counter once it reaches zero", () => {
  const deck = [testCard("a")];
  const match = createMatch("alice", deck, "bob", deck);
  const board = match.boards["alice"]!;
  const handCard = board.hand[0]!;
  moveCard(match, "alice", handCard.instanceId, "battlefield");

  setCardCounter(match, "alice", handCard.instanceId, "+1/+1", 2);
  assert.equal(board.battlefield[0]!.counters!["+1/+1"], 2);

  setCardCounter(match, "alice", handCard.instanceId, "+1/+1", 1);
  assert.equal(board.battlefield[0]!.counters!["+1/+1"], 3);

  setCardCounter(match, "alice", handCard.instanceId, "+1/+1", -3);
  assert.equal(board.battlefield[0]!.counters!["+1/+1"], undefined);
});

test("setBattlefieldSlot moves a card to a row, can merge it into another card's stack, and rejects a card not on the battlefield", () => {
  const deck = [testCard("a"), testCard("b")];
  const match = createMatch("alice", deck, "bob", deck);
  const board = match.boards["alice"]!;
  const [first, second] = board.hand;
  moveCard(match, "alice", first!.instanceId, "battlefield");
  moveCard(match, "alice", second!.instanceId, "battlefield");

  setBattlefieldSlot(match, "alice", first!.instanceId, 1);
  assert.equal(board.battlefield.find((c) => c.instanceId === first!.instanceId)!.row, 1);
  assert.equal(board.battlefield.find((c) => c.instanceId === first!.instanceId)!.stackId, first!.instanceId);

  setBattlefieldSlot(match, "alice", second!.instanceId, 1, first!.instanceId);
  const merged = board.battlefield.find((c) => c.instanceId === second!.instanceId)!;
  assert.equal(merged.row, 1);
  assert.equal(merged.stackId, first!.instanceId);
  assert.equal(board.battlefield[board.battlefield.length - 1]!.instanceId, second!.instanceId);

  assert.throws(() => setBattlefieldSlot(match, "alice", "nope", 0), /not found/i);
});

test("flipFaceDown toggles the face-down flag on a battlefield card", () => {
  const deck = [testCard("a")];
  const match = createMatch("alice", deck, "bob", deck);
  const board = match.boards["alice"]!;
  const handCard = board.hand[0]!;
  moveCard(match, "alice", handCard.instanceId, "battlefield");

  flipFaceDown(match, "alice", handCard.instanceId, true);
  assert.equal(board.battlefield[0]!.faceDown, true);
  flipFaceDown(match, "alice", handCard.instanceId, false);
  assert.equal(board.battlefield[0]!.faceDown, false);
});

test("createToken adds a labeled, non-card token directly to the battlefield", () => {
  const deck = [testCard("a")];
  const match = createMatch("alice", deck, "bob", deck);
  const board = match.boards["alice"]!;

  createToken(match, "alice", "  1/1 Soldier  ");
  assert.equal(board.battlefield.length, 1);
  const token = board.battlefield[0]!;
  assert.equal(token.card, null);
  assert.equal(token.tokenLabel, "1/1 Soldier");
  assert.equal(token.tapped, false);

  assert.throws(() => createToken(match, "alice", "   "), /label/i);
});

test("deleteToken removes a token permanently but rejects a real drafted card", () => {
  const deck = [testCard("a")];
  const match = createMatch("alice", deck, "bob", deck);
  const board = match.boards["alice"]!;
  createToken(match, "alice", "1/1 Soldier");
  const token = board.battlefield[0]!;
  const realCard = board.hand[0]!;
  moveCard(match, "alice", realCard.instanceId, "battlefield");

  assert.throws(() => deleteToken(match, "alice", realCard.instanceId), /only tokens/i);
  assert.equal(board.battlefield.length, 2);

  deleteToken(match, "alice", token.instanceId);
  assert.equal(board.battlefield.length, 1);
  assert.equal(board.battlefield[0]!.instanceId, realCard.instanceId);

  assert.throws(() => deleteToken(match, "alice", "nope"), /not found/i);
});

test("peekLibrary reveals the top N cards without removing them, clamped to the library's size", () => {
  const deck = Array.from({ length: 10 }, (_, i) => testCard(`p${i}`));
  const match = createMatch("alice", deck, "bob", deck);
  const board = match.boards["alice"]!;
  const librarySizeBefore = board.library.length;

  const peeked = peekLibrary(match, "alice", 2);
  assert.equal(peeked.length, 2);
  assert.deepEqual(
    peeked.map((c) => c.instanceId),
    board.library.slice(0, 2).map((c) => c.instanceId)
  );
  assert.equal(board.library.length, librarySizeBefore, "peeking must not remove anything");

  const peekedAll = peekLibrary(match, "alice", 1000);
  assert.equal(peekedAll.length, librarySizeBefore, "count is clamped to the library's actual size");
});

test("a peeked library card can be moved out via the ordinary moveCard primitive", () => {
  const deck = [testCard("a"), testCard("b")];
  const match = createMatch("alice", deck, "bob", deck);
  const board = match.boards["alice"]!;
  board.hand = [];
  board.library = [{ instanceId: "lib1", card: testCard("top") }];

  const [peeked] = peekLibrary(match, "alice", 1);
  moveCard(match, "alice", peeked!.instanceId, "hand");

  assert.equal(board.library.length, 0);
  assert.equal(board.hand.length, 1);
  assert.equal(board.hand[0]!.instanceId, "lib1");
});

test("findOwnCard locates a card in any of the caller's own zones, including the library, and rejects the opponent's cards", () => {
  const deck = [testCard("a")];
  const match = createMatch("alice", deck, "bob", deck);
  const aliceHandCard = match.boards["alice"]!.hand[0]!;
  const bobHandCard = match.boards["bob"]!.hand[0]!;

  assert.equal(findOwnCard(match, "alice", aliceHandCard.instanceId), aliceHandCard);
  assert.throws(() => findOwnCard(match, "alice", bobHandCard.instanceId), /not found/i);
});

test("setPlayerCounter accumulates and never removes the counter, even at zero", () => {
  const deck = [testCard("a")];
  const match = createMatch("alice", deck, "bob", deck);
  const board = match.boards["alice"]!;
  assert.equal(board.counters["life"], 20);

  setPlayerCounter(match, "alice", "life", -20);
  assert.equal(board.counters["life"], 0);

  setPlayerCounter(match, "alice", "poison", 3);
  assert.equal(board.counters["poison"], 3);
});

test("rollDie returns a value within range and rejects fewer than 2 sides", () => {
  for (let i = 0; i < 20; i++) {
    const result = rollDie(6);
    assert.ok(result >= 1 && result <= 6);
  }
  assert.throws(() => rollDie(1), /sides/i);
});
