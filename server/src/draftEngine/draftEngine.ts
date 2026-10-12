import type { Card, DraftSettings, DraftState, Pack, Player } from "@draft-simulator/shared";
import { passDirection } from "@draft-simulator/shared";
import { generatePacks } from "./packGenerator.js";

/**
 * Server-only draft session state: the wire-safe DraftState plus packs not
 * yet dealt. Mutated in place by the functions below rather than treated
 * immutably — this is a single-process, single-session-at-a-time engine, so
 * there's no benefit to the immutability overhead.
 */
export interface DraftSession extends DraftState {
  /** packQueue[round][seat]: packs not yet dealt. Consumed as pack rounds start. */
  packQueue: Pack[][];
}

/**
 * What a pick did to the draft as a whole, so callers know who needs fresh
 * state without re-deriving it from `waitingOn`:
 * - "waitingOnOthers": the round is still open; only the picker's pack and pool changed.
 * - "roundAdvanced": everyone has picked, so every player now holds a different
 *   pack (passed from a neighbor, or the next pack opened).
 * - "draftComplete": that was the last pick of the draft.
 */
export type PickOutcome = "waitingOnOthers" | "roundAdvanced" | "draftComplete";

export function createDraftSession(id: string, settings: DraftSettings, players: Player[]): DraftSession {
  const pools: Record<string, Card[]> = {};
  for (const player of players) {
    pools[player.id] = [];
  }

  return {
    id,
    status: "lobby",
    settings,
    players,
    currentPackNumber: 0,
    currentPickNumber: 0,
    currentPacks: {},
    waitingOn: [],
    picks: [],
    pools,
    packQueue: [],
  };
}

export function startDraft(session: DraftSession, cardPool: Card[]): DraftSession {
  const packQueue = generatePacks(cardPool, session.settings, session.players.length);
  return beginDraftWithPacks(session, packQueue);
}

/**
 * Starts a draft from a pre-built pack queue, bypassing random pack
 * generation. `startDraft` is the normal entry point; this is exported
 * separately so the round/pass-direction state machine can be tested
 * deterministically without depending on shuffle output.
 */
export function beginDraftWithPacks(session: DraftSession, packQueue: Pack[][]): DraftSession {
  if (session.status !== "lobby") {
    throw new Error(`Cannot start a draft in status "${session.status}"`);
  }
  if (session.players.length !== session.settings.playerCount) {
    throw new Error(
      `Draft configured for ${session.settings.playerCount} players but ${session.players.length} are seated`
    );
  }

  session.packQueue = packQueue;
  session.status = "drafting";
  dealRound(session);
  return session;
}

export function submitPick(session: DraftSession, playerId: string, scryfallId: string): PickOutcome {
  if (session.status !== "drafting") {
    throw new Error(`Cannot pick while draft status is "${session.status}"`);
  }
  if (!session.waitingOn.includes(playerId)) {
    throw new Error(`Player ${playerId} has already picked this round, or is not part of this draft`);
  }

  const pack = session.currentPacks[playerId];
  if (!pack) {
    throw new Error(`Player ${playerId} has no active pack`);
  }
  const cardIndex = pack.cards.findIndex((c) => c.scryfallId === scryfallId);
  if (cardIndex === -1) {
    throw new Error(`Card ${scryfallId} is not in player ${playerId}'s current pack`);
  }

  const [card] = pack.cards.splice(cardIndex, 1);
  session.pools[playerId]!.push(card!);
  session.picks.push({
    playerId,
    packNumber: session.currentPackNumber,
    pickNumber: session.currentPickNumber,
    scryfallId,
    timestamp: Date.now(),
  });
  session.waitingOn = session.waitingOn.filter((id) => id !== playerId);

  if (session.waitingOn.length > 0) {
    return "waitingOnOthers";
  }
  return advanceRound(session);
}

/** Deals the next queued pack round to every player, resetting waitingOn. */
function dealRound(session: DraftSession): void {
  const round = session.packQueue.shift();
  if (!round) {
    throw new Error("No more packs queued");
  }

  session.currentPackNumber += 1;
  session.currentPickNumber = 1;

  const currentPacks: Record<string, Pack> = {};
  session.players.forEach((player, seat) => {
    currentPacks[player.id] = round[seat]!;
  });
  session.currentPacks = currentPacks;
  session.waitingOn = session.players.map((p) => p.id);
}

/** Rotates every player's current pack to their neighbor, per the current pack's pass direction. */
function rotatePacks(session: DraftSession): void {
  const seats = session.players;
  const n = seats.length;
  const direction = passDirection(session.currentPackNumber, session.settings.alternatingDraft);
  const previous = session.currentPacks;

  const next: Record<string, Pack> = {};
  for (let i = 0; i < n; i++) {
    const fromSeat = seats[(i - direction + n) % n]!;
    next[seats[i]!.id] = previous[fromSeat.id]!;
  }

  session.currentPacks = next;
  session.currentPickNumber += 1;
  session.waitingOn = seats.map((p) => p.id);
}

function advanceRound(session: DraftSession): "roundAdvanced" | "draftComplete" {
  const packsStillHaveCards = Object.values(session.currentPacks).some((pack) => pack.cards.length > 0);
  if (packsStillHaveCards) {
    rotatePacks(session);
    return "roundAdvanced";
  }

  if (session.packQueue.length > 0) {
    dealRound(session);
    return "roundAdvanced";
  }

  session.status = "complete";
  session.currentPacks = {};
  return "draftComplete";
}
