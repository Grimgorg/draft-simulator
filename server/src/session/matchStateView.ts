import type { CardInstance, MatchStateView, PlayerBoardView } from "@draft-simulator/shared";
import type { MatchPlayerBoard, MatchSession } from "./gameEngine.js";
import * as lobbyManager from "./lobbyManager.js";

/** Withholds a face-down card's identity from anyone but its owner — its existence, tap state, counters, and position stay visible. */
function sanitizeBattlefield(cards: CardInstance[], owner: boolean): CardInstance[] {
  if (owner) return cards;
  return cards.map((c) => (c.faceDown ? { ...c, card: null, tokenLabel: undefined } : c));
}

function buildPlayerBoardView(board: MatchPlayerBoard, owner: boolean): PlayerBoardView {
  return {
    // Library order is secret even from its own owner until a future
    // peek/search action reveals part of it, so cards are never included here.
    library: { count: board.library.length },
    hand: owner ? { count: board.hand.length, cards: board.hand } : { count: board.hand.length },
    battlefield: sanitizeBattlefield(board.battlefield, owner),
    graveyard: board.graveyard,
    exile: board.exile,
    counters: board.counters,
  };
}

export function buildMatchStateView(match: MatchSession, playerId: string): MatchStateView {
  const opponentId = match.players.find((id) => id !== playerId)!;
  const opponentName = lobbyManager.getSession()?.players.find((p) => p.id === opponentId)?.name ?? "Opponent";

  return {
    matchId: match.id,
    opponentId,
    opponentName,
    me: buildPlayerBoardView(match.boards[playerId]!, true),
    opponent: buildPlayerBoardView(match.boards[opponentId]!, false),
  };
}
