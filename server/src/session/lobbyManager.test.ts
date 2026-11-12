import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { MAX_PLAYERS, type DraftSettings } from "@draft-simulator/shared";
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

/** A test cube lobby; returns its id. */
function createLobby(overrides: Partial<DraftSettings> = {}, cards = fourCards): string {
  return lobbyManager.createLobbyFromResolvedCube("Test Cube", cards, [], settings(overrides)).draftId;
}

type SavedSnapshot = { drafts: { session: { id: string; status: string; currentPickNumber: number } }[] };

function readSnapshot(snapshotPath: string): SavedSnapshot {
  return JSON.parse(fs.readFileSync(snapshotPath, "utf8")) as SavedSnapshot;
}

test("creates an empty lobby that any number of players can join, the first of them its creator", () => {
  lobbyManager.resetForTests(freshSnapshotPath());

  const { draftId, cubeMeta } = lobbyManager.createLobbyFromResolvedCube("Test Cube", fourCards, [], settings());
  assert.equal(cubeMeta.cardCount, 4);
  assert.deepEqual(lobbyManager.getSession(draftId)!.players, []);
  assert.equal(lobbyManager.getCreatorPlayerId(draftId), undefined);

  const [alice] = ["Alice", "Bob", "Cara"].map((name) => lobbyManager.addPlayer(draftId, name));
  assert.deepEqual(
    lobbyManager.getSession(draftId)!.players.map((p) => p.name),
    ["Alice", "Bob", "Cara"]
  );
  assert.equal(lobbyManager.getCreatorPlayerId(draftId), alice!.id);
});

test("rejects joining after the draft has started", () => {
  lobbyManager.resetForTests(freshSnapshotPath());
  const draftId = createLobby();
  lobbyManager.addPlayer(draftId, "Alice");
  lobbyManager.addPlayer(draftId, "Bob");

  lobbyManager.beginDraft(draftId);
  assert.throws(() => lobbyManager.addPlayer(draftId, "Cara"), /already started/);
});

test("runs picks through to completion and persists a snapshot", () => {
  const snapshotPath = freshSnapshotPath();
  lobbyManager.resetForTests(snapshotPath);
  const draftId = createLobby({ packSize: 1 });
  const host = lobbyManager.addPlayer(draftId, "Alice");
  const bob = lobbyManager.addPlayer(draftId, "Bob");

  lobbyManager.beginDraft(draftId);
  const session = lobbyManager.getSession(draftId)!;
  const hostCard = session.currentPacks[host.id]!.cards[0]!.scryfallId;
  const bobCard = session.currentPacks[bob.id]!.cards[0]!.scryfallId;

  assert.equal(lobbyManager.pick(draftId, host.id, hostCard), "waitingOnOthers");
  assert.equal(lobbyManager.pick(draftId, bob.id, bobCard), "draftComplete");

  const final = lobbyManager.getSession(draftId)!;
  assert.equal(final.status, "complete");
  assert.equal(final.pools[host.id]!.length, 1);
  assert.equal(readSnapshot(snapshotPath).drafts[0]!.session.status, "complete");

  fs.rmSync(snapshotPath);
});

test("two drafts run side by side without touching each other, and both resume after a restart", () => {
  const snapshotPath = freshSnapshotPath();
  lobbyManager.resetForTests(snapshotPath);
  const first = createLobby({ packSize: 1 });
  const second = createLobby({ packSize: 1 }, ["d1", "d2", "d3", "d4"].map(testCard));
  const alice = lobbyManager.addPlayer(first, "Alice");
  const bob = lobbyManager.addPlayer(first, "Bob");
  const cara = lobbyManager.addPlayer(second, "Cara");
  lobbyManager.addPlayer(second, "Dan");
  lobbyManager.beginDraft(first);
  lobbyManager.beginDraft(second);
  const firstPick = (draftId: string, playerId: string) =>
    lobbyManager.getSession(draftId)!.currentPacks[playerId]!.cards[0]!.scryfallId;

  lobbyManager.pick(first, alice.id, firstPick(first, alice.id));
  assert.throws(() => lobbyManager.pick(second, alice.id, firstPick(first, bob.id)), /not.*in this draft|player/i);
  lobbyManager.pick(second, cara.id, firstPick(second, cara.id));

  lobbyManager.reloadFromSnapshotForTests();
  assert.deepEqual(lobbyManager.getSession(first)!.waitingOn, [bob.id]);
  assert.deepEqual(lobbyManager.getSession(second)!.pools[cara.id]!.map((c) => c.scryfallId.startsWith("d")), [true]);
  assert.equal(lobbyManager.pick(first, bob.id, firstPick(first, bob.id)), "draftComplete");
  assert.equal(lobbyManager.getSession(second)!.status, "drafting", "finishing one draft leaves the other going");
  fs.rmSync(snapshotPath);
});

