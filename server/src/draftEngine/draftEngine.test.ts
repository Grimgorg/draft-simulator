import assert from "node:assert/strict";
import test from "node:test";
import type { Pack, Player } from "@draft-simulator/shared";
import { beginDraftWithPacks, createDraftSession, submitPick } from "./draftEngine.js";
import { testPack } from "./testHelpers.js";

const players: Player[] = [
  { id: "A", name: "Alice", isHost: true, connected: true },
  { id: "B", name: "Bob", isHost: false, connected: true },
  { id: "C", name: "Cara", isHost: false, connected: true },
];

function seededQueue(): Pack[][] {
  return [
    [testPack("pA1", 1, ["a1", "a2"]), testPack("pB1", 1, ["b1", "b2"]), testPack("pC1", 1, ["c1", "c2"])],
    [testPack("pA2", 2, ["a3", "a4"]), testPack("pB2", 2, ["b3", "b4"]), testPack("pC2", 2, ["c3", "c4"])],
  ];
}

function idsIn(session: ReturnType<typeof createDraftSession>, playerId: string): string[] {
  return session.currentPacks[playerId]!.cards.map((c) => c.scryfallId);
}

test("runs a full draft with alternating pass direction and produces correct final pools", () => {
  const session = createDraftSession("draft-1", { cubeId: "x", packCount: 2, packSize: 2, playerCount: 3, alternatingDraft: true }, players);
  beginDraftWithPacks(session, seededQueue());

  assert.equal(session.status, "drafting");
  assert.equal(session.currentPackNumber, 1);
  assert.equal(session.currentPickNumber, 1);
  assert.deepEqual(session.waitingOn.slice().sort(), ["A", "B", "C"]);

  // Pack 1, pick 1: everyone takes the first card of their own pack.
  submitPick(session, "A", "a1");
  submitPick(session, "B", "b1");
  submitPick(session, "C", "c1");

  // Pack 1 passes one direction: A now holds what was C's pack.
  assert.equal(session.currentPickNumber, 2);
  assert.deepEqual(idsIn(session, "A"), ["c2"]);
  assert.deepEqual(idsIn(session, "B"), ["a2"]);
  assert.deepEqual(idsIn(session, "C"), ["b2"]);

  // Pack 1, pick 2: last card of pack 1 — empties it and deals pack 2.
  submitPick(session, "A", "c2");
  submitPick(session, "B", "a2");
  submitPick(session, "C", "b2");

  assert.equal(session.currentPackNumber, 2);
  assert.equal(session.currentPickNumber, 1);
  assert.deepEqual(idsIn(session, "A"), ["a3", "a4"]);

  // Pack 2, pick 1.
  submitPick(session, "A", "a3");
  submitPick(session, "B", "b3");
  submitPick(session, "C", "c3");

  // Pack 2 passes the *other* direction: A now holds what was B's pack.
  assert.deepEqual(idsIn(session, "A"), ["b4"]);
  assert.deepEqual(idsIn(session, "B"), ["c4"]);
  assert.deepEqual(idsIn(session, "C"), ["a4"]);

  // Pack 2, pick 2: draft completes.
  submitPick(session, "A", "b4");
  submitPick(session, "B", "c4");
  submitPick(session, "C", "a4");

  assert.equal(session.status, "complete");
  assert.deepEqual(session.currentPacks, {});
  assert.equal(session.picks.length, 12);

  assert.deepEqual(
    session.pools["A"]!.map((c) => c.scryfallId),
    ["a1", "c2", "a3", "b4"]
  );
  assert.deepEqual(
    session.pools["B"]!.map((c) => c.scryfallId),
    ["b1", "a2", "b3", "c4"]
  );
  assert.deepEqual(
    session.pools["C"]!.map((c) => c.scryfallId),
    ["c1", "b2", "c3", "a4"]
  );
});

test("with alternatingDraft off, every pack passes the same direction", () => {
  const session = createDraftSession(
    "draft-5",
    { cubeId: "x", packCount: 2, packSize: 2, playerCount: 3, alternatingDraft: false },
    players
  );
  beginDraftWithPacks(session, seededQueue());

  // Pack 1, pick 1.
  submitPick(session, "A", "a1");
  submitPick(session, "B", "b1");
  submitPick(session, "C", "c1");

  // Pack 1 passes one direction: A now holds what was C's pack.
  assert.deepEqual(idsIn(session, "A"), ["c2"]);
  assert.deepEqual(idsIn(session, "B"), ["a2"]);
  assert.deepEqual(idsIn(session, "C"), ["b2"]);

  // Pack 1, pick 2: empties pack 1 and deals pack 2.
  submitPick(session, "A", "c2");
  submitPick(session, "B", "a2");
  submitPick(session, "C", "b2");

  // Pack 2, pick 1.
  submitPick(session, "A", "a3");
  submitPick(session, "B", "b3");
  submitPick(session, "C", "c3");

  // Pack 2 passes the *same* direction as pack 1: A again holds what was C's pack.
  assert.deepEqual(idsIn(session, "A"), ["c4"]);
  assert.deepEqual(idsIn(session, "B"), ["a4"]);
  assert.deepEqual(idsIn(session, "C"), ["b4"]);
});

