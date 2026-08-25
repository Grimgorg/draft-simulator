import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { Card, CardInstance, DraftSettings, Player, Zone } from "@draft-simulator/shared";
import { DATA_DIR } from "../db/database.js";
import { importCubeFromCubeCobra } from "../cubeImport/cubeCobraImporter.js";
import { createDraftSession, startDraft, submitPick, type DraftSession } from "../draftEngine/draftEngine.js";
import {
  createMatch,
  drawCard as engineDrawCard,
  shuffleLibrary as engineShuffleLibrary,
  mulligan as engineMulligan,
  moveCard as engineMoveCard,
  tapCard as engineTapCard,
  untapAll as engineUntapAll,
  setCardCounter as engineSetCardCounter,
  setBattlefieldSlot as engineSetBattlefieldSlot,
  flipFaceDown as engineFlipFaceDown,
  createToken as engineCreateToken,
  deleteToken as engineDeleteToken,
  peekLibrary as enginePeekLibrary,
  findOwnCard as engineFindOwnCard,
  setPlayerCounter as engineSetPlayerCounter,
  type MatchSession,
} from "./gameEngine.js";

interface CubeMeta {
  cubeName: string;
  cardCount: number;
  unresolvedCardNames: string[];
}

interface LobbyManagerState {
  session?: DraftSession;
  cardPool: Card[];
  cubeMeta?: CubeMeta;
  /** Decklists locked in via submitDeck, keyed by player id. A player is "ready" iff they have an entry here. */
  readyPlayers: Record<string, Card[]>;
  /** An incoming challenge for a player, keyed by the target player's id. At most one pending challenge per target. */
  pendingChallenges: Record<string, { fromId: string }>;
  /** Active matches, keyed by match id. */
  matches: Record<string, MatchSession>;
  /** The match a player is currently seated in, keyed by player id. */
  activePlayerMatch: Record<string, string>;
}

// Lazily initialized so tests can point DRAFT_SNAPSHOT_PATH at an isolated
// file (via resetForTests) before the first real disk read happens.
let state: LobbyManagerState | undefined;

/** The baseline shape, with every field defaulted. Also used to backfill a snapshot written by an older version of this file that predates some of these fields. */
function emptyState(): LobbyManagerState {
  return { cardPool: [], readyPlayers: {}, pendingChallenges: {}, matches: {}, activePlayerMatch: {} };
}

function snapshotPath(): string {
  return process.env.DRAFT_SNAPSHOT_PATH ?? path.join(DATA_DIR, "draft-session.json");
}

function loadState(): LobbyManagerState {
  const file = snapshotPath();
  try {
    if (fs.existsSync(file)) {
      const onDisk = JSON.parse(fs.readFileSync(file, "utf8")) as Partial<LobbyManagerState>;
      return { ...emptyState(), ...onDisk };
    }
  } catch (err) {
    // Renamed aside rather than left in place or deleted: starting fresh
    // still needs to write a new snapshot to this same path, and the
    // corrupt original is the only copy of whatever progress it held.
    const quarantined = `${file}.corrupt-${Date.now()}`;
    console.error(
      `Failed to load draft session snapshot; moved it to ${quarantined} and starting fresh:`,
      err
    );
    try {
      fs.renameSync(file, quarantined);
    } catch {
      // ignore — best-effort preservation
    }
  }
  return emptyState();
}

function getState(): LobbyManagerState {
  if (!state) {
    state = loadState();
  }
  return state;
}

function persist(): void {
  const file = snapshotPath();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  // Written to a temp file and renamed into place rather than overwritten
  // directly: a crash mid-write would otherwise risk leaving a truncated,
  // unparseable snapshot on disk — losing the whole draft instead of just
  // the latest action. Rename is atomic on the same filesystem, so the real
  // file is always either the old or the new complete snapshot, never a mix.
  const tmpFile = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmpFile, JSON.stringify(getState(), null, 2));
  fs.renameSync(tmpFile, file);
}

/** Test-only: forces a clean in-memory state pointed at an isolated snapshot file. */
export function resetForTests(isolatedSnapshotPath: string): void {
  process.env.DRAFT_SNAPSHOT_PATH = isolatedSnapshotPath;
  // Cleared rather than reset directly, so the next access goes through the
  // normal loadState() path — including reading a pre-existing file at this
  // path, which is how tests exercise backward-compatible snapshot loading.
  state = undefined;
}

export function getSession(): DraftSession | undefined {
  return getState().session;
}

export function getCubeMeta(): CubeMeta | undefined {
  return getState().cubeMeta;
}

function validateNewLobbyInputs(hostName: string, packCount: number, packSize: number, playerCount: number): void {
  const current = getState().session;
  if (current && current.status !== "complete") {
    throw new Error("A draft is already in progress or waiting to start on this server");
  }
  if (!hostName.trim()) throw new Error("Host name is required");
  if (!Number.isInteger(playerCount) || playerCount < 2) throw new Error("Need at least 2 players");
  if (!Number.isInteger(packCount) || packCount < 1) throw new Error("Need at least 1 pack");
  if (!Number.isInteger(packSize) || packSize < 1) throw new Error("Packs need at least 1 card");
}

