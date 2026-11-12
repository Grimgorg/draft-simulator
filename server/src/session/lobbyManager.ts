import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import type { Card, DraftSettings, Player } from "@draft-simulator/shared";
import {
  MAX_PACK_COUNT,
  MAX_PACK_SIZE,
  MAX_PLAYER_NAME_LENGTH,
  MAX_PLAYERS,
  WINSTON_PLAYERS,
} from "@draft-simulator/shared";
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

/**
 * How many drafts may wait for players or be drafted at once. Each one imports a cube, so a stray loop of
 * create clicks can't keep a host's server importing forever. Finished drafts don't count.
 */
export const MAX_OPEN_DRAFTS = 10;
/** How long a finished draft stays, for deck building, before it's removed. */
export const FINISHED_DRAFT_TTL_MS = 24 * 60 * 60 * 1000;

interface CubeMeta {
  cubeName: string;
  cardCount: number;
  unresolvedCardNames: string[];
}

/** One draft on the server. Its id is `session.id`. */
export interface DraftEntry {
  session: DraftSession;
  cardPool: Card[];
  cubeMeta: CubeMeta;
  /** Milliseconds since the epoch. */
  createdAt: number;
  /** When the last pick finished the draft; FINISHED_DRAFT_TTL_MS later it's removed. */
  completedAt?: number;
  /**
   * Player id -> SHA-256 of their seat token, hex. A player without one has a claimable seat. Missing in snapshots
   * from before seats had tokens, whose seats are all claimable until their players take them back.
   */
  seatTokenHashes?: Record<string, string>;
}

interface LobbyManagerState {
  /** Oldest first. */
  drafts: DraftEntry[];
}

/** The snapshot from before a server held more than one draft: one session, or none. */
interface SingleDraftSnapshot {
  session?: DraftSession;
  cardPool?: Card[];
  cubeMeta?: CubeMeta;
}

// Lazily initialized so tests can point DRAFT_SNAPSHOT_PATH at an isolated
// file (via resetForTests) before the first real disk read happens.
let state: LobbyManagerState | undefined;

function getState(): LobbyManagerState {
  if (!state) {
    state = fromSnapshot(loadSnapshot());
  }
  return state;
}

/**
 * Reads either snapshot shape. A server updated in the middle of a draft saved the single-draft shape, and its
 * players are waiting to reconnect to that draft.
 */
function fromSnapshot(saved: unknown): LobbyManagerState {
  if (saved && typeof saved === "object" && Array.isArray((saved as LobbyManagerState).drafts)) {
    return saved as LobbyManagerState;
  }
  const { session, cardPool, cubeMeta } = (saved ?? {}) as SingleDraftSnapshot;
  if (!session || !cubeMeta) return { drafts: [] };
  const now = Date.now();
  return {
    drafts: [
      {
        session,
        cardPool: cardPool ?? [],
        cubeMeta,
        createdAt: now,
        // Its real end isn't known: give its players the full time to finish their decks.
        ...(session.status === "complete" ? { completedAt: now } : {}),
      },
    ],
  };
}

const stateChangeListeners = new Set<() => void>();

/** Calls `listener` after every change to any draft; returns a function that stops it. */
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
  state = { drafts: [] };
}

/** Test-only: drops the in-memory state so the next access reloads the snapshot, as a server restart would. */
export function reloadFromSnapshotForTests(): void {
  state = undefined;
}

/** Every draft, oldest first. */
export function listDrafts(): readonly DraftEntry[] {
  return getState().drafts;
}

function findEntry(draftId: string): DraftEntry | undefined {
  return getState().drafts.find((entry) => entry.session.id === draftId);
}

function getEntry(draftId: string): DraftEntry {
  const entry = findEntry(draftId);
  if (!entry) throw new Error("This draft doesn't exist anymore");
  return entry;
}

export function getSession(draftId: string): DraftSession | undefined {
  return findEntry(draftId)?.session;
}

export function getCubeMeta(draftId: string): CubeMeta | undefined {
  return findEntry(draftId)?.cubeMeta;
}

/** The player who created the draft: the first one seated, who can't leave it before it starts. */
export function getCreatorPlayerId(draftId: string): string | undefined {
  return findEntry(draftId)?.session.players[0]?.id;
}

/** The cube draft's cards, for players to look through while they wait. */
export function getCubeCards(draftId: string): { cubeName: string; cards: Card[]; unresolvedNames: string[] } {
  const { session, cardPool, cubeMeta } = getEntry(draftId);
  if (session.settings.setCode !== undefined) throw new Error("This draft deals from a set's boosters, not a cube");
  return { cubeName: cubeMeta.cubeName, cards: cardPool, unresolvedNames: cubeMeta.unresolvedCardNames };
}

/** Opens one booster of the set draft's set, to show what its packs look like. Deals it to no one. */
export function openSamplePack(draftId: string, random: RandomSource = Math.random): Card[] {
  const { setCode } = getEntry(draftId).session.settings;
  if (setCode === undefined) throw new Error("This draft deals from a cube, not a set draft's boosters");
  return buildSetBooster(setCode, findSetPrintings(printingSetsFor(setCode))).generatePack(random);
}

