import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import type { DraftSettings } from "@draft-simulator/shared";
import { testCard } from "../draftEngine/testHelpers.js";
import * as lobbyManager from "./lobbyManager.js";

function freshSnapshotPath(): string {
  return path.join(os.tmpdir(), `draft-simulator-test-${Date.now()}-${Math.random().toString(36).slice(2)}.json`);
}

function settings(overrides: Partial<DraftSettings> = {}): DraftSettings {
  return { cubeId: "test-cube", packCount: 1, packSize: 2, playerCount: 2, ...overrides };
}

const fourCards = [testCard("c1"), testCard("c2"), testCard("c3"), testCard("c4")];

test("creates a lobby, seats the host, and enforces capacity", () => {
  lobbyManager.resetForTests(freshSnapshotPath());

  const { host, cubeMeta } = lobbyManager.createLobbyFromResolvedCube(
    "Alice",
    "Test Cube",
    fourCards,
    [],
    settings()
  );
  assert.equal(host.isHost, true);
  assert.equal(cubeMeta.cardCount, 4);

  const bob = lobbyManager.addPlayer("Bob");
  assert.equal(bob.isHost, false);

  assert.throws(() => lobbyManager.addPlayer("Cara"), /full/);
});

test("rejects joining after the draft has started", () => {
  lobbyManager.resetForTests(freshSnapshotPath());
  lobbyManager.createLobbyFromResolvedCube("Alice", "Test Cube", fourCards, [], settings());
  lobbyManager.addPlayer("Bob");

  lobbyManager.beginDraft();
  assert.throws(() => lobbyManager.addPlayer("Cara"), /already started/);
});

test("runs picks through to completion and persists a snapshot", () => {
  const snapshotPath = freshSnapshotPath();
  lobbyManager.resetForTests(snapshotPath);
  const { host } = lobbyManager.createLobbyFromResolvedCube(
    "Alice",
    "Test Cube",
    fourCards,
    [],
    settings({ packSize: 1 })
  );
  const bob = lobbyManager.addPlayer("Bob");

  lobbyManager.beginDraft();
  const session = lobbyManager.getSession()!;
  const hostCard = session.currentPacks[host.id]!.cards[0]!.scryfallId;
  const bobCard = session.currentPacks[bob.id]!.cards[0]!.scryfallId;

  lobbyManager.pick(host.id, hostCard);
  const final = lobbyManager.pick(bob.id, bobCard);

  assert.equal(final.status, "complete");
  assert.equal(final.pools[host.id]!.length, 1);

  const onDisk = JSON.parse(fs.readFileSync(snapshotPath, "utf8")) as { session: { status: string } };
  assert.equal(onDisk.session.status, "complete");

  fs.rmSync(snapshotPath);
});

test("locks in a deck from the drafted pool and rejects cards outside it", () => {
  const snapshotPath = freshSnapshotPath();
  lobbyManager.resetForTests(snapshotPath);
  const { host } = lobbyManager.createLobbyFromResolvedCube(
    "Alice",
    "Test Cube",
    fourCards,
    [],
    settings({ packSize: 1 })
  );
  const bob = lobbyManager.addPlayer("Bob");

  lobbyManager.beginDraft();
  assert.throws(() => lobbyManager.submitDeck(host.id, ["c1"]), /complete/);

  const session = lobbyManager.getSession()!;
  const hostCard = session.currentPacks[host.id]!.cards[0]!.scryfallId;
  const bobCard = session.currentPacks[bob.id]!.cards[0]!.scryfallId;
  lobbyManager.pick(host.id, hostCard);
  lobbyManager.pick(bob.id, bobCard);
  assert.equal(lobbyManager.getSession()!.status, "complete");

  assert.throws(() => lobbyManager.submitDeck(host.id, []), /empty/);
  assert.throws(() => lobbyManager.submitDeck(host.id, [bobCard]), /not in your drafted pool/);

  lobbyManager.submitDeck(host.id, [hostCard]);
  assert.deepEqual(Object.keys(lobbyManager.getReadyPlayers()), [host.id]);
  assert.equal(lobbyManager.getReadyPlayers()[host.id]![0]!.scryfallId, hostCard);

  lobbyManager.unready(host.id);
  assert.deepEqual(lobbyManager.getReadyPlayers(), {});

  fs.rmSync(snapshotPath);
});

