import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { testCard } from "../draftEngine/testHelpers.js";
import * as lobbyManager from "./lobbyManager.js";
import { buildLobbyStateView } from "./lobbyStateView.js";

function freshSnapshotPath(): string {
  return path.join(os.tmpdir(), `draft-simulator-view-test-${Date.now()}-${Math.random().toString(36).slice(2)}.json`);
}

const secretCards = ["secret-1", "secret-2", "secret-3", "secret-4"].map(testCard);

test("with no lobby, the view is empty", () => {
  lobbyManager.resetForTests(freshSnapshotPath());

  assert.deepEqual(buildLobbyStateView(), { status: "empty", players: [] });
});

test("a waiting lobby shows the table and cube but no turn information", () => {
  lobbyManager.resetForTests(freshSnapshotPath());
  lobbyManager.createLobbyFromResolvedCube("Test Cube", secretCards, ["Missing Card"], {
    cubeId: "test",
    packCount: 1,
    packSize: 2,
    alternatingDraft: true,
  });
  lobbyManager.addPlayer("Alice");

  const view = buildLobbyStateView();

  assert.equal(view.status, "lobby");
  assert.deepEqual(view.players.map((p) => p.name), ["Alice"]);
  assert.equal(view.cubeName, "Test Cube");
  assert.equal(view.cardCount, 4);
  assert.deepEqual(view.unresolvedCardNames, ["Missing Card"]);
  assert.equal(view.currentPackNumber, undefined);
  assert.equal(view.waitingOn, undefined);
});

test("while drafting, the public view says whose turn it is but carries no pack, pool or pick contents", () => {
  lobbyManager.resetForTests(freshSnapshotPath());
  lobbyManager.createLobbyFromResolvedCube("Test Cube", secretCards, [], {
    cubeId: "test",
    packCount: 1,
    packSize: 2,
    alternatingDraft: true,
  });
  const host = lobbyManager.addPlayer("Alice");
  const bob = lobbyManager.addPlayer("Bob");
  lobbyManager.beginDraft();
  lobbyManager.pick(host.id, lobbyManager.getSession()!.currentPacks[host.id]!.cards[0]!.scryfallId);

  const view = buildLobbyStateView();

  assert.equal(view.status, "drafting");
  assert.equal(view.currentPackNumber, 1);
  assert.equal(view.currentPickNumber, 1);
  assert.deepEqual(view.waitingOn, [bob.id]);
  const wire = JSON.stringify(view);
  for (const card of secretCards) {
    assert.ok(!wire.includes(card.scryfallId), `lobby:state leaked ${card.scryfallId}`);
  }
});

test("a Winston draft's public view shows the table's sizes and whose turn it is, never its cards", () => {
  lobbyManager.resetForTests(freshSnapshotPath());
  lobbyManager.createLobbyFromResolvedCube("Test Cube", secretCards, [], {
    cubeId: "test",
    format: "winston",
    packCount: 1,
    packSize: 2,
    alternatingDraft: false,
  });
  const alice = lobbyManager.addPlayer("Alice");
  lobbyManager.addPlayer("Bob");
  lobbyManager.beginDraft();
  lobbyManager.passWinstonPile(alice.id, 0);

  const view = buildLobbyStateView();

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