function checkOpenDraftLimit(): void {
  const open = getState().drafts.filter((entry) => entry.session.status !== "complete").length;
  if (open >= MAX_OPEN_DRAFTS) {
    throw new Error(`This server already has ${MAX_OPEN_DRAFTS} drafts going. Wait for one to finish.`);
  }
}

function validateNewLobbyInputs(packCount: number, packSize: number): void {
  checkOpenDraftLimit();
  if (!Number.isInteger(packCount) || packCount < 1) throw new Error("Need at least 1 pack");
  if (packCount > MAX_PACK_COUNT) throw new Error(`A draft can have at most ${MAX_PACK_COUNT} packs per player`);
  if (!Number.isInteger(packSize) || packSize < 1) throw new Error("Packs need at least 1 card");
  if (packSize > MAX_PACK_SIZE) throw new Error(`Packs can have at most ${MAX_PACK_SIZE} cards`);
}

/** Returns the name as it's stored, trimmed. Throws for a blank or overlong one. */
export function validatePlayerName(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) throw new Error("Player name is required");
  if (trimmed.length > MAX_PLAYER_NAME_LENGTH) {
    throw new Error(`Player names can be at most ${MAX_PLAYER_NAME_LENGTH} characters`);
  }
  return trimmed;
}

/** Only a Winston draft records its format, so a normal draft's settings stay as they were before Winston. */
function formatSetting(format: DraftSettings["format"]): Pick<DraftSettings, "format"> {
  return format === "winston" ? { format } : {};
}

function addDraft(settings: DraftSettings, cardPool: Card[], cubeMeta: CubeMeta): { draftId: string; cubeMeta: CubeMeta } {
  // Checked again here: other drafts may have been created while a cube was imported.
  checkOpenDraftLimit();
  const session = createDraftSession(randomUUID(), settings, []);
  getState().drafts.push({ session, cardPool, cubeMeta, createdAt: Date.now() });
  persist();
  return { draftId: session.id, cubeMeta };
}

/** Opens a lobby with no players yet. Whoever joins it first is its creator. */
export async function createLobby(
  cubeIdOrUrl: string,
  packCount: number,
  packSize: number,
  alternatingDraft: boolean,
  format?: DraftSettings["format"]
): Promise<{ draftId: string; cubeMeta: CubeMeta }> {
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
): { draftId: string; cubeMeta: CubeMeta } {
  return addDraft(settings, cards, { cubeName, cardCount: cards.length, unresolvedCardNames });
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
): { draftId: string; cubeMeta: CubeMeta } {
  const set = findDraftableSet(setCode);
  validateNewLobbyInputs(packCount, set.packSize);
  const booster = buildSetBooster(setCode, findSetPrintings(printingSetsFor(setCode)));
  return addDraft(
    { ...formatSetting(format), setCode, packCount, packSize: set.packSize, alternatingDraft },
    [],
    { cubeName: set.name, cardCount: booster.cardCount, unresolvedCardNames: [] }
  );
}

/**
 * Seats a new player and returns the seat's token, which only this caller ever sees. What players join through:
 * addPlayer alone leaves the seat claimable by anyone.
 */
export function joinDraft(draftId: string, name: string): { player: Player; seatToken: string } {
  const player = seatPlayer(draftId, name);
  const seatToken = issueSeatToken(getEntry(draftId), player.id);
  persist();
  return { player, seatToken };
}

/** Seats a new player whose seat anyone can claim, as seats were before they had tokens. */
export function addPlayer(draftId: string, name: string): Player {
  const player = seatPlayer(draftId, name);
  persist();
  return player;
}

function seatPlayer(draftId: string, name: string): Player {
  const { session } = getEntry(draftId);
  if (session.status !== "lobby") throw new Error("Cannot join: the draft has already started");
  const playerName = validatePlayerName(name);
  if (session.settings.format === "winston" && session.players.length >= WINSTON_PLAYERS) {
    throw new Error(`Cannot join: this Winston draft already has its ${WINSTON_PLAYERS} players`);
  }
  if (session.players.length >= MAX_PLAYERS) throw new Error(`Cannot join: this draft already has ${MAX_PLAYERS} players`);

  const player: Player = { id: randomUUID(), name: playerName, connected: true };
  session.players.push(player);
  session.pools[player.id] = [];
  return player;
}

/**
 * Seat tokens. Player ids are public (every drafts:list carries them), and taking a seat back used to need only
 * the id: anyone connected could take any seat, and see its pack and pool. Now it needs the token the browser that
 * took the seat was given. Only its hash is kept, so the snapshot file can't be used to take a seat either.
 */
function hashSeatToken(seatToken: string): Buffer {
  return createHash("sha256").update(seatToken).digest();
}