test("marks a player disconnected without removing them", () => {
  lobbyManager.resetForTests(freshSnapshotPath());
  const draftId = createLobby();
  lobbyManager.addPlayer(draftId, "Alice");
  const bob = lobbyManager.addPlayer(draftId, "Bob");

  lobbyManager.setPlayerConnected(draftId, bob.id, false);
  const session = lobbyManager.getSession(draftId)!;
  assert.equal(session.players.find((p) => p.id === bob.id)?.connected, false);
  assert.equal(session.players.length, 2);
});

test("a player can leave a draft that hasn't started, but its creator can't, and no one can once it has", () => {
  lobbyManager.resetForTests(freshSnapshotPath());
  const draftId = createLobby();
  const alice = lobbyManager.addPlayer(draftId, "Alice");
  const bob = lobbyManager.addPlayer(draftId, "Bob");

  assert.throws(() => lobbyManager.removePlayer(draftId, alice.id), /close it instead/);
  lobbyManager.removePlayer(draftId, bob.id);
  assert.deepEqual(lobbyManager.getSession(draftId)!.players.map((p) => p.name), ["Alice"]);
  assert.equal(bob.id in lobbyManager.getSession(draftId)!.pools, false);

  const cara = lobbyManager.addPlayer(draftId, "Cara");
  lobbyManager.beginDraft(draftId);
  assert.throws(() => lobbyManager.removePlayer(draftId, cara.id), /hasn't started/);
});

test("keeps the draft going when the snapshot can't be saved, and saves it once it can", async (t) => {
  // Reproduces a Windows host where antivirus or the search indexer holds the
  // snapshot open: the rename onto it fails. A directory at the snapshot path
  // makes that rename fail deterministically on every platform.
  const snapshotPath = freshSnapshotPath();
  lobbyManager.resetForTests(snapshotPath);
  const errorLog = t.mock.method(console, "error", () => {});
  fs.mkdirSync(snapshotPath);

  const draftId = createLobby();
  const host = lobbyManager.addPlayer(draftId, "Alice");
  const bob = lobbyManager.addPlayer(draftId, "Bob");
  lobbyManager.beginDraft(draftId);
  const session = lobbyManager.getSession(draftId)!;

  // Both picks of round 1 — the second advances the round. Neither may
  // throw, or the socket handler would skip the broadcast and leave every
  // client stuck on a round the server has already moved past.
  lobbyManager.pick(draftId, host.id, session.currentPacks[host.id]!.cards[0]!.scryfallId);
  const outcome = lobbyManager.pick(draftId, bob.id, session.currentPacks[bob.id]!.cards[0]!.scryfallId);
  assert.equal(outcome, "roundAdvanced");
  const afterRound = lobbyManager.getSession(draftId)!;
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
  assert.equal(readSnapshot(snapshotPath).drafts[0]!.session.currentPickNumber, 2);
  fs.rmSync(snapshotPath);
});

test("a server restart mid-draft resumes from the snapshot, including picks already made this round", () => {
  const snapshotPath = freshSnapshotPath();
  lobbyManager.resetForTests(snapshotPath);
  const draftId = createLobby({ packCount: 2, packSize: 1 });
  const host = lobbyManager.addPlayer(draftId, "Alice");
  const bob = lobbyManager.addPlayer(draftId, "Bob");
  lobbyManager.beginDraft(draftId);
  const firstPick = (playerId: string) =>
    lobbyManager.getSession(draftId)!.currentPacks[playerId]!.cards[0]!.scryfallId;

  // Pack 1 is fully picked, so pack 2 comes out of the queue; Alice then picks from it.
  lobbyManager.pick(draftId, host.id, firstPick(host.id));
  lobbyManager.pick(draftId, bob.id, firstPick(bob.id));
  lobbyManager.pick(draftId, host.id, firstPick(host.id));
  const beforeRestart = structuredClone(lobbyManager.getSession(draftId)!);

  lobbyManager.reloadFromSnapshotForTests();

  assert.deepEqual(lobbyManager.getSession(draftId), beforeRestart);
  assert.equal(lobbyManager.getCubeMeta(draftId)?.cubeName, "Test Cube");
  assert.throws(() => lobbyManager.pick(draftId, host.id, firstPick(bob.id)), /already picked/);
  assert.equal(lobbyManager.pick(draftId, bob.id, firstPick(bob.id)), "draftComplete");

  const pools = lobbyManager.getSession(draftId)!.pools;
  const drafted = [...pools[host.id]!, ...pools[bob.id]!].map((c) => c.scryfallId).sort();
  assert.deepEqual(drafted, ["c1", "c2", "c3", "c4"], "every card drafted exactly once across the restart");
  fs.rmSync(snapshotPath);
});

test("a snapshot saved before servers held several drafts resumes as the only draft", () => {
  const snapshotPath = freshSnapshotPath();
  lobbyManager.resetForTests(snapshotPath);
  const draftId = createLobby({ packSize: 1 });
  const alice = lobbyManager.addPlayer(draftId, "Alice");
  lobbyManager.addPlayer(draftId, "Bob");
  lobbyManager.beginDraft(draftId);
  const [entry] = lobbyManager.listDrafts();
  const { session, cardPool, cubeMeta } = structuredClone(entry!);
  fs.writeFileSync(snapshotPath, JSON.stringify({ session, cardPool, cubeMeta }));

  lobbyManager.reloadFromSnapshotForTests();

  assert.deepEqual(lobbyManager.getSession(draftId), session);
  assert.equal(lobbyManager.getCubeMeta(draftId)?.cubeName, "Test Cube");
  assert.equal(lobbyManager.getCreatorPlayerId(draftId), alice.id);
  assert.equal(lobbyManager.listDrafts()[0]!.completedAt, undefined, "it isn't finished");
  fs.rmSync(snapshotPath);
});

test("an old snapshot without a draft, or none at all, starts with no drafts", () => {
  for (const saved of [{ cardPool: [] }, undefined]) {
    const snapshotPath = freshSnapshotPath();
    lobbyManager.resetForTests(snapshotPath);
    if (saved) fs.writeFileSync(snapshotPath, JSON.stringify(saved));
    lobbyManager.reloadFromSnapshotForTests();
    assert.deepEqual(lobbyManager.listDrafts(), []);
    fs.rmSync(snapshotPath, { force: true });
  }
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
    [["cube", 1_000_000_000, 15, true], /at most 10 packs/],
    [["cube", 3, 31, true], /at most 30 cards/],
    [["cube", Number.NaN, 15, true], /at least 1 pack/],
  ];
  for (const [args, error] of cases) {
    await assert.rejects(lobbyManager.createLobby(...args), error, JSON.stringify(args));
  }
  assert.equal(fetchMock.mock.callCount(), 0);
  assert.deepEqual(lobbyManager.listDrafts(), []);
});

