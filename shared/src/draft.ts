import type { Card } from "./card.js";
import type { DecklistEntry } from "./decklist.js";

export interface Player {
  id: string;
  name: string;
  connected: boolean;
}

export interface DraftSettings {
  cubeId: string;
  packCount: number;
  packSize: number;
  playerCount: number;
  /** When true, pack 1 passes one way, pack 2 the other, and so on. When false, every pack passes the same way. */
  alternatingDraft: boolean;
}

export type DraftStatus = "lobby" | "drafting" | "complete";

/** Pass direction for a given pack. If `alternatingDraft` is false, always passes the same way. */
export function passDirection(packNumber: number, alternatingDraft: boolean): 1 | -1 {
  if (!alternatingDraft) return 1;
  return packNumber % 2 === 1 ? 1 : -1;
}

/**
 * The seat a pack passed in `direction` (see passDirection) goes to from
 * `seat`, wrapping around the table. A pack arrives at `seat` from
 * `neighborSeat(seat, -direction, seatCount)`.
 */
export function neighborSeat(seat: number, direction: number, seatCount: number): number {
  return (seat + direction + seatCount) % seatCount;
}

export interface Pack {
  id: string;
  /** 1-indexed: which pack in the draft (e.g. 1 of 3). Determines pass direction. */
  packNumber: number;
  cards: Card[];
}

export interface Pick {
  playerId: string;
  /** 1-indexed: which pack this pick was made from. */
  packNumber: number;
  /** 1-indexed: which pick within that pack. */
  pickNumber: number;
  scryfallId: string;
  timestamp: number;
}

/** Full server-side draft state, snapshotted to disk after every pick. */
export interface DraftState {
  id: string;
  status: DraftStatus;
  settings: DraftSettings;
  players: Player[];
  /** 1-indexed; 0 before the draft starts. */
  currentPackNumber: number;
  /** 1-indexed pick within the current pack; resets each new pack. */
  currentPickNumber: number;
  /** The pack each player currently holds, keyed by player id. Empty once the draft is complete. */
  currentPacks: Record<string, Pack>;
  /** Player ids who have not yet submitted a pick for the current round. */
  waitingOn: string[];
  picks: Pick[];
  /** Each player's picked pool so far, keyed by player id. */
  pools: Record<string, Card[]>;
}

export interface DeckExport {
  playerId: string;
  playerName: string;
  /** Human-readable "count name" lines. */
  plainText: string;
  /** Canonical machine-readable export: the seam for a future gameplay engine. */
  cards: DecklistEntry[];
}