export async function createLobby(
  hostName: string,
  cubeIdOrUrl: string,
  packCount: number,
  packSize: number,
  playerCount: number
): Promise<{ host: Player; cubeMeta: CubeMeta }> {
  validateNewLobbyInputs(hostName, packCount, packSize, playerCount);
  const imported = await importCubeFromCubeCobra(cubeIdOrUrl);
  return createLobbyFromResolvedCube(hostName, imported.cubeName, imported.cards, imported.unresolvedNames, {
    cubeId: cubeIdOrUrl,
    packCount,
    packSize,
    playerCount,
  });
}

/**
 * Builds a fresh lobby from an already-resolved cube, skipping the
 * network-dependent CubeCobra/Scryfall lookup. `createLobby` is the normal
 * entry point; this is exported separately so lobby/session logic can be
 * tested without network access.
 */
export function createLobbyFromResolvedCube(
  hostName: string,
  cubeName: string,
  cards: Card[],
  unresolvedCardNames: string[],
  settings: DraftSettings
): { host: Player; cubeMeta: CubeMeta } {
  const cubeMeta: CubeMeta = { cubeName, cardCount: cards.length, unresolvedCardNames };
  state = {
    ...emptyState(),
    session: createDraftSession(randomUUID(), settings, []),
    cardPool: cards,
    cubeMeta,
  };

  const host = addPlayer(hostName, true);
  return { host, cubeMeta };
}

export function addPlayer(name: string, isHost = false): Player {
  const session = getState().session;
  if (!session) throw new Error("No lobby has been created yet");
  if (session.status !== "lobby") throw new Error("Cannot join: the draft has already started");
  if (session.players.length >= session.settings.playerCount) throw new Error("Lobby is full");
  if (!name.trim()) throw new Error("Player name is required");

  const player: Player = { id: randomUUID(), name: name.trim(), isHost, connected: true };
  session.players.push(player);
  session.pools[player.id] = [];
  persist();
  return player;
}

export function setPlayerConnected(playerId: string, connected: boolean): void {
  const session = getState().session;
  const player = session?.players.find((p) => p.id === playerId);
  if (player) {
    player.connected = connected;
    persist();
  }
}

export function beginDraft(): DraftSession {
  const session = getState().session;
  if (!session) throw new Error("No lobby has been created yet");
  const started = startDraft(session, getState().cardPool);
  persist();
  return started;
}

export function cancelDraft(): void {
  state = emptyState();
  persist();
}

export function pick(playerId: string, scryfallId: string): DraftSession {
  const session = getState().session;
  if (!session) throw new Error("No lobby has been created yet");
  const updated = submitPick(session, playerId, scryfallId);
  persist();
  return updated;
}

export function getReadyPlayers(): Record<string, Card[]> {
  return getState().readyPlayers;
}

/**
 * Locks in `scryfallIds` as playerId's deck, marking them ready to play.
 * Each id must match an as-yet-unclaimed card in that player's own drafted
 * pool — repeats are fine (that's how multiple copies get in), but you can't
 * submit more copies of a card than you actually drafted.
 */
export function submitDeck(playerId: string, scryfallIds: string[]): void {
  const session = getState().session;
  if (!session) throw new Error("No lobby has been created yet");
  if (session.status !== "complete") throw new Error("Cannot ready up before the draft is complete");
  if (!session.players.some((p) => p.id === playerId)) throw new Error("Not part of this draft");
  if (scryfallIds.length === 0) throw new Error("Deck cannot be empty");

  const remainingPool = [...(session.pools[playerId] ?? [])];
  const deck: Card[] = [];
  for (const scryfallId of scryfallIds) {
    const index = remainingPool.findIndex((c) => c.scryfallId === scryfallId);
    if (index === -1) throw new Error("Deck contains a card not in your drafted pool");
    deck.push(remainingPool.splice(index, 1)[0]!);
  }

  getState().readyPlayers[playerId] = deck;
  persist();
}

export function unready(playerId: string): void {
  if (getState().activePlayerMatch[playerId]) throw new Error("Cannot edit your deck while in a match");
  delete getState().readyPlayers[playerId];
  persist();
}

/** Ready, and not already seated in a match. */
function isIdle(playerId: string): boolean {
  const s = getState();
  return Boolean(s.readyPlayers[playerId]) && !s.activePlayerMatch[playerId];
}

export function getPendingChallenge(playerId: string): { fromId: string } | undefined {
  return getState().pendingChallenges[playerId];
}

export function challenge(fromId: string, opponentId: string): void {
  if (fromId === opponentId) throw new Error("You can't challenge yourself");
  if (!isIdle(fromId)) throw new Error("You must be ready and not already in a match to challenge someone");
  if (!isIdle(opponentId)) throw new Error("That player isn't available to challenge right now");

  getState().pendingChallenges[opponentId] = { fromId };
  persist();
}

