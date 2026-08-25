import { randomUUID } from "node:crypto";
import type { Card, CardInstance, Zone } from "@draft-simulator/shared";

export interface MatchPlayerBoard {
  /** Ordered top to bottom; index 0 is the top of the library. */
  library: CardInstance[];
  hand: CardInstance[];
  battlefield: CardInstance[];
  graveyard: CardInstance[];
  exile: CardInstance[];
  counters: Record<string, number>;
}

/** Server-only match state — never sent to a client directly; matchStateView.ts builds the private per-player wire view from this. */
export interface MatchSession {
  id: string;
  players: [string, string];
  boards: Record<string, MatchPlayerBoard>;
}

const OPENING_HAND_SIZE = 7;
const STARTING_LIFE = 20;

function shuffled<T>(items: T[]): T[] {
  const result = [...items];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

function dealOpeningBoard(deck: Card[]): MatchPlayerBoard {
  const library = shuffled(deck.map((card): CardInstance => ({ instanceId: randomUUID(), card })));
  const hand = library.splice(0, Math.min(OPENING_HAND_SIZE, library.length));
  return { library, hand, battlefield: [], graveyard: [], exile: [], counters: { life: STARTING_LIFE } };
}

/** Shuffles each deck into a library and deals an opening hand for both players. */
export function createMatch(playerAId: string, deckA: Card[], playerBId: string, deckB: Card[]): MatchSession {
  return {
    id: randomUUID(),
    players: [playerAId, playerBId],
    boards: {
      [playerAId]: dealOpeningBoard(deckA),
      [playerBId]: dealOpeningBoard(deckB),
    },
  };
}

function requireBoard(match: MatchSession, playerId: string): MatchPlayerBoard {
  const board = match.boards[playerId];
  if (!board) throw new Error("Not a participant in this match");
  return board;
}

/** Moves the top card of playerId's library into their hand. */
export function drawCard(match: MatchSession, playerId: string): void {
  const board = requireBoard(match, playerId);
  const card = board.library.shift();
  if (!card) throw new Error("Your library is empty");
  board.hand.push(card);
}

export function shuffleLibrary(match: MatchSession, playerId: string): void {
  const board = requireBoard(match, playerId);
  board.library = shuffled(board.library);
}

/** A simple free mulligan: shuffles the current hand back into the library, then draws a fresh opening hand. No rules enforcement — this can be called repeatedly. */
export function mulligan(match: MatchSession, playerId: string): void {
  const board = requireBoard(match, playerId);
  board.library = shuffled([...board.library, ...board.hand]);
  board.hand = board.library.splice(0, Math.min(OPENING_HAND_SIZE, board.library.length));
}

/**
 * Every zone on a player's board. A client only ever legitimately learns a
 * library instance id via peekLibrary (or drawCard, which removes it
 * outright) — never from match:state, which omits library contents entirely.
 */
const ALL_ZONES = ["library", "hand", "battlefield", "graveyard", "exile"] as const;

function removeFromKnownZone(board: MatchPlayerBoard, instanceId: string): CardInstance {
  for (const zone of ALL_ZONES) {
    const list = board[zone];
    const index = list.findIndex((c) => c.instanceId === instanceId);
    if (index !== -1) return list.splice(index, 1)[0]!;
  }
  throw new Error("Card not found in any of your own zones");
}

/** Returns, without removing, the top `count` cards of playerId's library (clamped to its actual size) — for a private client-side peek. Pass the library's full size to "search" it. */
export function peekLibrary(match: MatchSession, playerId: string, count: number): CardInstance[] {
  const board = requireBoard(match, playerId);
  return board.library.slice(0, Math.max(0, Math.min(count, board.library.length)));
}

/** Finds one of playerId's own cards in any zone (including the library), for a reveal — never mutates anything. */
export function findOwnCard(match: MatchSession, playerId: string, instanceId: string): CardInstance {
  const board = requireBoard(match, playerId);
  for (const zone of ALL_ZONES) {
    const card = board[zone].find((c) => c.instanceId === instanceId);
    if (card) return card;
  }
  throw new Error("Card not found in any of your own zones");
}

interface BattlefieldTarget {
  row: number;
  stackId?: string;
}

function addToZone(
  board: MatchPlayerBoard,
  zone: Zone,
  card: CardInstance,
  libraryPosition: "top" | "bottom",
  battlefieldTarget?: BattlefieldTarget
): void {
  if (zone === "library") {
    if (libraryPosition === "top") board.library.unshift(card);
    else board.library.push(card);
    return;
  }
  if (zone === "battlefield") {
    card.tapped = false;
    card.counters = {};
    card.row = battlefieldTarget?.row ?? 0;
    card.stackId = battlefieldTarget?.stackId ?? card.instanceId;
  } else {
    // Battlefield-only state doesn't carry into a hidden or public non-battlefield zone.
    delete card.tapped;
    delete card.counters;
    delete card.row;
    delete card.stackId;
    delete card.faceDown;
  }
  board[zone].push(card);
}

/**
 * The universal move primitive: relocates one of playerId's own cards from
 * hand/battlefield/graveyard/exile to any zone, including their own library
 * (top or bottom). `battlefieldTarget` places a card landing on the
 * battlefield into a specific row/stack (defaulting to row 0, its own new
 * stack). Only ever touches the caller's own board.
 */
export function moveCard(
  match: MatchSession,
  playerId: string,
  instanceId: string,
  toZone: Zone,
  toLibraryPosition: "top" | "bottom" = "top",
  battlefieldTarget?: BattlefieldTarget
): void {
  const board = requireBoard(match, playerId);
  const card = removeFromKnownZone(board, instanceId);
  addToZone(board, toZone, card, toLibraryPosition, battlefieldTarget);
}

function requireBattlefieldCard(board: MatchPlayerBoard, instanceId: string): CardInstance {
  const card = board.battlefield.find((c) => c.instanceId === instanceId);
  if (!card) throw new Error("Card not found on your battlefield");
  return card;
}

export function tapCard(match: MatchSession, playerId: string, instanceId: string, tapped: boolean): void {
  const board = requireBoard(match, playerId);
  requireBattlefieldCard(board, instanceId).tapped = tapped;
}

export function untapAll(match: MatchSession, playerId: string): void {
  const board = requireBoard(match, playerId);
  for (const card of board.battlefield) card.tapped = false;
}

/** Adds `delta` to a freeform counter on a battlefield card (e.g. "+1/+1", "loyalty"), removing the counter entirely once it reaches zero or below. */
export function setCardCounter(
  match: MatchSession,
  playerId: string,
  instanceId: string,
  label: string,
  delta: number
): void {
  const board = requireBoard(match, playerId);
  const card = requireBattlefieldCard(board, instanceId);
  const counters = card.counters ?? (card.counters = {});
  const next = (counters[label] ?? 0) + delta;
  if (next <= 0) delete counters[label];
  else counters[label] = next;
}

/** Moves a battlefield card to a row/stack slot — omitting `stackId` breaks it out into its own new stack, appended to the end (rightmost) of that row. */
export function setBattlefieldSlot(match: MatchSession, playerId: string, instanceId: string, row: number, stackId?: string): void {
  const board = requireBoard(match, playerId);
  const card = requireBattlefieldCard(board, instanceId);
  card.row = row;
  card.stackId = stackId ?? instanceId;
  // Re-append so it renders as the new top of its (possibly newly-merged) stack.
  board.battlefield.splice(board.battlefield.indexOf(card), 1);
  board.battlefield.push(card);
}

/** Flips a battlefield permanent face-down or face-up. A face-down card's identity is withheld from the opponent (see matchStateView.ts), never from its own owner. */
export function flipFaceDown(match: MatchSession, playerId: string, instanceId: string, faceDown: boolean): void {
  const board = requireBoard(match, playerId);
  requireBattlefieldCard(board, instanceId).faceDown = faceDown;
}

/** Creates a free-text token directly on the battlefield — no card data, just a label. */
export function createToken(match: MatchSession, playerId: string, label: string): void {
  const board = requireBoard(match, playerId);
  const trimmed = label.trim();
  if (!trimmed) throw new Error("Token needs a label");

  const instanceId = randomUUID();
  board.battlefield.push({
    instanceId,
    card: null,
    tokenLabel: trimmed,
    tapped: false,
    counters: {},
    row: 0,
    stackId: instanceId,
  });
}

/**
 * Adds `delta` to one of playerId's own player-level counters (e.g. "life",
 * "poison"). Unlike a card counter, this is never removed at zero — a
 * player's life or poison total is meaningful even at 0, so it always stays
 * visible.
 */
export function setPlayerCounter(match: MatchSession, playerId: string, label: string, delta: number): void {
  const board = requireBoard(match, playerId);
  board.counters[label] = (board.counters[label] ?? 0) + delta;
}

/** Rolls an unbiased die with the given number of sides. Stateless — the caller broadcasts the result. */
export function rollDie(sides: number): number {
  if (!Number.isInteger(sides) || sides < 2) throw new Error("A die needs at least 2 sides");
  return Math.floor(Math.random() * sides) + 1;
}
