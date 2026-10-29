import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import type { DraftSettings } from "@draft-simulator/shared";
import { getSourceImageUri } from "../cardData/cardRepository.js";
import { getDb } from "../db/database.js";
import { testCard } from "../draftEngine/testHelpers.js";
import * as lobbyManager from "./lobbyManager.js";

function freshSnapshotPath(): string {
  return path.join(os.tmpdir(), `draft-simulator-test-${Date.now()}-${Math.random().toString(36).slice(2)}.json`);
}

function settings(overrides: Partial<DraftSettings> = {}): DraftSettings {
  return { cubeId: "test-cube", packCount: 1, packSize: 2, alternatingDraft: true, ...overrides };
}

const fourCards = [testCard("c1"), testCard("c2"), testCard("c3"), testCard("c4")];

test("creates an empty lobby that any number of players can join", () => {
  lobbyManager.resetForTests(freshSnapshotPath());

  const { cubeMeta } = lobbyManager.createLobbyFromResolvedCube("Test Cube", fourCards, [], settings());
  assert.equal(cubeMeta.cardCount, 4);
  assert.deepEqual(lobbyManager.getSession()!.players, [], "the host joins from the player page like everyone else");

  for (const name of ["Alice", "Bob", "Cara"]) lobbyManager.addPlayer(name);
  assert.deepEqual(
    lobbyManager.getSession()!.players.map((p) => p.name),
    ["Alice", "Bob", "Cara"]
  );
});

test("rejects joining after the draft has started", () => {
  lobbyManager.resetForTests(freshSnapshotPath());
  lobbyManager.createLobbyFromResolvedCube("Test Cube", fourCards, [], settings());
  lobbyManager.addPlayer("Alice");
  lobbyManager.addPlayer("Bob");

  lobbyManager.beginDraft();
  assert.throws(() => lobbyManager.addPlayer("Cara"), /already started/);
});

test("runs picks through to completion and persists a snapshot", () => {
  const snapshotPath = freshSnapshotPath();
  lobbyManager.resetForTests(snapshotPath);
  lobbyManager.createLobbyFromResolvedCube("Test Cube", fourCards, [], settings({ packSize: 1 }));
  const host = lobbyManager.addPlayer("Alice");
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
  lobbyManager.createLobbyFromResolvedCube("Test Cube", fourCards, [], settings());
  lobbyManager.addPlayer("Alice");
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

  lobbyManager.createLobbyFromResolvedCube("Test Cube", fourCards, [], settings());
  const host = lobbyManager.addPlayer("Alice");
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
  lobbyManager.createLobbyFromResolvedCube("Test Cube", fourCards, [], settings({ packCount: 2, packSize: 1 }));
  const host = lobbyManager.addPlayer("Alice");
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
    [["   ", 3, 15, true], /Cube URL or ID is required/],
    [["cube", 0, 15, true], /at least 1 pack/],
    [["cube", 3, 0, true], /at least 1 card/],
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
  const createAnother = () => lobbyManager.createLobby("other-cube", 1, 1, true);

  lobbyManager.createLobbyFromResolvedCube("Test Cube", fourCards, [], settings({ packSize: 1 }));
  const host = lobbyManager.addPlayer("Alice");
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
  lobbyManager.createLobbyFromResolvedCube("Test Cube", fourCards, [], settings());
  lobbyManager.addPlayer("  Alice ");

  assert.throws(() => lobbyManager.addPlayer("   "), /Player name is required/);
  assert.equal(lobbyManager.addPlayer("  Bob  ").name, "Bob");
  assert.deepEqual(
    lobbyManager.getSession()!.players.map((p) => p.name),
    ["Alice", "Bob"]
  );
});

test("starting with fewer than two players fails and leaves the lobby open to join", () => {
  lobbyManager.resetForTests(freshSnapshotPath());
  lobbyManager.createLobbyFromResolvedCube("Test Cube", fourCards, [], settings());
  lobbyManager.addPlayer("Alice");

  assert.throws(() => lobbyManager.beginDraft(), /Need at least 2 players to start/);
  assert.equal(lobbyManager.getSession()!.status, "lobby");

  lobbyManager.addPlayer("Bob");
  assert.equal(lobbyManager.beginDraft().status, "drafting");
});

