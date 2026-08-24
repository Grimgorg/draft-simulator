import type { DraftSettings, DraftStatus, Player } from "./draft.js";

/**
 * Public snapshot of the single lobby/draft running on this server,
 * safe to broadcast to every connected client. Deliberately excludes
 * anything private: pack contents and other players' picks travel only
 * over the private draft:packUpdate / draft:complete events.
 */
export interface LobbyStateView {
  /** "empty" = no lobby has been created on this server yet. */
  status: DraftStatus | "empty";
  hostId?: string;
  settings?: DraftSettings;
  cubeName?: string;
  cardCount?: number;
  unresolvedCardNames?: string[];
  players: Player[];
  currentPackNumber?: number;
  currentPickNumber?: number;
  waitingOn?: string[];
}
