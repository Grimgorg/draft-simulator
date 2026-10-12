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

  assert.equal(lobbyManager.pick(host.id, hostCard), "waitingOnOthers");
  assert.equal(lobbyManager.pick(bob.id, bobCard), "draftComplete");

  const final = lobbyManager.getSession()!;
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
  const outcome = lobbyManager.pick(bob.id, session.currentPacks[bob.id]!.cards[0]!.scryfallId);
  assert.equal(outcome, "roundAdvanced");
  const afterRound = lobbyManager.getSession()!;
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

test("a server restart mid-draft resumes from the snapshot, including picks already made this round", () => {
  const snapshotPath = freshSnapshotPath();
  lobbyManager.resetForTests(snapshotPath);
  const { host } = lobbyManager.createLobbyFromResolvedCube(
    "Alice",
    "Test Cube",
    fourCards,
    [],
    settings({ packCount: 2, packSize: 1 })
  );
  const bob = lobbyManager.addPlayer("Bob");
  lobbyManager.beginDraft();
  const firstPick = (playerId: string) => lobbyManager.getSession()!.currentPacks[playerId]!.cards[0]!.scryfallId;

  // Pack 1 is fully picked, so pack 2 comes out of the queue; Alice then picks from it.
  lobbyManager.pick(host.id, firstPick(host.id));
  lobbyManager.pick(bob.id, firstPick(bob.id));
  lobbyManager.pick(host.id, firstPick(host.id));
  const beforeRestart = structuredClone(lobbyManager.getSession()!);

  lobbyManager.reloadFromSnapshotForTests();

  assert.deepEqual(lobbyManager.getSession(), beforeRestart);
  assert.equal(lobbyManager.getCubeMeta()?.cubeName, "Test Cube");
  assert.throws(() => lobbyManager.pick(host.id, firstPick(bob.id)), /already picked/);
  assert.equal(lobbyManager.pick(bob.id, firstPick(bob.id)), "draftComplete");

  const pools = lobbyManager.getSession()!.pools;
  const drafted = [...pools[host.id]!, ...pools[bob.id]!].map((c) => c.scryfallId).sort();
  assert.deepEqual(drafted, ["c1", "c2", "c3", "c4"], "every card drafted exactly once across the restart");
  fs.rmSync(snapshotPath);
});

test("createLobby rejects bad settings before contacting CubeCobra", async (t) => {
  lobbyManager.resetForTests(freshSnapshotPath());
  const fetchMock = t.mock.method(globalThis, "fetch", async () => {
    throw new Error("unexpected network call");
  });

  const cases: [Parameters<typeof lobbyManager.createLobby>, RegExp][] = [
    [["   ", "cube", 3, 15, 8, true], /Host name is required/],
    [["Alice", "cube", 3, 15, 1, true], /at least 2 players/],
    [["Alice", "cube", 3, 15, 2.5, true], /at least 2 players/],
    [["Alice", "cube", 0, 15, 8, true], /at least 1 pack/],
    [["Alice", "cube", 3, 0, 8, true], /at least 1 card/],
  ];
  for (const [args, error] of cases) {
    await assert.rejects(lobbyManager.createLobby(...args), error, JSON.stringify(args));
  }
  assert.equal(fetchMock.mock.callCount(), 0);
  assert.equal(lobbyManager.getSession(), undefined);
});

test("a new lobby can't replace one that is waiting or drafting, only a finished draft", async (t) => {
  lobbyManager.resetForTests(freshSnapshotPath());
  const fetchMock = t.mock.method(globalThis, "fetch", async () => new Response("", { status: 404, statusText: "Not Found" }));
  const createAnother = () => lobbyManager.createLobby("Cara", "other-cube", 1, 1, 2, true);

  const { host } = lobbyManager.createLobbyFromResolvedCube("Alice", "Test Cube", fourCards, [], settings({ packSize: 1 }));
  await assert.rejects(createAnother(), /already in progress or waiting/);
  const bob = lobbyManager.addPlayer("Bob");
  lobbyManager.beginDraft();
  await assert.rejects(createAnother(), /already in progress or waiting/);
  assert.equal(fetchMock.mock.callCount(), 0);

  const session = lobbyManager.getSession()!;
  lobbyManager.pick(host.id, session.currentPacks[host.id]!.cards[0]!.scryfallId);
  lobbyManager.pick(bob.id, session.currentPacks[bob.id]!.cards[0]!.scryfallId);
  // Past the guard, the cube import runs (and fails here) — and the finished draft is left as it was.
  await assert.rejects(createAnother(), /Could not fetch cube "other-cube"/);
  assert.equal(fetchMock.mock.callCount(), 1);
  assert.equal(lobbyManager.getSession()!.status, "complete");
});

test("trims player names and rejects blank ones", () => {
  lobbyManager.resetForTests(freshSnapshotPath());
  assert.throws(() => lobbyManager.addPlayer("Bob"), /No lobby has been created/);
  lobbyManager.createLobbyFromResolvedCube("  Alice ", "Test Cube", fourCards, [], settings({ playerCount: 3 }));

  assert.throws(() => lobbyManager.addPlayer("   "), /Player name is required/);
  assert.equal(lobbyManager.addPlayer("  Bob  ").name, "Bob");
  assert.deepEqual(
    lobbyManager.getSession()!.players.map((p) => p.name),
    ["Alice", "Bob"]
  );
});

test("starting before every seat is filled fails and leaves the lobby open to join", () => {
  lobbyManager.resetForTests(freshSnapshotPath());
  lobbyManager.createLobbyFromResolvedCube("Alice", "Test Cube", fourCards, [], settings());

  assert.throws(() => lobbyManager.beginDraft(), /configured for 2 players but 1 are seated/);
  assert.equal(lobbyManager.getSession()!.status, "lobby");

  lobbyManager.addPlayer("Bob");
  assert.equal(lobbyManager.beginDraft().status, "drafting");
});

test("starting with a cube too small for the packs fails without half-starting the draft", () => {
  const snapshotPath = freshSnapshotPath();
  lobbyManager.resetForTests(snapshotPath);
  lobbyManager.createLobbyFromResolvedCube("Alice", "Tiny Cube", fourCards.slice(0, 3), [], settings());
  lobbyManager.addPlayer("Bob");

  assert.throws(() => lobbyManager.beginDraft(), /Cube has 3 cards but 4 are needed/);
  const session = lobbyManager.getSession()!;
  assert.equal(session.status, "lobby");
  assert.deepEqual(session.currentPacks, {});
  assert.equal(JSON.parse(fs.readFileSync(snapshotPath, "utf8")).session.status, "lobby");
  fs.rmSync(snapshotPath);
});

test("cancelling clears the draft, and it stays cleared after a restart", () => {
  const snapshotPath = freshSnapshotPath();
  lobbyManager.resetForTests(snapshotPath);
  lobbyManager.createLobbyFromResolvedCube("Alice", "Test Cube", fourCards, [], settings());
  lobbyManager.addPlayer("Bob");
  lobbyManager.beginDraft();

  lobbyManager.cancelDraft();
  assert.equal(lobbyManager.getSession(), undefined);
  assert.equal(lobbyManager.getCubeMeta(), undefined);
  assert.throws(() => lobbyManager.pick("anyone", "c1"), /No lobby has been created/);

  lobbyManager.reloadFromSnapshotForTests();
  assert.equal(lobbyManager.getSession(), undefined);
  fs.rmSync(snapshotPath);
});