test("the lobby has no seat limit: the draft deals to everyone seated when it starts", () => {
  lobbyManager.resetForTests(freshSnapshotPath());
  const sixCards = ["c1", "c2", "c3", "c4", "c5", "c6"].map(testCard);
  lobbyManager.createLobbyFromResolvedCube("Test Cube", sixCards, [], settings({ packCount: 1, packSize: 2 }));
  const seated = ["Alice", "Bob", "Carol"].map((name) => lobbyManager.addPlayer(name));

  const session = lobbyManager.beginDraft();
  assert.deepEqual(session.waitingOn, seated.map((player) => player.id));
  for (const player of seated) assert.equal(session.currentPacks[player.id]!.cards.length, 2);
  assert.throws(() => lobbyManager.addPlayer("Dave"), /already started/);
});

test("a cube too small for everyone seated is reported when the draft starts, and the lobby stays open", () => {
  lobbyManager.resetForTests(freshSnapshotPath());
  lobbyManager.createLobbyFromResolvedCube("Test Cube", fourCards, [], settings({ packCount: 1, packSize: 2 }));
  for (const name of ["Alice", "Bob", "Carol"]) lobbyManager.addPlayer(name);

  assert.throws(() => lobbyManager.beginDraft(), /Cube has 4 cards but 6 are needed/);
  assert.equal(lobbyManager.getSession()!.status, "lobby");
});

