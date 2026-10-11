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
  return { cubeId: "test-cube", packCount: 1, packSize: 2, playerCount: 2, alternatingDraft: true, ...overrides };
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

test("marks a player disconnected without removing them", () => {
  lobbyManager.resetForTests(freshSnapshotPath());
  lobbyManager.createLobbyFromResolvedCube("Alice", "Test Cube", fourCards, [], settings());
  const bob = lobbyManager.addPlayer("Bob");

  lobbyManager.setPlayerConnected(bob.id, false);
  const session = lobbyManager.getSession()!;
  assert.equal(session.players.find((p) => p.id === bob.id)?.connected, false);
  assert.equal(session.players.length, 2);
});

test("keeps the draft going when the snapshot can't be saved, and saves it once it can", async (t) => {
  // Reproduces a Windows host where antivirus or the search indexer holds the
  // snapshot open: the rename onto it fails. A directory at the snapshot path
  // makes that rename fail deterministically on every platform.
  const snapshotPath = freshSnapshotPath();
  lobbyManager.resetForTests(snapshotPath);
  const errorLog = t.mock.method(console, "error", () => {});
  fs.mkdirSync(snapshotPath);

  const { host } = lobbyManager.createLobbyFromResolvedCube("Alice", "Test Cube", fourCards, [], settings());
  const bob = lobbyManager.addPlayer("Bob");
  lobbyManager.beginDraft();
  const session = lobbyManager.getSession()!;

  // Both picks of round 1 — the second advances the round. Neither may
  // throw, or the socket handler would skip the broadcast and leave every
  // client stuck on a round the server has already moved past.
  lobbyManager.pick(host.id, session.currentPacks[host.id]!.cards[0]!.scryfallId);
  const afterRound = lobbyManager.pick(bob.id, session.currentPacks[bob.id]!.cards[0]!.scryfallId);
  assert.equal(afterRound.currentPickNumber, 2, "the round advanced in memory");
  assert.deepEqual(afterRound.waitingOn.slice().sort(), [host.id, bob.id].sort());
  assert.ok(errorLog.mock.callCount() > 0, "the failed save is logged");
  assert.deepEqual(
    fs.readdirSync(path.dirname(snapshotPath)).filter((f) => f.startsWith(`.${path.basename(snapshotPath)}`)),
    [],
    "no temp files left behind"
  );

  // Once whatever blocked the write goes away, the background retry catches up.
  fs.rmdirSync(snapshotPath);
  await new Promise((resolve) => setTimeout(resolve, 1500));
  const onDisk = JSON.parse(fs.readFileSync(snapshotPath, "utf8")) as { session: { currentPickNumber: number } };
  assert.equal(onDisk.session.currentPickNumber, 2);
  fs.rmSync(snapshotPath);
});