test("each pick reports whether the round is still open, advanced, or finished the draft", () => {
  const session = createDraftSession("draft-outcomes", { cubeId: "x", packCount: 2, packSize: 2, playerCount: 3, alternatingDraft: true }, players);
  beginDraftWithPacks(session, seededQueue());

  // Pack 1, pick 1: the last pick of the round passes the packs.
  assert.equal(submitPick(session, "A", "a1"), "waitingOnOthers");
  assert.equal(submitPick(session, "B", "b1"), "waitingOnOthers");
  assert.equal(submitPick(session, "C", "c1"), "roundAdvanced");

  // Pack 1, pick 2: emptying pack 1 opens pack 2, which also counts as the round advancing.
  assert.equal(submitPick(session, "A", "c2"), "waitingOnOthers");
  assert.equal(submitPick(session, "B", "a2"), "waitingOnOthers");
  assert.equal(submitPick(session, "C", "b2"), "roundAdvanced");
  assert.equal(session.currentPackNumber, 2);

  // Pack 2: the final pick of the final pack completes the draft.
  submitPick(session, "A", "a3");
  submitPick(session, "B", "b3");
  submitPick(session, "C", "c3");
  assert.equal(submitPick(session, "A", "b4"), "waitingOnOthers");
  assert.equal(submitPick(session, "B", "c4"), "waitingOnOthers");
  assert.equal(submitPick(session, "C", "a4"), "draftComplete");
  assert.equal(session.status, "complete");
});

test("rejects a pick from a player who already picked this round", () => {
  const session = createDraftSession(
    "draft-2",
    { cubeId: "x", packCount: 1, packSize: 1, playerCount: 2, alternatingDraft: true },
    players.slice(0, 2)
  );
  beginDraftWithPacks(session, [[testPack("pA", 1, ["a1"]), testPack("pB", 1, ["b1"])]]);

  submitPick(session, "A", "a1");
  assert.throws(() => submitPick(session, "A", "a1"), /already picked/);
});

test("rejects picking a card that isn't in the player's current pack", () => {
  const session = createDraftSession(
    "draft-3",
    { cubeId: "x", packCount: 1, packSize: 1, playerCount: 2, alternatingDraft: true },
    players.slice(0, 2)
  );
  beginDraftWithPacks(session, [[testPack("pA", 1, ["a1"]), testPack("pB", 1, ["b1"])]]);

  assert.throws(() => submitPick(session, "A", "b1"), /not in player/);
});

test("rejects starting a draft twice", () => {
  const session = createDraftSession(
    "draft-4",
    { cubeId: "x", packCount: 1, packSize: 1, playerCount: 2, alternatingDraft: true },
    players.slice(0, 2)
  );
  beginDraftWithPacks(session, [[testPack("pA", 1, ["a1"]), testPack("pB", 1, ["b1"])]]);

  assert.throws(() => beginDraftWithPacks(session, [[testPack("pA2", 1, ["a2"]), testPack("pB2", 1, ["b2"])]]));
});

test("a pack holding two copies of the same card lets both copies be drafted, one at a time", () => {
  // Cubes can run duplicates (e.g. two of each fetchland), and both copies
  // share one scryfallId — a pick must take exactly one copy, never both or
  // neither, and the other copy must stay draftable as the pack moves on.
  const session = createDraftSession(
    "draft-dupes",
    { cubeId: "x", packCount: 1, packSize: 3, playerCount: 2, alternatingDraft: true },
    players.slice(0, 2)
  );
  beginDraftWithPacks(session, [[testPack("pA", 1, ["tarn", "tarn", "a1"]), testPack("pB", 1, ["b1", "b2", "b3"])]]);

  submitPick(session, "A", "tarn");
  submitPick(session, "B", "b1");
  // A's pack (one tarn left) has passed to B.
  assert.deepEqual(idsIn(session, "B"), ["tarn", "a1"]);

  submitPick(session, "A", "b2");
  submitPick(session, "B", "tarn");
  assert.deepEqual(idsIn(session, "A"), ["a1"]);
  assert.throws(() => submitPick(session, "A", "tarn"), /not in player/, "no third copy to pick");

  submitPick(session, "A", "a1");
  submitPick(session, "B", "b3");
  assert.equal(session.status, "complete");
  assert.deepEqual(session.pools["A"]!.map((c) => c.scryfallId), ["tarn", "b2", "a1"]);
  assert.deepEqual(session.pools["B"]!.map((c) => c.scryfallId), ["b1", "tarn", "b3"]);
});