test("challenge -> accept deals opening hands and marks both players in-match; concede returns them to idle", () => {
  const snapshotPath = freshSnapshotPath();
  lobbyManager.resetForTests(snapshotPath);
  const { host } = lobbyManager.createLobbyFromResolvedCube(
    "Alice",
    "Test Cube",
    fourCards,
    [],
    settings({ packSize: 1 })
  );
  const bob = lobbyManager.addPlayer("Bob");

  lobbyManager.beginDraft();
  const session = lobbyManager.getSession()!;
  const hostCard = session.currentPacks[host.id]!.cards[0]!.scryfallId;
  const bobCard = session.currentPacks[bob.id]!.cards[0]!.scryfallId;
  lobbyManager.pick(host.id, hostCard);
  lobbyManager.pick(bob.id, bobCard);

  assert.throws(() => lobbyManager.challenge(host.id, bob.id), /ready/);

  lobbyManager.submitDeck(host.id, [hostCard]);
  lobbyManager.submitDeck(bob.id, [bobCard]);

  lobbyManager.challenge(host.id, bob.id);
  assert.deepEqual(lobbyManager.getPendingChallenge(bob.id), { fromId: host.id });

  const match = lobbyManager.respondToChallenge(bob.id, host.id, true)!;
  assert.ok(match);
  assert.equal(lobbyManager.getActiveMatch(host.id)!.id, match.id);
  assert.equal(lobbyManager.getActiveMatch(bob.id)!.id, match.id);
  assert.equal(lobbyManager.getPendingChallenge(bob.id), undefined);
  assert.throws(() => lobbyManager.unready(host.id), /in a match/);

  const ended = lobbyManager.concede(host.id)!;
  assert.equal(ended.id, match.id);
  assert.equal(lobbyManager.getActiveMatch(host.id), undefined);
  assert.equal(lobbyManager.getActiveMatch(bob.id), undefined);

  fs.rmSync(snapshotPath);
});

test("declining a challenge leaves both players idle with no match", () => {
  const snapshotPath = freshSnapshotPath();
  lobbyManager.resetForTests(snapshotPath);
  const { host } = lobbyManager.createLobbyFromResolvedCube(
    "Alice",
    "Test Cube",
    fourCards,
    [],
    settings({ packSize: 1 })
  );
  const bob = lobbyManager.addPlayer("Bob");

  lobbyManager.beginDraft();
  const session = lobbyManager.getSession()!;
  const hostCard = session.currentPacks[host.id]!.cards[0]!.scryfallId;
  const bobCard = session.currentPacks[bob.id]!.cards[0]!.scryfallId;
  lobbyManager.pick(host.id, hostCard);
  lobbyManager.pick(bob.id, bobCard);
  lobbyManager.submitDeck(host.id, [hostCard]);
  lobbyManager.submitDeck(bob.id, [bobCard]);

  lobbyManager.challenge(host.id, bob.id);
  const result = lobbyManager.respondToChallenge(bob.id, host.id, false);

  assert.equal(result, undefined);
  assert.equal(lobbyManager.getActiveMatch(host.id), undefined);
  assert.equal(lobbyManager.getActiveMatch(bob.id), undefined);
  assert.equal(lobbyManager.getPendingChallenge(bob.id), undefined);

  fs.rmSync(snapshotPath);
});

test("loading a pre-existing snapshot written before hub/match support backfills the missing fields instead of crashing", () => {
  const snapshotPath = freshSnapshotPath();
  // Shaped like a snapshot from before readyPlayers/pendingChallenges/matches/activePlayerMatch existed.
  const oldShapedSnapshot = {
    cardPool: [],
    session: {
      id: "old-session",
      status: "complete",
      settings: settings(),
      players: [{ id: "alice", name: "Alice", isHost: true, connected: true }],
      currentPackNumber: 1,
      currentPickNumber: 1,
      currentPacks: {},
      waitingOn: [],
      picks: [],
      pools: { alice: [testCard("c1")] },
    },
  };
  fs.writeFileSync(snapshotPath, JSON.stringify(oldShapedSnapshot));

  lobbyManager.resetForTests(snapshotPath);

  // The bug: getActiveMatch indexed into an undefined activePlayerMatch and threw.
  assert.equal(lobbyManager.getActiveMatch("alice"), undefined);
  assert.deepEqual(lobbyManager.getReadyPlayers(), {});
  assert.equal(lobbyManager.getSession()?.id, "old-session", "pre-existing session data must survive the backfill");

  fs.rmSync(snapshotPath);
});

test("marks a player disconnected without removing them", () => {
  lobbyManager.resetForTests(freshSnapshotPath());
  lobbyManager.createLobbyFromResolvedCube("Alice", "Test Cube", fourCards, [], settings());
  const bob = lobbyManager.addPlayer("Bob");

  lobbyManager.setPlayerConnected(bob.id, false);
  const session = lobbyManager.getSession()!;
  assert.equal(session.players.find((p) => p.id === bob.id)?.connected, false);
  assert.equal(session.players.length, 2);
});
