import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { testCard } from "../draftEngine/testHelpers.js";
import * as lobbyManager from "./lobbyManager.js";
import { buildDraftSummaries, buildLobbyStateView } from "./lobbyStateView.js";

function freshSnapshotPath(): string {
  return path.join(os.tmpdir(), `draft-simulator-view-test-${Date.now()}-${Math.random().toString(36).slice(2)}.json`);
}

const secretCards = ["secret-1", "secret-2", "secret-3", "secret-4"].map(testCard);
const cubeSettings = { cubeId: "test", packCount: 1, packSize: 2, alternatingDraft: true };

test("a draft that doesn't exist has no view, and an empty server lists no drafts", () => {
  lobbyManager.resetForTests(freshSnapshotPath());

  assert.equal(buildLobbyStateView("no-such-draft"), undefined);
  assert.deepEqual(buildDraftSummaries(), []);
});

test("a waiting lobby shows the table, cube and creator but no turn information", () => {
  lobbyManager.resetForTests(freshSnapshotPath());
  const { draftId } = lobbyManager.createLobbyFromResolvedCube("Test Cube", secretCards, ["Missing Card"], cubeSettings);
  const alice = lobbyManager.addPlayer(draftId, "Alice");
  lobbyManager.addPlayer(draftId, "Bob");

  const view = buildLobbyStateView(draftId)!;

  assert.equal(view.status, "lobby");
  assert.equal(view.sessionId, draftId);
  assert.equal(view.creatorPlayerId, alice.id, "the first player seated created it");
  assert.deepEqual(view.players.map((p) => p.name), ["Alice", "Bob"]);
  assert.equal(view.cubeName, "Test Cube");
  assert.equal(view.cardCount, 4);
  assert.deepEqual(view.unresolvedCardNames, ["Missing Card"]);
  assert.equal(view.currentPackNumber, undefined);
  assert.equal(view.waitingOn, undefined);
});

test("while drafting, the public view says whose turn it is but carries no pack, pool or pick contents", () => {
  lobbyManager.resetForTests(freshSnapshotPath());
  const { draftId } = lobbyManager.createLobbyFromResolvedCube("Test Cube", secretCards, [], cubeSettings);
  const host = lobbyManager.addPlayer(draftId, "Alice");
  const bob = lobbyManager.addPlayer(draftId, "Bob");
  lobbyManager.beginDraft(draftId);
  const session = lobbyManager.getSession(draftId)!;
  lobbyManager.pick(draftId, host.id, session.currentPacks[host.id]!.cards[0]!.scryfallId);

  const view = buildLobbyStateView(draftId)!;

  assert.equal(view.status, "drafting");
  assert.equal(view.currentPackNumber, 1);
  assert.equal(view.currentPickNumber, 1);
  assert.deepEqual(view.waitingOn, [bob.id]);
  const wire = JSON.stringify(view);
  for (const card of secretCards) {
    assert.ok(!wire.includes(card.scryfallId), `lobby:state leaked ${card.scryfallId}`);
  }
});

test("the draft list shows every draft, newest first, without any pack, pool or pick contents", () => {
  lobbyManager.resetForTests(freshSnapshotPath());
  const first = lobbyManager.createLobbyFromResolvedCube("First Cube", secretCards, [], cubeSettings);
  const alice = lobbyManager.addPlayer(first.draftId, "Alice");
  lobbyManager.addPlayer(first.draftId, "Bob");
  lobbyManager.beginDraft(first.draftId);
  const session = lobbyManager.getSession(first.draftId)!;
  lobbyManager.pick(first.draftId, alice.id, session.currentPacks[alice.id]!.cards[0]!.scryfallId);
  const second = lobbyManager.createLobbyFromResolvedCube("Second Cube", [], [], cubeSettings);

  const summaries = buildDraftSummaries();

  assert.deepEqual(
    summaries.map((s) => [s.draftId, s.cubeName, s.status, s.players.length]),
    [
      [second.draftId, "Second Cube", "lobby", 0],
      [first.draftId, "First Cube", "drafting", 2],
    ]
  );
  assert.equal(summaries[1]!.creatorPlayerId, alice.id);
  assert.equal(summaries[0]!.creatorPlayerId, undefined, "no one has joined it yet");
  const wire = JSON.stringify(summaries);
  for (const card of secretCards) {
    assert.ok(!wire.includes(card.scryfallId), `drafts:list leaked ${card.scryfallId}`);
  }
});

test("a Winston draft's public view shows the table's sizes and whose turn it is, never its cards", () => {
  lobbyManager.resetForTests(freshSnapshotPath());
  const { draftId } = lobbyManager.createLobbyFromResolvedCube("Test Cube", secretCards, [], {
    cubeId: "test",
    format: "winston",
    packCount: 1,
    packSize: 2,
    alternatingDraft: false,
  });
  const alice = lobbyManager.addPlayer(draftId, "Alice");
  lobbyManager.addPlayer(draftId, "Bob");
  lobbyManager.beginDraft(draftId);
  lobbyManager.passWinstonPile(draftId, alice.id, 0);

  const view = buildLobbyStateView(draftId)!;

  assert.deepEqual(view.winston, {
    activePlayerId: alice.id,
    pileIndex: 1,
    pileSizes: [2, 1, 1],
    stackCount: 0,
    canPass: true,
  });
  assert.deepEqual(view.waitingOn, [alice.id]);
  assert.equal(view.currentPackNumber, undefined, "a Winston draft has no packs to number");
  const wire = JSON.stringify(view);
  for (const card of secretCards) {
    assert.ok(!wire.includes(card.scryfallId), `lobby:state leaked ${card.scryfallId}`);
  }
});
