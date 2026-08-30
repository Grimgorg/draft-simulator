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