test("a server holds at most MAX_OPEN_DRAFTS open drafts; finished ones don't count", async (t) => {
  lobbyManager.resetForTests(freshSnapshotPath());
  const fetchMock = t.mock.method(globalThis, "fetch", async () => {
    throw new Error("unexpected network call");
  });
  const finished = createLobby({ packSize: 1 });
  const alice = lobbyManager.addPlayer(finished, "Alice");
  const bob = lobbyManager.addPlayer(finished, "Bob");
  lobbyManager.beginDraft(finished);
  const session = lobbyManager.getSession(finished)!;
  lobbyManager.pick(finished, alice.id, session.currentPacks[alice.id]!.cards[0]!.scryfallId);
  lobbyManager.pick(finished, bob.id, session.currentPacks[bob.id]!.cards[0]!.scryfallId);

  for (let i = 0; i < lobbyManager.MAX_OPEN_DRAFTS; i++) createLobby();
  assert.throws(() => createLobby(), /already has 10 drafts going/);
  await assert.rejects(lobbyManager.createLobby("cube", 1, 1, true), /already has 10 drafts going/);
  assert.equal(fetchMock.mock.callCount(), 0, "refused before importing the cube");

  lobbyManager.closeDraft(lobbyManager.listDrafts().at(-1)!.session.id);
  createLobby();
  assert.equal(lobbyManager.listDrafts().length, lobbyManager.MAX_OPEN_DRAFTS + 1);
});

