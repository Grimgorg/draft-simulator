import assert from "node:assert/strict";
import test from "node:test";
import type { Player } from "@draft-simulator/shared";
import { createDraftSession, type DraftSession } from "./draftEngine.js";
import { testCard, testPack } from "./testHelpers.js";
import {
  beginWinstonDraft,
  buildWinstonPile,
  buildWinstonTableView,
  passPile,
  startWinstonDraft,
  takePile,
} from "./winstonDraft.js";

const players: Player[] = [
  { id: "A", name: "Alice", connected: true },
  { id: "B", name: "Bob", connected: true },
];

function winstonSession(playerList: Player[] = players): DraftSession {
  return createDraftSession(
    "winston-1",
    { cubeId: "x", format: "winston", packCount: 1, packSize: 4, alternatingDraft: false },
    playerList.map((p) => ({ ...p }))
  );
}

/** A Winston draft whose stack is `ids`, top card first. */
function begin(ids: string[]): DraftSession {
  return beginWinstonDraft(winstonSession(), ids.map(testCard));
}

function ids(cards: { scryfallId: string }[] | null | undefined): string[] {
  return (cards ?? []).map((c) => c.scryfallId);
}

function piles(session: DraftSession): string[][] {
  return session.winston!.piles.map(ids);
}

test("starts with three one-card piles from the top of the stack and the first player looking at pile 1", () => {
  const session = begin(["c1", "c2", "c3", "c4", "c5"]);

  assert.equal(session.status, "drafting");
  assert.deepEqual(piles(session), [["c1"], ["c2"], ["c3"]]);
  assert.deepEqual(ids(session.winston!.stack), ["c4", "c5"]);
  assert.deepEqual(session.waitingOn, ["A"]);
  assert.deepEqual(ids(buildWinstonPile(session, "A")), ["c1"]);
  assert.equal(buildWinstonPile(session, "B"), null, "only the active player sees a pile");
});

test("taking a pile gives the player all of it, starts it again from the stack and ends the turn", () => {
  const session = begin(["c1", "c2", "c3", "c4", "c5", "c6"]);
  passPile(session, "A", 0);

  assert.equal(takePile(session, "A", 1), "turnEnded");
  assert.deepEqual(ids(session.pools["A"]), ["c2"]);
  assert.deepEqual(piles(session), [["c1", "c4"], ["c5"], ["c3"]]);
  assert.deepEqual(session.waitingOn, ["B"]);
  assert.equal(session.winston!.pileIndex, 0, "the next player starts at pile 1");
  assert.deepEqual(ids(buildWinstonPile(session, "B")), ["c1", "c4"]);
  assert.equal(buildWinstonPile(session, "A"), null);
});

test("passing a pile adds the stack's top card to it and moves on to the next pile", () => {
  const session = begin(["c1", "c2", "c3", "c4", "c5", "c6"]);

  assert.equal(passPile(session, "A", 0), "nextPile");
  assert.deepEqual(piles(session), [["c1", "c4"], ["c2"], ["c3"]]);
  assert.equal(session.winston!.pileIndex, 1);
  assert.deepEqual(ids(buildWinstonPile(session, "A")), ["c2"]);
  assert.deepEqual(session.waitingOn, ["A"], "still the same player's turn");
});

test("passing all three piles grows each of them and gives the player the stack's next card", () => {
  const session = begin(["c1", "c2", "c3", "c4", "c5", "c6", "c7", "c8"]);
  passPile(session, "A", 0);
  passPile(session, "A", 1);

  assert.equal(passPile(session, "A", 2), "turnEnded");
  assert.deepEqual(piles(session), [["c1", "c4"], ["c2", "c5"], ["c3", "c6"]]);
  assert.deepEqual(ids(session.pools["A"]), ["c7"]);
  assert.deepEqual(ids(session.winston!.stack), ["c8"]);
  assert.deepEqual(session.waitingOn, ["B"]);
});

test("records a pick per card, numbered by turn", () => {
  const session = begin(["c1", "c2", "c3", "c4", "c5", "c6"]);
  passPile(session, "A", 0);
  takePile(session, "A", 1);
  takePile(session, "B", 0);

  assert.deepEqual(
    session.picks.map((p) => [p.playerId, p.pickNumber, p.scryfallId]),
    [
      ["A", 1, "c2"],
      ["B", 2, "c1"],
      ["B", 2, "c4"],
    ]
  );
});

