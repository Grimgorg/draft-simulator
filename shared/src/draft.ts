import type { Card } from "./card.js";

export interface Player {
  id: string;
  name: string;
  isHost: boolean;
  connected: boolean;
}

export interface DraftSettings {
  cubeId: string;
  packCount: number;
  packSize: number;
  playerCount: number;
}

export type DraftStatus = "lobby" | "drafting" | "complete";

/** Standard alternating pass direction: pack 1 passes one way, pack 2 the other, and so on. */
export function passDirection(packNumber: number): 1 | -1 {
  return packNumber % 2 === 1 ? 1 : -1;
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
  cards: { scryfallId: string; name: string; count: number }[];
}