test("trims player names and rejects blank or overlong ones", () => {
  lobbyManager.resetForTests(freshSnapshotPath());
  assert.throws(() => lobbyManager.addPlayer("no-such-draft", "Bob"), /doesn't exist anymore/);
  const draftId = createLobby();
  lobbyManager.addPlayer(draftId, "  Alice ");

  assert.throws(() => lobbyManager.addPlayer(draftId, "   "), /Player name is required/);
  assert.throws(() => lobbyManager.addPlayer(draftId, "x".repeat(41)), /at most 40 characters/);
  // The limit counts the stored, trimmed name.
  assert.equal(lobbyManager.validatePlayerName(`  ${"x".repeat(40)}  `), "x".repeat(40));
  assert.equal(lobbyManager.addPlayer(draftId, "  Bob  ").name, "Bob");
  assert.deepEqual(
    lobbyManager.getSession(draftId)!.players.map((p) => p.name),
    ["Alice", "Bob"]
  );
});

test("starting with fewer than two players fails and leaves the lobby open to join", () => {
  lobbyManager.resetForTests(freshSnapshotPath());
  const draftId = createLobby();
  lobbyManager.addPlayer(draftId, "Alice");

  assert.throws(() => lobbyManager.beginDraft(draftId), /Need at least 2 players to start/);
  assert.equal(lobbyManager.getSession(draftId)!.status, "lobby");

  lobbyManager.addPlayer(draftId, "Bob");
  assert.equal(lobbyManager.beginDraft(draftId).status, "drafting");
});

test("the draft deals to everyone seated when it starts", () => {
  lobbyManager.resetForTests(freshSnapshotPath());
  const sixCards = ["c1", "c2", "c3", "c4", "c5", "c6"].map(testCard);
  const draftId = createLobby({ packCount: 1, packSize: 2 }, sixCards);
  const seated = ["Alice", "Bob", "Carol"].map((name) => lobbyManager.addPlayer(draftId, name));

  const session = lobbyManager.beginDraft(draftId);
  assert.deepEqual(session.waitingOn, seated.map((player) => player.id));
  for (const player of seated) assert.equal(session.currentPacks[player.id]!.cards.length, 2);
  assert.throws(() => lobbyManager.addPlayer(draftId, "Dave"), /already started/);
});

test("a lobby seats at most MAX_PLAYERS", () => {
  lobbyManager.resetForTests(freshSnapshotPath());
  const draftId = createLobby();
  for (let seat = 0; seat < MAX_PLAYERS; seat++) lobbyManager.addPlayer(draftId, `Player ${seat + 1}`);

  assert.throws(() => lobbyManager.addPlayer(draftId, "One too many"), /already has 24 players/);
  assert.equal(lobbyManager.getSession(draftId)!.players.length, MAX_PLAYERS);
});

test("a cube too small for everyone seated is reported when the draft starts, and the lobby stays open", () => {
  lobbyManager.resetForTests(freshSnapshotPath());
  const draftId = createLobby({ packCount: 1, packSize: 2 });
  for (const name of ["Alice", "Bob", "Carol"]) lobbyManager.addPlayer(draftId, name);

  assert.throws(() => lobbyManager.beginDraft(draftId), /Cube has 4 cards but 6 are needed/);
  assert.equal(lobbyManager.getSession(draftId)!.status, "lobby");
});

test("starting with a cube too small for the packs fails without half-starting the draft", () => {
  const snapshotPath = freshSnapshotPath();
  lobbyManager.resetForTests(snapshotPath);
  const draftId = createLobby({}, fourCards.slice(0, 3));
  lobbyManager.addPlayer(draftId, "Alice");
  lobbyManager.addPlayer(draftId, "Bob");

  assert.throws(() => lobbyManager.beginDraft(draftId), /Cube has 3 cards but 4 are needed/);
  const session = lobbyManager.getSession(draftId)!;
  assert.equal(session.status, "lobby");
  assert.deepEqual(session.currentPacks, {});
  assert.equal(readSnapshot(snapshotPath).drafts[0]!.session.status, "lobby");
  fs.rmSync(snapshotPath);
});

test("closing a draft removes only that one, and it stays removed after a restart", () => {
  const snapshotPath = freshSnapshotPath();
  lobbyManager.resetForTests(snapshotPath);
  const closed = createLobby();
  const kept = createLobby();
  lobbyManager.addPlayer(closed, "Alice");
  lobbyManager.addPlayer(closed, "Bob");
  lobbyManager.beginDraft(closed);

  lobbyManager.closeDraft(closed);
  assert.equal(lobbyManager.getSession(closed), undefined);
  assert.equal(lobbyManager.getCubeMeta(closed), undefined);
  assert.throws(() => lobbyManager.pick(closed, "anyone", "c1"), /doesn't exist anymore/);
  assert.throws(() => lobbyManager.closeDraft(closed), /doesn't exist anymore/);

  lobbyManager.reloadFromSnapshotForTests();
  assert.equal(lobbyManager.getSession(closed), undefined);
  assert.deepEqual(lobbyManager.listDrafts().map((entry) => entry.session.id), [kept]);
  fs.rmSync(snapshotPath);
});

test("a finished draft is removed a day after it finished; open and drafted ones never are", (t) => {
  lobbyManager.resetForTests(freshSnapshotPath());
  t.mock.timers.enable({ apis: ["Date"], now: 1_000_000 });
  const finished = createLobby({ packSize: 1 });
  const open = createLobby();
  const alice = lobbyManager.addPlayer(finished, "Alice");
  const bob = lobbyManager.addPlayer(finished, "Bob");
  lobbyManager.beginDraft(finished);
  const session = lobbyManager.getSession(finished)!;
  lobbyManager.pick(finished, alice.id, session.currentPacks[alice.id]!.cards[0]!.scryfallId);
  t.mock.timers.tick(5000);
  lobbyManager.pick(finished, bob.id, session.currentPacks[bob.id]!.cards[0]!.scryfallId);

  const completedAt = 1_005_000;
  assert.deepEqual(lobbyManager.removeExpiredDrafts(completedAt + lobbyManager.FINISHED_DRAFT_TTL_MS - 1), []);
  assert.deepEqual(lobbyManager.removeExpiredDrafts(completedAt + lobbyManager.FINISHED_DRAFT_TTL_MS), [finished]);
  assert.deepEqual(lobbyManager.listDrafts().map((entry) => entry.session.id), [open]);
  assert.deepEqual(lobbyManager.removeExpiredDrafts(Number.MAX_SAFE_INTEGER), []);
});

test("state listeners hear about every change: creating, joins, leaving, connection changes, the start, picks and closing", () => {
  lobbyManager.resetForTests(freshSnapshotPath());
  let changes = 0;
  const stop = lobbyManager.onStateChange(() => changes++);
  try {
    const draftId = createLobby();
    assert.equal(changes, 1);
    const host = lobbyManager.addPlayer(draftId, "Alice");
    const bob = lobbyManager.addPlayer(draftId, "Bob");
    const cara = lobbyManager.addPlayer(draftId, "Cara");
    lobbyManager.removePlayer(draftId, cara.id);
    lobbyManager.setPlayerConnected(draftId, bob.id, false);
    lobbyManager.beginDraft(draftId);
    assert.equal(changes, 7);

    const pack = lobbyManager.getSession(draftId)!.currentPacks[host.id]!;
    lobbyManager.pick(draftId, host.id, pack.cards[0]!.scryfallId);
    assert.equal(changes, 8);

    lobbyManager.closeDraft(draftId);
    assert.equal(changes, 9);
  } finally {
    stop();
  }
});

test("a failing state listener doesn't fail the pick that triggered it", (t) => {
  lobbyManager.resetForTests(freshSnapshotPath());
  const draftId = createLobby();
  const host = lobbyManager.addPlayer(draftId, "Alice");
  lobbyManager.addPlayer(draftId, "Bob");
  lobbyManager.beginDraft(draftId);
  const loggedErrors = t.mock.method(console, "error", () => {});
  const stop = lobbyManager.onStateChange(() => {
    throw new Error("listener broke");
  });
  try {
    const pack = lobbyManager.getSession(draftId)!.currentPacks[host.id]!;
    assert.equal(lobbyManager.pick(draftId, host.id, pack.cards[0]!.scryfallId), "waitingOnOthers");
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
  const { draftId, cubeMeta } = lobbyManager.createSetLobby("fra", 2, true);
  assert.equal(cubeMeta.cubeName, "Reality Fracture");
  assert.ok(cubeMeta.cardCount > 250, `${cubeMeta.cardCount} cards`);
  assert.deepEqual(lobbyManager.getSession(draftId)!.settings, {
    setCode: "fra",
    packCount: 2,
    packSize: 14,
    alternatingDraft: true,
  });
  const host = lobbyManager.addPlayer(draftId, "Alice");
  lobbyManager.addPlayer(draftId, "Bob");

  lobbyManager.reloadFromSnapshotForTests();
  lobbyManager.beginDraft(draftId);
  const session = lobbyManager.getSession(draftId)!;
  assert.equal(session.currentPacks[host.id]!.cards.length, 14);
  // The set's alternate printings aren't in `cards`; the image proxy finds them all the same.
  for (const card of session.currentPacks[host.id]!.cards) assert.ok(getSourceImageUri(card.scryfallId), card.name);
  assert.equal(session.packQueue.length, 1, "the second round's packs are waiting");
});

test("a cube lobby shows its cards to anyone waiting, but opens no sample pack", () => {
  lobbyManager.resetForTests(freshSnapshotPath());
  const { draftId } = lobbyManager.createLobbyFromResolvedCube("Test Cube", fourCards, ["Unknown Card"], settings());

  assert.deepEqual(lobbyManager.getCubeCards(draftId), {
    cubeName: "Test Cube",
    cards: fourCards,
    unresolvedNames: ["Unknown Card"],
  });
  assert.throws(() => lobbyManager.openSamplePack(draftId), /not a set draft/);
});

test("a draft that doesn't exist has no cube cards and no sample pack", () => {
  lobbyManager.resetForTests(freshSnapshotPath());
  assert.throws(() => lobbyManager.getCubeCards("no-such-draft"), /doesn't exist anymore/);
  assert.throws(() => lobbyManager.openSamplePack("no-such-draft"), /doesn't exist anymore/);
});

test("a set lobby opens a sample pack without dealing anything, and has no cube cards", { skip: !cacheHasRealityFracture() && NEEDS_SET_PRINTINGS }, () => {
  const snapshotPath = freshSnapshotPath();
  lobbyManager.resetForTests(snapshotPath);
  const { draftId } = lobbyManager.createSetLobby("fra", 2, true);
  lobbyManager.addPlayer(draftId, "Alice");
  const snapshotBefore = fs.readFileSync(snapshotPath, "utf8");

  assert.equal(lobbyManager.openSamplePack(draftId).length, 14);
  assert.equal(lobbyManager.getSession(draftId)!.status, "lobby");
  assert.deepEqual(lobbyManager.getSession(draftId)!.currentPacks, {});
  assert.equal(fs.readFileSync(snapshotPath, "utf8"), snapshotBefore, "nothing about the draft changed");
  assert.throws(() => lobbyManager.getCubeCards(draftId), /set's boosters, not a cube/);
});

test("refuses a set that can't be drafted", () => {
  lobbyManager.resetForTests(freshSnapshotPath());
  assert.throws(() => lobbyManager.createSetLobby("lea", 3, true), /not a set that can be drafted/);
  assert.deepEqual(lobbyManager.listDrafts(), []);
});

test("a Winston lobby seats exactly two players", () => {
  lobbyManager.resetForTests(freshSnapshotPath());
  const draftId = createLobby({ format: "winston" });
  lobbyManager.addPlayer(draftId, "Alice");
  lobbyManager.addPlayer(draftId, "Bob");

  assert.throws(() => lobbyManager.addPlayer(draftId, "Cara"), /already has its 2 players/);
  assert.equal(lobbyManager.getSession(draftId)!.players.length, 2);
});

test("a Winston draft shuffles every player's packs into its stack and resumes after a restart", () => {
  lobbyManager.resetForTests(freshSnapshotPath());
  const cards = Array.from({ length: 8 }, (_, i) => testCard(`w${i + 1}`));
  const draftId = createLobby({ format: "winston", packCount: 2 }, cards);
  const alice = lobbyManager.addPlayer(draftId, "Alice");
  lobbyManager.addPlayer(draftId, "Bob");

  lobbyManager.beginDraft(draftId);
  const table = lobbyManager.getSession(draftId)!.winston!;
  assert.equal(table.stack.length + table.piles.flat().length, 8, "2 packs of 2 cards for each of 2 players");
  assert.deepEqual(lobbyManager.getSession(draftId)!.currentPacks, {}, "no packs are dealt");
  const firstPile = table.piles[0]!.map((c) => c.scryfallId);
  assert.equal(lobbyManager.takeWinstonPile(draftId, alice.id, 0), "turnEnded");

  lobbyManager.reloadFromSnapshotForTests();
  const resumed = lobbyManager.getSession(draftId)!;
  assert.deepEqual(resumed.pools[alice.id]!.map((c) => c.scryfallId), firstPile);
  assert.equal(resumed.winston!.activeSeat, 1);
  assert.equal(resumed.winston!.stack.length, 4);
});

test("a normal draft's settings have no format", () => {
  lobbyManager.resetForTests(freshSnapshotPath());
  const draftId = createLobby();
  assert.equal("format" in lobbyManager.getSession(draftId)!.settings, false);
});

test("a joined seat is taken back only with its token; the snapshot keeps only a hash, and both survive a restart", () => {
  const snapshotPath = freshSnapshotPath();
  lobbyManager.resetForTests(snapshotPath);
  const draftId = createLobby();
  const { player, seatToken } = lobbyManager.joinDraft(draftId, "Alice");

  assert.equal(lobbyManager.isSeatClaimable(draftId, player.id), false);
  assert.throws(() => lobbyManager.claimSeat(draftId, player.id, undefined), /held by another browser/);
  assert.throws(() => lobbyManager.claimSeat(draftId, player.id, "not-the-token"), /held by another browser/);
  assert.throws(() => lobbyManager.claimSeat(draftId, player.id, 42), /held by another browser/);
  assert.equal(lobbyManager.claimSeat(draftId, player.id, seatToken), seatToken);
  assert.throws(() => lobbyManager.claimSeat(draftId, "nobody", seatToken), /No matching player/);
  assert.ok(!fs.readFileSync(snapshotPath, "utf8").includes(seatToken), "the token itself is never saved");

  lobbyManager.reloadFromSnapshotForTests();
  assert.throws(() => lobbyManager.claimSeat(draftId, player.id, "not-the-token"), /held by another browser/);
  assert.equal(lobbyManager.claimSeat(draftId, player.id, seatToken), seatToken);
});

test("a released seat goes to whoever claims it next, with a new token; the old one stops working", () => {
  lobbyManager.resetForTests(freshSnapshotPath());
  const draftId = createLobby();
  const { player, seatToken: lostToken } = lobbyManager.joinDraft(draftId, "Alice");
  assert.throws(() => lobbyManager.releaseSeat(draftId, "nobody"), /No matching player/);

  lobbyManager.releaseSeat(draftId, player.id);
  assert.equal(lobbyManager.isSeatClaimable(draftId, player.id), true);
  const newToken = lobbyManager.claimSeat(draftId, player.id, undefined);
  assert.notEqual(newToken, lostToken);
  assert.equal(lobbyManager.isSeatClaimable(draftId, player.id), false);
  assert.throws(() => lobbyManager.claimSeat(draftId, player.id, lostToken), /held by another browser/);
  assert.equal(lobbyManager.claimSeat(draftId, player.id, newToken), newToken);
});

test("seats saved before they had tokens can each be claimed once, then need the new token", () => {
  const snapshotPath = freshSnapshotPath();
  lobbyManager.resetForTests(snapshotPath);
  const draftId = createLobby();
  const alice = lobbyManager.addPlayer(draftId, "Alice");
  // What an older server saved: no seatTokenHashes at all.
  const saved = JSON.parse(fs.readFileSync(snapshotPath, "utf8")) as { drafts: Record<string, unknown>[] };
  for (const entry of saved.drafts) delete entry.seatTokenHashes;
  fs.writeFileSync(snapshotPath, JSON.stringify(saved));
  lobbyManager.reloadFromSnapshotForTests();

  assert.equal(lobbyManager.isSeatClaimable(draftId, alice.id), true);
  const seatToken = lobbyManager.claimSeat(draftId, alice.id, "whatever an old browser had");
  assert.throws(() => lobbyManager.claimSeat(draftId, alice.id, undefined), /held by another browser/);
  assert.equal(lobbyManager.claimSeat(draftId, alice.id, seatToken), seatToken);
});

test("a player who leaves a lobby takes their seat token with them", () => {
  lobbyManager.resetForTests(freshSnapshotPath());
  const draftId = createLobby();
  lobbyManager.joinDraft(draftId, "Alice");
  const { player: bob } = lobbyManager.joinDraft(draftId, "Bob");
  lobbyManager.removePlayer(draftId, bob.id);
  assert.equal(lobbyManager.listDrafts()[0]!.seatTokenHashes?.[bob.id], undefined);
});