/** Accepts or declines the pending challenge from `fromId` to `playerId`, dealing an opening hand to both on acceptance. */
export function respondToChallenge(playerId: string, fromId: string, accept: boolean): MatchSession | undefined {
  const s = getState();
  const pending = s.pendingChallenges[playerId];
  if (!pending || pending.fromId !== fromId) throw new Error("No matching challenge to respond to");
  delete s.pendingChallenges[playerId];

  if (!accept) {
    persist();
    return undefined;
  }
  if (!isIdle(fromId) || !isIdle(playerId)) {
    persist();
    throw new Error("One of you is no longer available to play");
  }

  const match = createMatch(fromId, s.readyPlayers[fromId]!, playerId, s.readyPlayers[playerId]!);
  s.matches[match.id] = match;
  s.activePlayerMatch[fromId] = match.id;
  s.activePlayerMatch[playerId] = match.id;
  persist();
  return match;
}

export function getActiveMatch(playerId: string): MatchSession | undefined {
  const matchId = getState().activePlayerMatch[playerId];
  return matchId ? getState().matches[matchId] : undefined;
}

function requireActiveMatch(playerId: string): MatchSession {
  const match = getActiveMatch(playerId);
  if (!match) throw new Error("You're not currently in a match");
  return match;
}

/** Ends the match `playerId` is in, freeing both participants back to the hub. */
export function concede(playerId: string): MatchSession {
  const match = requireActiveMatch(playerId);
  const s = getState();
  delete s.matches[match.id];
  for (const p of match.players) delete s.activePlayerMatch[p];
  persist();
  return match;
}

export function drawCard(playerId: string): MatchSession {
  const match = requireActiveMatch(playerId);
  engineDrawCard(match, playerId);
  persist();
  return match;
}

export function shuffleLibrary(playerId: string): MatchSession {
  const match = requireActiveMatch(playerId);
  engineShuffleLibrary(match, playerId);
  persist();
  return match;
}

export function mulligan(playerId: string): MatchSession {
  const match = requireActiveMatch(playerId);
  engineMulligan(match, playerId);
  persist();
  return match;
}

export function moveCard(
  playerId: string,
  instanceId: string,
  toZone: Zone,
  toLibraryPosition?: "top" | "bottom",
  battlefieldTarget?: { row: number; stackId?: string }
): MatchSession {
  const match = requireActiveMatch(playerId);
  engineMoveCard(match, playerId, instanceId, toZone, toLibraryPosition, battlefieldTarget);
  persist();
  return match;
}

export function tapCard(playerId: string, instanceId: string, tapped: boolean): MatchSession {
  const match = requireActiveMatch(playerId);
  engineTapCard(match, playerId, instanceId, tapped);
  persist();
  return match;
}

export function untapAll(playerId: string): MatchSession {
  const match = requireActiveMatch(playerId);
  engineUntapAll(match, playerId);
  persist();
  return match;
}

export function setCardCounter(playerId: string, instanceId: string, label: string, delta: number): MatchSession {
  const match = requireActiveMatch(playerId);
  engineSetCardCounter(match, playerId, instanceId, label, delta);
  persist();
  return match;
}

export function setBattlefieldSlot(playerId: string, instanceId: string, row: number, stackId?: string): MatchSession {
  const match = requireActiveMatch(playerId);
  engineSetBattlefieldSlot(match, playerId, instanceId, row, stackId);
  persist();
  return match;
}

export function flipFaceDown(playerId: string, instanceId: string, faceDown: boolean): MatchSession {
  const match = requireActiveMatch(playerId);
  engineFlipFaceDown(match, playerId, instanceId, faceDown);
  persist();
  return match;
}

export function createToken(playerId: string, label: string): MatchSession {
  const match = requireActiveMatch(playerId);
  engineCreateToken(match, playerId, label);
  persist();
  return match;
}

export function deleteToken(playerId: string, instanceId: string): MatchSession {
  const match = requireActiveMatch(playerId);
  engineDeleteToken(match, playerId, instanceId);
  persist();
  return match;
}

/** Read-only: never mutates state, so no persist. */
export function peekLibrary(playerId: string, count: number): CardInstance[] {
  const match = requireActiveMatch(playerId);
  return enginePeekLibrary(match, playerId, count);
}

/** Read-only: never mutates state, so no persist. Returns the match too, so the caller can find both participants' sockets. */
export function findOwnCard(playerId: string, instanceId: string): { match: MatchSession; card: CardInstance } {
  const match = requireActiveMatch(playerId);
  const card = engineFindOwnCard(match, playerId, instanceId);
  return { match, card };
}

export function setPlayerCounter(playerId: string, label: string, delta: number): MatchSession {
  const match = requireActiveMatch(playerId);
  engineSetPlayerCounter(match, playerId, label, delta);
  persist();
  return match;
}