test("with one stack card left, passing the last pile draws it instead of adding it to the pile", () => {
  const session = begin(["c1", "c2", "c3", "c4", "c5", "c6"]);
  passPile(session, "A", 0);
  passPile(session, "A", 1);

  assert.equal(passPile(session, "A", 2), "turnEnded");
  assert.deepEqual(piles(session), [["c1", "c4"], ["c2", "c5"], ["c3"]]);
  assert.deepEqual(ids(session.pools["A"]), ["c6"]);
  assert.deepEqual(session.winston!.stack, []);
});

test("once the stack is empty, passing adds nothing, empty piles are skipped and the last pile must be taken", () => {
  const session = begin(["c1", "c2", "c3"]);

  assert.equal(passPile(session, "A", 0), "nextPile");
  assert.deepEqual(piles(session), [["c1"], ["c2"], ["c3"]], "an empty stack has nothing to add");
  takePile(session, "A", 1);
  assert.deepEqual(piles(session), [["c1"], [], ["c3"]], "an empty stack can't start the pile again");

  passPile(session, "B", 0);
  assert.equal(session.winston!.pileIndex, 2, "the empty pile 2 is skipped");
  assert.equal(buildWinstonTableView(session)!.canPass, false);
  assert.throws(() => passPile(session, "B", 2), /take it/);
  takePile(session, "B", 2);

  // Only pile 1 is left, so A starts and must stop there.
  assert.equal(session.winston!.pileIndex, 0);
  assert.equal(buildWinstonTableView(session)!.canPass, false);
  assert.throws(() => passPile(session, "A", 0), /take it/);
});

test("ends when the stack and every pile are empty, with every card in exactly one pool", () => {
  const stack = Array.from({ length: 20 }, (_, i) => `c${i + 1}`);
  const session = begin(stack);

  // Alternate between passing everything and taking a pile, so both kinds of turn come up.
  let outcome;
  for (let action = 0; session.status === "drafting"; action++) {
    const view = buildWinstonTableView(session)!;
    const player = view.activePlayerId;
    outcome =
      view.canPass && action % 3 !== 2
        ? passPile(session, player, view.pileIndex)
        : takePile(session, player, view.pileIndex);
    assert.ok(action < 100, "the draft must end");
  }

  assert.equal(outcome, "draftComplete");
  assert.equal(session.status, "complete");
  assert.deepEqual(session.waitingOn, []);
  assert.equal(buildWinstonTableView(session), undefined);
  assert.deepEqual([...ids(session.pools["A"]), ...ids(session.pools["B"])].sort(), [...stack].sort());
});

test("refuses actions out of turn, on another pile than the one looked at, or after the draft", () => {
  const session = begin(["c1", "c2", "c3", "c4"]);

  assert.throws(() => takePile(session, "B", 0), /not your turn/);
  assert.throws(() => passPile(session, "B", 0), /not your turn/);
  assert.throws(() => takePile(session, "A", 1), /looking at pile 1, not pile 2/);
  assert.throws(() => takePile(session, "Z", 0), /not your turn/);

  takePile(session, "A", 0);
  takePile(session, "B", 0);
  takePile(session, "A", 1);
  assert.equal(takePile(session, "B", 2), "draftComplete");
  assert.throws(() => takePile(session, "A", 0), /status is "complete"/);
});

test("needs exactly two players and at least three cards", () => {
  assert.throws(() => beginWinstonDraft(winstonSession(players.slice(0, 1)), ["c1", "c2", "c3"].map(testCard)), /exactly 2/);
  const three = [...players, { id: "C", name: "Cara", connected: true }];
  assert.throws(() => beginWinstonDraft(winstonSession(three), ["c1", "c2", "c3"].map(testCard)), /exactly 2/);
  assert.throws(() => beginWinstonDraft(winstonSession(), ["c1", "c2"].map(testCard)), /at least 3 cards/);
});

test("shuffles every pack's cards into one stack", () => {
  const session = startWinstonDraft(winstonSession(), [
    [testPack("p1", 1, ["a1", "a2"]), testPack("p2", 1, ["b1", "b2"])],
    [testPack("p3", 2, ["a3", "a4"]), testPack("p4", 2, ["b3", "b4"])],
  ]);

  const table = session.winston!;
  assert.deepEqual(
    [...table.piles.flat(), ...table.stack].map((c) => c.scryfallId).sort(),
    ["a1", "a2", "a3", "a4", "b1", "b2", "b3", "b4"]
  );
  assert.equal(table.stack.length, 5);
});
