import type { DeckExport, DraftSettings, Pack, Player } from "./draft.js";

/** Events the client emits to the server. */
export interface ClientToServerEvents {
  "lobby:create": (
    payload: { hostName: string } & Omit<DraftSettings, "cubeId"> & { cubeId: string },
    callback: (result: { joinCode: string } | { error: string }) => void
  ) => void;
  "lobby:join": (
    payload: { joinCode: string; playerName: string },
    callback: (result: { playerId: string } | { error: string }) => void
  ) => void;
  "draft:start": () => void;
  "draft:pick": (payload: { scryfallId: string }) => void;
}

/** Events the server emits to clients. */
export interface ServerToClientEvents {
  "lobby:playerList": (players: Player[]) => void;
  "lobby:error": (message: string) => void;
  "draft:packUpdate": (pack: Pack) => void;
  "draft:waitingOn": (playerIds: string[]) => void;
  "draft:complete": (deckExport: DeckExport) => void;
}
