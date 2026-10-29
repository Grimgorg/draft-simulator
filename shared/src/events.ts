import type { Card } from "./card.js";
import type { DeckExport, Pack } from "./draft.js";
import type { LobbyStateView } from "./lobbyView.js";

export type ActionResult = { ok: true } | { ok: false; error: string };
export type ActionResultWithData<T extends Record<string, unknown>> = ({ ok: true } & T) | { ok: false; error: string };

/** Events the client emits to the server. */
export interface ClientToServerEvents {
  "lobby:join": (
    payload: { playerName: string },
    callback: (result: ActionResultWithData<{ playerId: string }>) => void
  ) => void;
  /** Re-attaches this socket to an existing player id, e.g. after a page refresh or a network blip. */
  "lobby:reconnect": (payload: { playerId: string }, callback: (result: ActionResult) => void) => void;
  "draft:pick": (payload: { scryfallId: string }, callback: (result: ActionResult) => void) => void;
  /**
   * A Winston draft's active player takes the pile they're looking at, or passes it. `pileIndex` is the pile they
   * mean, so a repeated click can't act on the next pile.
   */
  "winston:take": (payload: { pileIndex: number }, callback: (result: ActionResult) => void) => void;
  "winston:pass": (payload: { pileIndex: number }, callback: (result: ActionResult) => void) => void;
  /** The current cube draft's cards, for players to look through while they wait. Fails for a set draft. */
  "lobby:cubeCards": (
    callback: (
      result: ActionResultWithData<{ cubeName: string; cards: Card[]; unresolvedNames: string[] }>
    ) => void
  ) => void;
  /** Opens one booster of the current set draft's set, dealt to no one, to show what its packs look like. */
  "lobby:samplePack": (callback: (result: ActionResultWithData<{ cards: Card[] }>) => void) => void;
}

/** Events the server emits to clients. */
export interface ServerToClientEvents {
  /** Broadcast to everyone on connect and after every state change. Never carries pack/pick contents. */
  "lobby:state": (state: LobbyStateView) => void;
  /**
   * Sent privately: this player's current pack (null between rounds) and their pool so far. In a Winston draft,
   * `pile` is the pile the player is looking at, sent only to the active player; `pack` is always null.
   */
  "draft:myState": (state: { pack: Pack | null; pool: Card[]; pile?: Card[] | null }) => void;
  /** Sent privately: only to the socket of the player this export belongs to. */
  "draft:complete": (deckExport: DeckExport) => void;
  /** Sent privately: this socket's identity was just claimed by another socket via lobby:reconnect. */
  "identity:evicted": () => void;
}
