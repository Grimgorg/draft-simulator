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

export interface Pack {
  id: string;
  /** 1-indexed: which pack in the draft (e.g. 1 of 3). Determines pass direction. */
  packNumber: number;
  cards: Card[];
}

export interface Pick {
  playerId: string;
  round: number;
  scryfallId: string;
  timestamp: number;
}

/** Full server-side draft state, snapshotted to disk after every pick. */
export interface DraftState {
  id: string;
  status: DraftStatus;
  settings: DraftSettings;
  players: Player[];
  /** The pack each player currently holds, keyed by player id. Absent once the draft is complete. */
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
