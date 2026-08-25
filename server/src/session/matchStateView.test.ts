import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { testCard } from "../draftEngine/testHelpers.js";
import { createMatch, flipFaceDown, moveCard } from "./gameEngine.js";
import * as lobbyManager from "./lobbyManager.js";
import { buildMatchStateView } from "./matchStateView.js";

function freshSnapshotPath(): string {
  return path.join(os.tmpdir(), `draft-simulator-test-${Date.now()}-${Math.random().toString(36).slice(2)}.json`);
}

test("opponent's view never includes hand or library card contents", () => {
  lobbyManager.resetForTests(freshSnapshotPath());
  const deck = Array.from({ length: 10 }, (_, i) => testCard(`c${i}`));
  const match = createMatch("alice", deck, "bob", deck);

  const aliceView = buildMatchStateView(match, "alice");
  assert.ok(aliceView.me.hand.cards, "own hand should include cards");
  assert.equal(aliceView.opponent.hand.cards, undefined, "opponent's hand cards must never be sent");
  assert.equal(aliceView.opponent.hand.count, match.boards["bob"]!.hand.length);
  assert.equal(aliceView.me.library.cards, undefined, "library contents are secret even from the owner");
  assert.equal(aliceView.opponent.library.cards, undefined);
});

test("a face-down battlefield card hides its identity from the opponent but not from its owner", () => {
  lobbyManager.resetForTests(freshSnapshotPath());
  const deck = [testCard("a")];
  const match = createMatch("alice", deck, "bob", deck);
  const handCard = match.boards["alice"]!.hand[0]!;
  moveCard(match, "alice", handCard.instanceId, "battlefield");
  flipFaceDown(match, "alice", handCard.instanceId, true);

  const aliceView = buildMatchStateView(match, "alice");
  const bobView = buildMatchStateView(match, "bob");

  const ownCard = aliceView.me.battlefield[0]!;
  assert.equal(ownCard.card?.scryfallId, "a");

  const opponentCard = bobView.opponent.battlefield[0]!;
  assert.equal(opponentCard.card, null);
  assert.equal(opponentCard.tokenLabel, undefined);
  assert.equal(opponentCard.instanceId, handCard.instanceId, "the card still visibly exists, just its identity is hidden");
});
