import type { Card } from "./card.js";

export type Zone = "library" | "hand" | "battlefield" | "graveyard" | "exile";

/**
 * One physical card or token on the board. `card` is null for a token (in
 * which case `tokenLabel` names it) or when this instance is a face-down
 * card as seen by anyone but its owner — the identity is withheld, not the
 * existence of the card (and `tokenLabel` is withheld too, if it was a token).
 */
export interface CardInstance {
  instanceId: string;
  card: Card | null;
  tokenLabel?: string;
  /** Only meaningful on the battlefield — cleared when the card leaves it. */
  faceDown?: boolean;
  /** Only meaningful on the battlefield. */
  counters?: Record<string, number>;
  /** Only meaningful on the battlefield — free-drag position. */
  x?: number;
  y?: number;
  /** Only meaningful on the battlefield. */
  tapped?: boolean;
}

export interface PlayerBoardView {
  /** Cards are included only for the zone's owner, and only once something has actually revealed them (e.g. a future peek/search) — library order is secret even from its own owner by default. */
  library: { count: number; cards?: CardInstance[] };
  /** Cards are included for the hand's owner; opponents see only a count. */
  hand: { count: number; cards?: CardInstance[] };
  battlefield: CardInstance[];
  graveyard: CardInstance[];
  exile: CardInstance[];
  counters: Record<string, number>;
}

/** Private, per-player view of a match: full detail for your own hidden zones, counts only for the opponent's. */
export interface MatchStateView {
  matchId: string;
  opponentId: string;
  opponentName: string;
  me: PlayerBoardView;
  opponent: PlayerBoardView;
}

/** Whether a player has locked in a deck to play with, and if so, whether they're free to be challenged. */
export type HubPlayerStatus = "not-ready" | "idle" | "in-match";

/**
 * Public snapshot of the post-draft hub, safe to broadcast to everyone.
 * Only meaningful once the draft is complete; deliberately excludes deck
 * contents — nobody but the owner ever sees another player's decklist.
 */
export interface HubStateView {
  players: { id: string; name: string; status: HubPlayerStatus }[];
}
