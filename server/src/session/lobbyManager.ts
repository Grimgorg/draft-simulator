import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { Card, DraftSettings, Player } from "@draft-simulator/shared";
import { DATA_DIR } from "../db/database.js";
import { importCubeFromCubeCobra } from "../cubeImport/cubeCobraImporter.js";
import { createDraftSession, startDraft, submitPick, type DraftSession } from "../draftEngine/draftEngine.js";

interface CubeMeta {
  cubeName: string;
  cardCount: number;
  unresolvedCardNames: string[];
}

interface LobbyManagerState {
  session?: DraftSession;
  cardPool: Card[];
  cubeMeta?: CubeMeta;
}

// Lazily initialized so tests can point DRAFT_SNAPSHOT_PATH at an isolated
// file (via resetForTests) before the first real disk read happens.
let state: LobbyManagerState | undefined;

function snapshotPath(): string {
  return process.env.DRAFT_SNAPSHOT_PATH ?? path.join(DATA_DIR, "draft-session.json");
}

function loadState(): LobbyManagerState {
  try {
    const file = snapshotPath();
    if (fs.existsSync(file)) {
      return JSON.parse(fs.readFileSync(file, "utf8")) as LobbyManagerState;
    }
  } catch (err) {
    console.error("Failed to load draft session snapshot, starting fresh:", err);
  }
  return { cardPool: [] };
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
  fs.writeFileSync(file, JSON.stringify(getState(), null, 2));
}

/** Test-only: forces a clean in-memory state pointed at an isolated snapshot file. */
export function resetForTests(isolatedSnapshotPath: string): void {
  process.env.DRAFT_SNAPSHOT_PATH = isolatedSnapshotPath;
  state = { cardPool: [] };
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
  const newState: LobbyManagerState = {
    session: createDraftSession(randomUUID(), settings, []),
    cardPool: cards,
    cubeMeta,
  };
  state = newState;

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
  state = { cardPool: [] };
  persist();
}

export function pick(playerId: string, scryfallId: string): DraftSession {
  const session = getState().session;
  if (!session) throw new Error("No lobby has been created yet");
  const updated = submitPick(session, playerId, scryfallId);
  persist();
  return updated;
}
