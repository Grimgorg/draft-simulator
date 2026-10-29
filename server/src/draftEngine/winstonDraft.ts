import type { Card, Pack, WinstonTableView } from "@draft-simulator/shared";
import { WINSTON_PILE_COUNT, WINSTON_PLAYERS } from "@draft-simulator/shared";
import type { DraftSession, WinstonTable } from "./draftEngine.js";
import { shuffle } from "./packGenerator.js";

// The rules of a Winston draft, from docs/winston-draft.md: change both together. Like draftEngine.ts it mutates
// the session in place.

/**
 * What a Winston action did, so callers know what changed:
 * - "nextPile": the player passed and now looks at another pile.
 * - "turnEnded": the player got their cards, and it's the other player's turn.
 * - "draftComplete": the stack and every pile are empty.
 */
export type WinstonOutcome = "nextPile" | "turnEnded" | "draftComplete";

/** Shuffles every pack's cards into one stack, as players do with the boosters they open, and starts the draft. */
export function startWinstonDraft(session: DraftSession, packQueue: Pack[][]): DraftSession {
  return beginWinstonDraft(session, shuffle(packQueue.flat().flatMap((pack) => pack.cards)));
}

/**
 * Starts a Winston draft from a stack in a fixed order, its top card first. `startWinstonDraft` is the normal
 * entry point; this is exported separately so the rules can be tested without depending on shuffle output.
 */
export function beginWinstonDraft(session: DraftSession, stack: Card[]): DraftSession {
  if (session.status !== "lobby") {
    throw new Error(`Cannot start a draft in status "${session.status}"`);
  }
  if (session.players.length !== WINSTON_PLAYERS) {
    throw new Error(`A Winston draft needs exactly ${WINSTON_PLAYERS} players`);
  }
  if (stack.length < WINSTON_PILE_COUNT) {
    throw new Error(`A Winston draft needs at least ${WINSTON_PILE_COUNT} cards`);
  }

  const cards = [...stack];
  const piles = cards.splice(0, WINSTON_PILE_COUNT).map((card) => [card]);
  session.winston = { stack: cards, piles, activeSeat: 0, pileIndex: 0 };
  session.status = "drafting";
  // Winston has no packs. Pick numbers count turns, so a pick record says which turn took it.
  session.currentPackNumber = 1;
  session.currentPickNumber = 1;
  session.currentPacks = {};
  session.waitingOn = [session.players[0]!.id];
  return session;
}

/** The active player takes the whole pile they're looking at; it starts again with the stack's top card. */
export function takePile(session: DraftSession, playerId: string, pileIndex: number): WinstonOutcome {
  const table = activeTable(session, playerId, pileIndex);
  const pile = table.piles[pileIndex]!;
  table.piles[pileIndex] = table.stack.length > 0 ? [table.stack.shift()!] : [];
  addToPool(session, playerId, pile);
  return endTurn(session, table);
}

/**
 * The active player passes the pile they're looking at: it gets the stack's top card, and they look at the next
 * pile. Passing the last pile gets them the stack's next card, unseen, instead.
 */
export function passPile(session: DraftSession, playerId: string, pileIndex: number): WinstonOutcome {
  const table = activeTable(session, playerId, pileIndex);
  if (!canPass(table)) {
    throw new Error("This is the last pile and the stack is empty: take it");
  }

  const nextPile = nextNonEmptyPile(table, pileIndex + 1);
  if (nextPile !== undefined) {
    if (table.stack.length > 0) table.piles[pileIndex]!.push(table.stack.shift()!);
    table.pileIndex = nextPile;
    return "nextPile";
  }

  // Passing the last pile. With one stack card left, adding it to the pile would leave none to draw, so the
  // player draws it instead (canPass guarantees there is one): every turn gets its player a card.
  if (table.stack.length > 1) table.piles[pileIndex]!.push(table.stack.shift()!);
  addToPool(session, playerId, [table.stack.shift()!]);
  return endTurn(session, table);
}

/** The cards of the pile `playerId` is looking at, or null when it isn't their turn. */
export function buildWinstonPile(session: DraftSession, playerId: string): Card[] | null {
  const table = session.winston;
  if (session.status !== "drafting" || !table) return null;
  if (session.players[table.activeSeat]?.id !== playerId) return null;
  return table.piles[table.pileIndex] ?? null;
}

/** What both players can see of the table: sizes and whose turn, never cards. */
export function buildWinstonTableView(session: DraftSession): WinstonTableView | undefined {
  const table = session.winston;
  if (session.status !== "drafting" || !table) return undefined;
  return {
    activePlayerId: session.players[table.activeSeat]!.id,
    pileIndex: table.pileIndex,
    pileSizes: table.piles.map((pile) => pile.length),
    stackCount: table.stack.length,
    canPass: canPass(table),
  };
}

/**
 * A player may pass only while that still gets them a card this turn: a later pile has cards, or the stack has
 * one to draw. So once the stack is empty, the last pile left must be taken, and the draft always ends.
 */
function canPass(table: WinstonTable): boolean {
  return nextNonEmptyPile(table, table.pileIndex + 1) !== undefined || table.stack.length > 0;
}

/** The first pile from `from` on that has cards. Piles empty out only once the stack has, and are skipped. */
function nextNonEmptyPile(table: WinstonTable, from: number): number | undefined {
  for (let i = from; i < table.piles.length; i++) {
    if (table.piles[i]!.length > 0) return i;
  }
  return undefined;
}

function activeTable(session: DraftSession, playerId: string, pileIndex: number): WinstonTable {
  const table = session.winston;
  if (session.status !== "drafting" || !table) {
    throw new Error(`Cannot take or pass a pile while draft status is "${session.status}"`);
  }
  if (session.players[table.activeSeat]?.id !== playerId) {
    throw new Error("It's not your turn");
  }
  if (pileIndex !== table.pileIndex) {
    throw new Error(`You're looking at pile ${table.pileIndex + 1}, not pile ${pileIndex + 1}`);
  }
  return table;
}

function addToPool(session: DraftSession, playerId: string, cards: Card[]): void {
  for (const card of cards) {
    session.pools[playerId]!.push(card);
    session.picks.push({
      playerId,
      packNumber: session.currentPackNumber,
      pickNumber: session.currentPickNumber,
      scryfallId: card.scryfallId,
      timestamp: Date.now(),
    });
  }
}

function endTurn(session: DraftSession, table: WinstonTable): "turnEnded" | "draftComplete" {
  const firstPile = nextNonEmptyPile(table, 0);
  if (firstPile === undefined) {
    session.status = "complete";
    session.waitingOn = [];
    return "draftComplete";
  }

  table.activeSeat = (table.activeSeat + 1) % session.players.length;
  table.pileIndex = firstPile;
  session.currentPickNumber += 1;
  session.waitingOn = [session.players[table.activeSeat]!.id];
  return "turnEnded";
}
