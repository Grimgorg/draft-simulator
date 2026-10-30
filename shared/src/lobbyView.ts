import type { Card } from "./card.js";
import type { DraftSettings, DraftStatus, Player } from "./draft.js";

/** A player as the views show them. */
export interface SeatView extends Player {
  /**
   * No browser holds this seat: its creator or the host released it, or it was taken before seats had tokens.
   * Picking it in the draft's rejoin list takes it; any other seat needs the browser that holds its token.
   */
  claimable: boolean;
}

/**
 * Public snapshot of one draft, sent to everyone seated in it. Deliberately excludes anything private: pack
 * contents and other players' picks travel only over the private draft:myState / draft:complete events.
 */
export interface LobbyStateView {
  status: DraftStatus;
  /** The draft's id (the `draftId` of the draft events): the same from lobby to complete, so clients key
   * per-draft local state (e.g. pool pile arrangement) that should survive a refresh and carry over into deck
   * building. */
  sessionId: string;
  /** The player who created the draft, the only one who can start or close it. Unset while no one is seated. */
  creatorPlayerId?: string;
  settings: DraftSettings;
  cubeName?: string;
  cardCount?: number;
  unresolvedCardNames?: string[];
  players: SeatView[];
  currentPackNumber?: number;
  currentPickNumber?: number;
  waitingOn?: string[];
  /** A Winston draft's table while it's drafted: what both players can see of it. Never the cards. */
  winston?: WinstonTableView;
  /** The five basic lands, available once the draft is complete so players can add them while deck building. */
  basicLands?: Card[];
}

/**
 * One draft as the draft list shows it, to everyone connected, seated or not. Like LobbyStateView it never
 * carries packs or pools. Its players' ids are public, as names are: taking a seat back needs its seat token, which
 * only the browser holding the seat has, unless the seat is claimable.
 */
export interface DraftSummary {
  draftId: string;
  status: DraftStatus;
  settings: DraftSettings;
  cubeName: string;
  cardCount: number;
  players: SeatView[];
  /** The player who created the draft. Unset while no one is seated. */
  creatorPlayerId?: string;
  /** Milliseconds since the epoch. */
  createdAt: number;
}

export interface WinstonTableView {
  /** Whose turn it is. Also the only id in `waitingOn`. */
  activePlayerId: string;
  /** 0-indexed: the pile the active player is looking at. */
  pileIndex: number;
  /** How many cards each pile holds, face down. */
  pileSizes: number[];
  /** Cards left in the stack. */
  stackCount: number;
  /** Whether the active player may pass the pile they're looking at: they can't pass the last card they could get. */
  canPass: boolean;
}
