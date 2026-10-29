import { randomUUID } from "node:crypto";
import type { Card, DraftSettings, Player } from "@draft-simulator/shared";
import { WINSTON_PLAYERS } from "@draft-simulator/shared";
import { findSetPrintings } from "../cardData/cardRepository.js";
import { importCubeFromCubeCobra } from "../cubeImport/cubeCobraImporter.js";
import {
  beginDraftWithPacks,
  createDraftSession,
  submitPick,
  type DraftSession,
  type PickOutcome,
} from "../draftEngine/draftEngine.js";
import { generatePacks } from "../draftEngine/packGenerator.js";
import { passPile, startWinstonDraft, takePile, type WinstonOutcome } from "../draftEngine/winstonDraft.js";
import type { RandomSource } from "../setBoosters/boosterSheets.js";
import { buildSetBooster, findDraftableSet, generateSetPacks, printingSetsFor } from "../setBoosters/setBoosters.js";
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

/** The current cube draft's cards, for players to look through while they wait. */
export function getCubeCards(): { cubeName: string; cards: Card[]; unresolvedNames: string[] } {
  const { session, cardPool, cubeMeta } = getState();
  if (!session || !cubeMeta) throw new Error("No lobby has been created yet");
  if (session.settings.setCode !== undefined) throw new Error("This draft deals from a set's boosters, not a cube");
  return { cubeName: cubeMeta.cubeName, cards: cardPool, unresolvedNames: cubeMeta.unresolvedCardNames };
}

/** Opens one booster of the current set draft's set, to show what its packs look like. Deals it to no one. */
export function openSamplePack(random: RandomSource = Math.random): Card[] {
  const session = getState().session;
  if (!session) throw new Error("No lobby has been created yet");
  const { setCode } = session.settings;
  if (setCode === undefined) throw new Error("This draft deals from a cube, not a set draft's boosters");
  return buildSetBooster(setCode, findSetPrintings(printingSetsFor(setCode))).generatePack(random);
}

function validateNewLobbyInputs(packCount: number, packSize: number): void {
  const current = getState().session;
  if (current && current.status !== "complete") {
    throw new Error("A draft is already in progress or waiting to start on this server");
  }
  if (!Number.isInteger(packCount) || packCount < 1) throw new Error("Need at least 1 pack");
  if (!Number.isInteger(packSize) || packSize < 1) throw new Error("Packs need at least 1 card");
}

/** Only a Winston draft records its format, so a normal draft's settings stay as they were before Winston. */
function formatSetting(format: DraftSettings["format"]): Pick<DraftSettings, "format"> {
  return format === "winston" ? { format } : {};
}

/** Opens a lobby with no players yet: everyone, the host included, joins it from the player page. */
export async function createLobby(
  cubeIdOrUrl: string,
  packCount: number,
  packSize: number,
  alternatingDraft: boolean,
  format?: DraftSettings["format"]
): Promise<{ cubeMeta: CubeMeta }> {
  validateNewLobbyInputs(packCount, packSize);
  if (!cubeIdOrUrl.trim()) throw new Error("Cube URL or ID is required");
  const imported = await importCubeFromCubeCobra(cubeIdOrUrl);
  return createLobbyFromResolvedCube(imported.cubeName, imported.cards, imported.unresolvedNames, {
    ...formatSetting(format),
    cubeId: cubeIdOrUrl,
    packCount,
    packSize,
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

/**
 * Opens a lobby for a draft of the set's boosters. Builds the booster once to check that the card database has
 * every printing its packs need, so a missing one shows up now rather than when the draft starts.
 */
export function createSetLobby(
  setCode: string,
  packCount: number,
  alternatingDraft: boolean,
  format?: DraftSettings["format"]
): { cubeMeta: CubeMeta } {
  const set = findDraftableSet(setCode);
  validateNewLobbyInputs(packCount, set.packSize);
  const booster = buildSetBooster(setCode, findSetPrintings(printingSetsFor(setCode)));

  const cubeMeta: CubeMeta = { cubeName: set.name, cardCount: booster.cardCount, unresolvedCardNames: [] };
  state = {
    session: createDraftSession(
      randomUUID(),
      { ...formatSetting(format), setCode, packCount, packSize: set.packSize, alternatingDraft },
      []
    ),
    cardPool: [],
    cubeMeta,
  };
  persist();
  return { cubeMeta };
}

export function addPlayer(name: string): Player {
  const session = getState().session;
  if (!session) throw new Error("No lobby has been created yet");
  if (session.status !== "lobby") throw new Error("Cannot join: the draft has already started");
  if (!name.trim()) throw new Error("Player name is required");
  if (session.settings.format === "winston" && session.players.length >= WINSTON_PLAYERS) {
    throw new Error(`Cannot join: this Winston draft already has its ${WINSTON_PLAYERS} players`);
  }

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
  const { setCode, packCount, format } = session.settings;
  // A Winston draft opens the same packs as a normal one, then shuffles them into its stack.
  const packQueue =
    setCode === undefined
      ? generatePacks(getState().cardPool, session.settings, session.players.length)
      : generateSetPacks(
          buildSetBooster(setCode, findSetPrintings(printingSetsFor(setCode))),
          packCount,
          session.players.length
        );
  const started =
    format === "winston" ? startWinstonDraft(session, packQueue) : beginDraftWithPacks(session, packQueue);
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

/** The Winston draft's active player takes the pile they're looking at (`pileIndex`). */
export function takeWinstonPile(playerId: string, pileIndex: number): WinstonOutcome {
  const session = getState().session;
  if (!session) throw new Error("No lobby has been created yet");
  const outcome = takePile(session, playerId, pileIndex);
  persist();
  return outcome;
}

/** The Winston draft's active player passes the pile they're looking at (`pileIndex`). */
export function passWinstonPile(playerId: string, pileIndex: number): WinstonOutcome {
  const session = getState().session;
  if (!session) throw new Error("No lobby has been created yet");
  const outcome = passPile(session, playerId, pileIndex);
  persist();
  return outcome;
}