test("starting with a cube too small for the packs fails without half-starting the draft", () => {
  const snapshotPath = freshSnapshotPath();
  lobbyManager.resetForTests(snapshotPath);
  lobbyManager.createLobbyFromResolvedCube("Tiny Cube", fourCards.slice(0, 3), [], settings());
  lobbyManager.addPlayer("Alice");
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
  lobbyManager.createLobbyFromResolvedCube("Test Cube", fourCards, [], settings());
  lobbyManager.addPlayer("Alice");
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

test("state listeners hear about every change: joins, connection changes, the start, picks and a cancel", () => {
  lobbyManager.resetForTests(freshSnapshotPath());
  let changes = 0;
  const stop = lobbyManager.onStateChange(() => changes++);
  try {
    lobbyManager.createLobbyFromResolvedCube("Test Cube", fourCards, [], settings());
    assert.equal(changes, 1);
    const host = lobbyManager.addPlayer("Alice");
    const bob = lobbyManager.addPlayer("Bob");
    lobbyManager.setPlayerConnected(bob.id, false);
    lobbyManager.beginDraft();
    assert.equal(changes, 5);

    const pack = lobbyManager.getSession()!.currentPacks[host.id];
    lobbyManager.pick(host.id, pack.cards[0].scryfallId);
    assert.equal(changes, 6);

    lobbyManager.cancelDraft();
    assert.equal(changes, 7);
  } finally {
    stop();
  }
});

test("a failing state listener doesn't fail the pick that triggered it", (t) => {
  lobbyManager.resetForTests(freshSnapshotPath());
  lobbyManager.createLobbyFromResolvedCube("Test Cube", fourCards, [], settings());
  const host = lobbyManager.addPlayer("Alice");
  lobbyManager.addPlayer("Bob");
  lobbyManager.beginDraft();
  const loggedErrors = t.mock.method(console, "error", () => {});
  const stop = lobbyManager.onStateChange(() => {
    throw new Error("listener broke");
  });
  try {
    const pack = lobbyManager.getSession()!.currentPacks[host.id];
    assert.equal(lobbyManager.pick(host.id, pack.cards[0].scryfallId), "waitingOnOthers");
  } finally {
    stop();
  }
  assert.equal(loggedErrors.mock.callCount(), 1);
});

function cacheHasRealityFracture(): boolean {
  return getDb().prepare("SELECT 1 FROM set_printings WHERE set_code = 'fra' LIMIT 1").get() !== undefined;
}

const NEEDS_SET_PRINTINGS = "needs a card cache with set printings: npm run import-cards --workspace server";

test("a set lobby fixes the pack size and deals the set's boosters, also after a restart", { skip: !cacheHasRealityFracture() && NEEDS_SET_PRINTINGS }, () => {
  lobbyManager.resetForTests(freshSnapshotPath());
  const { cubeMeta } = lobbyManager.createSetLobby("fra", 2, true);
  assert.equal(cubeMeta.cubeName, "Reality Fracture");
  assert.ok(cubeMeta.cardCount > 250, `${cubeMeta.cardCount} cards`);
  assert.deepEqual(lobbyManager.getSession()!.settings, {
    setCode: "fra",
    packCount: 2,
    packSize: 14,
    alternatingDraft: true,
  });
  const host = lobbyManager.addPlayer("Alice");
  lobbyManager.addPlayer("Bob");

  lobbyManager.reloadFromSnapshotForTests();
  lobbyManager.beginDraft();
  const session = lobbyManager.getSession()!;
  assert.equal(session.currentPacks[host.id]!.cards.length, 14);
  // The set's alternate printings aren't in `cards`; the image proxy finds them all the same.
  for (const card of session.currentPacks[host.id]!.cards) assert.ok(getSourceImageUri(card.scryfallId), card.name);
  assert.equal(session.packQueue.length, 1, "the second round's packs are waiting");
});

test("a cube lobby shows its cards to anyone waiting, but opens no sample pack", () => {
  lobbyManager.resetForTests(freshSnapshotPath());
  lobbyManager.createLobbyFromResolvedCube("Test Cube", fourCards, ["Unknown Card"], settings());

  assert.deepEqual(lobbyManager.getCubeCards(), {
    cubeName: "Test Cube",
    cards: fourCards,
    unresolvedNames: ["Unknown Card"],
  });
  assert.throws(() => lobbyManager.openSamplePack(), /not a set draft/);
});

test("without a lobby there are no cube cards and no sample pack", () => {
  lobbyManager.resetForTests(freshSnapshotPath());
  assert.throws(() => lobbyManager.getCubeCards(), /No lobby has been created yet/);
  assert.throws(() => lobbyManager.openSamplePack(), /No lobby has been created yet/);
});

test("a set lobby opens a sample pack without dealing anything, and has no cube cards", { skip: !cacheHasRealityFracture() && NEEDS_SET_PRINTINGS }, () => {
  const snapshotPath = freshSnapshotPath();
  lobbyManager.resetForTests(snapshotPath);
  lobbyManager.createSetLobby("fra", 2, true);
  lobbyManager.addPlayer("Alice");
  const snapshotBefore = fs.readFileSync(snapshotPath, "utf8");

  assert.equal(lobbyManager.openSamplePack().length, 14);
  assert.equal(lobbyManager.getSession()!.status, "lobby");
  assert.deepEqual(lobbyManager.getSession()!.currentPacks, {});
  assert.equal(fs.readFileSync(snapshotPath, "utf8"), snapshotBefore, "nothing about the draft changed");
  assert.throws(() => lobbyManager.getCubeCards(), /set's boosters, not a cube/);
});

test("refuses a set that can't be drafted", () => {
  lobbyManager.resetForTests(freshSnapshotPath());
  assert.throws(() => lobbyManager.createSetLobby("lea", 3, true), /not a set that can be drafted/);
  assert.equal(lobbyManager.getSession(), undefined);
});

test("a Winston lobby seats exactly two players", () => {
  lobbyManager.resetForTests(freshSnapshotPath());
  lobbyManager.createLobbyFromResolvedCube("Test Cube", fourCards, [], settings({ format: "winston" }));
  lobbyManager.addPlayer("Alice");
  lobbyManager.addPlayer("Bob");

  assert.throws(() => lobbyManager.addPlayer("Cara"), /already has its 2 players/);
  assert.equal(lobbyManager.getSession()!.players.length, 2);
});

test("a Winston draft shuffles every player's packs into its stack and resumes after a restart", () => {
  lobbyManager.resetForTests(freshSnapshotPath());
  const cards = Array.from({ length: 8 }, (_, i) => testCard(`w${i + 1}`));
  lobbyManager.createLobbyFromResolvedCube("Test Cube", cards, [], settings({ format: "winston", packCount: 2 }));
  const alice = lobbyManager.addPlayer("Alice");
  lobbyManager.addPlayer("Bob");

  lobbyManager.beginDraft();
  const table = lobbyManager.getSession()!.winston!;
  assert.equal(table.stack.length + table.piles.flat().length, 8, "2 packs of 2 cards for each of 2 players");
  assert.deepEqual(lobbyManager.getSession()!.currentPacks, {}, "no packs are dealt");
  const firstPile = table.piles[0]!.map((c) => c.scryfallId);
  assert.equal(lobbyManager.takeWinstonPile(alice.id, 0), "turnEnded");

  lobbyManager.reloadFromSnapshotForTests();
  const resumed = lobbyManager.getSession()!;
  assert.deepEqual(resumed.pools[alice.id]!.map((c) => c.scryfallId), firstPile);
  assert.equal(resumed.winston!.activeSeat, 1);
  assert.equal(resumed.winston!.stack.length, 4);
});

test("a normal draft's settings have no format", () => {
  lobbyManager.resetForTests(freshSnapshotPath());
  lobbyManager.createLobbyFromResolvedCube("Test Cube", fourCards, [], settings());
  assert.equal("format" in lobbyManager.getSession()!.settings, false);
});