function issueSeatToken(entry: DraftEntry, playerId: string): string {
  const seatToken = randomBytes(32).toString("base64url");
  (entry.seatTokenHashes ??= {})[playerId] = hashSeatToken(seatToken).toString("hex");
  return seatToken;
}

function findPlayer(entry: DraftEntry, playerId: string): Player {
  const player = entry.session.players.find((p) => p.id === playerId);
  if (!player) throw new Error("No matching player found for this draft");
  return player;
}

/** Whether no browser holds the seat (see SeatView.claimable). */
export function isSeatClaimable(draftId: string, playerId: string): boolean {
  return findEntry(draftId)?.seatTokenHashes?.[playerId] === undefined;
}

/**
 * Takes a seat back with its token, or claims a claimable one, which issues a new token. Returns the token the
 * browser should keep. A seat someone else holds is refused, whatever token comes with it.
 */
export function claimSeat(draftId: string, playerId: string, seatToken: unknown): string {
  const entry = getEntry(draftId);
  findPlayer(entry, playerId);
  const storedHash = entry.seatTokenHashes?.[playerId];
  if (storedHash === undefined) {
    const issued = issueSeatToken(entry, playerId);
    persist();
    return issued;
  }
  // Both are SHA-256 digests, so of equal length, as timingSafeEqual needs.
  if (typeof seatToken === "string" && timingSafeEqual(hashSeatToken(seatToken), Buffer.from(storedHash, "hex"))) {
    return seatToken;
  }
  throw new Error("This seat is held by another browser. Ask the draft's creator or the host to release it.");
}

/** Makes a seat claimable again: for a player who lost the browser that held it. */
export function releaseSeat(draftId: string, playerId: string): void {
  const entry = getEntry(draftId);
  findPlayer(entry, playerId);
  if (entry.seatTokenHashes) delete entry.seatTokenHashes[playerId];
  persist();
}

/** Takes a player out of a draft that hasn't started. Its creator closes it instead. */
export function removePlayer(draftId: string, playerId: string): void {
  const entry = getEntry(draftId);
  const { session } = entry;
  if (session.status !== "lobby") throw new Error("Only a draft that hasn't started can be left");
  if (playerId === getCreatorPlayerId(draftId)) throw new Error("You created this draft: close it instead");
  const index = session.players.findIndex((p) => p.id === playerId);
  if (index === -1) throw new Error("No matching player found for this draft");
  session.players.splice(index, 1);
  delete session.pools[playerId];
  if (entry.seatTokenHashes) delete entry.seatTokenHashes[playerId];
  persist();
}

export function setPlayerConnected(draftId: string, playerId: string, connected: boolean): void {
  const player = findEntry(draftId)?.session.players.find((p) => p.id === playerId);
  if (player) {
    player.connected = connected;
    persist();
  }
}

export function beginDraft(draftId: string): DraftSession {
  const { session, cardPool } = getEntry(draftId);
  const { setCode, packCount, format } = session.settings;
  // A Winston draft opens the same packs as a normal one, then shuffles them into its stack.
  const packQueue =
    setCode === undefined
      ? generatePacks(cardPool, session.settings, session.players.length)
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

/** Removes the draft for everyone, whatever its status. */
export function closeDraft(draftId: string): void {
  getEntry(draftId);
  getState().drafts = getState().drafts.filter((entry) => entry.session.id !== draftId);
  persist();
}

/** Removes the drafts that finished FINISHED_DRAFT_TTL_MS or longer before `now`, and returns their ids. */
export function removeExpiredDrafts(now: number = Date.now()): string[] {
  const expired = getState()
    .drafts.filter((entry) => entry.completedAt !== undefined && now - entry.completedAt >= FINISHED_DRAFT_TTL_MS)
    .map((entry) => entry.session.id);
  if (expired.length > 0) {
    getState().drafts = getState().drafts.filter((entry) => !expired.includes(entry.session.id));
    persist();
  }
  return expired;
}

/** Runs one player action on the draft, notes when it finished the draft, and saves. */
function act<T>(draftId: string, action: (session: DraftSession) => T): T {
  const entry = getEntry(draftId);
  const outcome = action(entry.session);
  if (entry.session.status === "complete" && entry.completedAt === undefined) entry.completedAt = Date.now();
  persist();
  return outcome;
}

export function pick(draftId: string, playerId: string, scryfallId: string): PickOutcome {
  return act(draftId, (session) => submitPick(session, playerId, scryfallId));
}

/** The Winston draft's active player takes the pile they're looking at (`pileIndex`). */
export function takeWinstonPile(draftId: string, playerId: string, pileIndex: number): WinstonOutcome {
  return act(draftId, (session) => takePile(session, playerId, pileIndex));
}

/** The Winston draft's active player passes the pile they're looking at (`pileIndex`). */
export function passWinstonPile(draftId: string, playerId: string, pileIndex: number): WinstonOutcome {
  return act(draftId, (session) => passPile(session, playerId, pileIndex));
}
