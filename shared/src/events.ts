import type { DeckExport, DraftSettings, Pack } from "./draft.js";
import type { LobbyStateView } from "./lobbyView.js";

export type ActionResult = { ok: true } | { ok: false; error: string };
export type ActionResultWithData<T extends Record<string, unknown>> = ({ ok: true } & T) | { ok: false; error: string };

/** Events the client emits to the server. */
export interface ClientToServerEvents {
  "lobby:create": (
    payload: { hostName: string; cubeIdOrUrl: string } & Pick<
      DraftSettings,
      "packCount" | "packSize" | "playerCount"
    >,
    callback: (
      result: ActionResultWithData<{
        playerId: string;
        cubeName: string;
        cardCount: number;
        unresolvedCardNames: string[];
      }>
    ) => void
  ) => void;
  "lobby:join": (
    payload: { playerName: string },
    callback: (result: ActionResultWithData<{ playerId: string }>) => void
  ) => void;
  "draft:start": (callback: (result: ActionResult) => void) => void;
  "draft:pick": (payload: { scryfallId: string }, callback: (result: ActionResult) => void) => void;
}

/** Events the server emits to clients. */
export interface ServerToClientEvents {
  /** Broadcast to everyone on connect and after every state change. Never carries pack/pick contents. */
  "lobby:state": (state: LobbyStateView) => void;
  /** Sent privately: only to the socket of the player who holds this pack. */
  "draft:packUpdate": (pack: Pack) => void;
  /** Sent privately: only to the socket of the player this export belongs to. */
  "draft:complete": (deckExport: DeckExport) => void;
}
