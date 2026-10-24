import { randomUUID } from "node:crypto";
import type { Card, DraftSettings, Player } from "@draft-simulator/shared";
import { importCubeFromCubeCobra } from "../cubeImport/cubeCobraImporter.js";
import {
  createDraftSession,
  startDraft,
  submitPick,
  type DraftSession,
  type PickOutcome,
} from "../draftEngine/draftEngine.js";
import { loadSnapshot, resetSnapshotStoreForTests, saveSnapshot } from "./snapshotStore.js";

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

function getState(): LobbyManagerState {
  if (!state) {
    state = (loadSnapshot() as LobbyManagerState | undefined) ?? { cardPool: [] };
  }
  return state;
}

const stateChangeListeners = new Set<() => void>();

/** Calls `listener` after every change to the lobby or draft; returns a function that stops it. */
export function onStateChange(listener: () => void): () => void {
  stateChangeListeners.add(listener);
  return () => stateChangeListeners.delete(listener);
}

/** Saves the current state to disk and tells the listeners; see saveSnapshot for why this never throws. */
function persist(): void {
  saveSnapshot(getState());
  // Runs inside every change, picks included: a failing listener (the
  // management UI) must not turn a pick into an error for the player.
  for (const listener of stateChangeListeners) {
    try {
      listener();
    } catch (err) {
      console.error("A lobby state listener failed:", err);
    }
  }
}

/** Test-only: forces a clean in-memory state pointed at an isolated snapshot file. */
export function resetForTests(isolatedSnapshotPath: string): void {
  resetSnapshotStoreForTests(isolatedSnapshotPath);
  state = { cardPool: [] };
}

/** Test-only: drops the in-memory state so the next access reloads the snapshot, as a server restart would. */
export function reloadFromSnapshotForTests(): void {
  state = undefined;
}

export function getSession(): DraftSession | undefined {
  return getState().session;
}

export function getCubeMeta(): CubeMeta | undefined {
  return getState().cubeMeta;
}

function validateNewLobbyInputs(cubeIdOrUrl: string, packCount: number, packSize: number, playerCount: number): void {
  const current = getState().session;
  if (current && current.status !== "complete") {
    throw new Error("A draft is already in progress or waiting to start on this server");
  }
  if (!cubeIdOrUrl.trim()) throw new Error("Cube URL or ID is required");
  if (!Number.isInteger(playerCount) || playerCount < 2) throw new Error("Need at least 2 players");
  if (!Number.isInteger(packCount) || packCount < 1) throw new Error("Need at least 1 pack");
  if (!Number.isInteger(packSize) || packSize < 1) throw new Error("Packs need at least 1 card");
}

/** Opens a lobby with no players yet: everyone, the host included, joins it from the player page. */
export async function createLobby(
  cubeIdOrUrl: string,
  packCount: number,
  packSize: number,
  playerCount: number,
  alternatingDraft: boolean
): Promise<{ cubeMeta: CubeMeta }> {
  validateNewLobbyInputs(cubeIdOrUrl, packCount, packSize, playerCount);
  const imported = await importCubeFromCubeCobra(cubeIdOrUrl);
  return createLobbyFromResolvedCube(imported.cubeName, imported.cards, imported.unresolvedNames, {
    cubeId: cubeIdOrUrl,
    packCount,
    packSize,
    playerCount,
    alternatingDraft,
  });
}

/**
 * Builds a fresh lobby from an already-resolved cube, skipping the
 * network-dependent CubeCobra/Scryfall lookup. `createLobby` is the normal
 * entry point; this is exported separately so lobby/session logic can be
 * tested without network access.
 */
export function createLobbyFromResolvedCube(
  cubeName: string,
  cards: Card[],
  unresolvedCardNames: string[],
  settings: DraftSettings
): { cubeMeta: CubeMeta } {
  const cubeMeta: CubeMeta = { cubeName, cardCount: cards.length, unresolvedCardNames };
  state = {
    session: createDraftSession(randomUUID(), settings, []),
    cardPool: cards,
    cubeMeta,
  };
  persist();
  return { cubeMeta };
}

export function addPlayer(name: string): Player {
  const session = getState().session;
  if (!session) throw new Error("No lobby has been created yet");
  if (session.status !== "lobby") throw new Error("Cannot join: the draft has already started");
  if (session.players.length >= session.settings.playerCount) throw new Error("Lobby is full");
  if (!name.trim()) throw new Error("Player name is required");

  const player: Player = { id: randomUUID(), name: name.trim(), connected: true };
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

export function pick(playerId: string, scryfallId: string): PickOutcome {
  const session = getState().session;
  if (!session) throw new Error("No lobby has been created yet");
  const outcome = submitPick(session, playerId, scryfallId);
  persist();
  return outcome;
}
