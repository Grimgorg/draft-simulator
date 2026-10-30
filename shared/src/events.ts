import type { Card } from "./card.js";
import type { DeckExport, DraftSettings, Pack } from "./draft.js";
import type { DraftSummary, LobbyStateView } from "./lobbyView.js";

export type ActionResult = { ok: true } | { ok: false; error: string };
export type ActionResultWithData<T extends Record<string, unknown>> = ({ ok: true } & T) | { ok: false; error: string };

/**
 * What a player picks for a new draft: a cube, fetched from CubeCobra when the draft is created, or a set
 * from DRAFTABLE_SETS. A set fixes the pack size, so `packSize` is ignored for one.
 */
export type NewDraftSettings = { cubeIdOrUrl?: string; setCode?: string } & Omit<DraftSettings, "cubeId" | "setCode">;

/** Events the client emits to the server. */
export interface ClientToServerEvents {
  /**
   * Opens a new draft and seats its creator in it, as `playerName`. Only the creator can start or close it. Like
   * lobby:join, it answers with the seat's token: the browser keeps it to take the seat back later.
   */
  "draft:create": (
    payload: NewDraftSettings & { playerName: string },
    callback: (result: ActionResultWithData<{ draftId: string; playerId: string; seatToken: string }>) => void
  ) => void;
  "lobby:join": (
    payload: { draftId: string; playerName: string },
    callback: (result: ActionResultWithData<{ playerId: string; seatToken: string }>) => void
  ) => void;
  /**
   * Re-attaches this socket to an existing player, e.g. after a page refresh or a network blip. Needs the seat's
   * token, unless the seat is claimable; taking a claimable one issues a new token, which the answer carries.
   */
  "lobby:reconnect": (
    payload: { draftId: string; playerId: string; seatToken?: string },
    callback: (result: ActionResultWithData<{ seatToken: string }>) => void
  ) => void;
  /**
   * The creator frees another player's seat, for a player who lost the browser that held it: whoever picks it in
   * the rejoin list next takes it, on any device.
   */
  "lobby:releaseSeat": (payload: { playerId: string }, callback: (result: ActionResult) => void) => void;
  /**
   * Gives up this browser's seat. Before the draft starts it removes the player, which its creator can't do (they
   * close it instead); once it's complete the player stays in it, with their pool. Refused while it's drafted.
   */
  "lobby:leave": (callback: (result: ActionResult) => void) => void;
  /** The creator deals the first packs to everyone seated, once at least MIN_PLAYERS are. */
  "draft:start": (callback: (result: ActionResult) => void) => void;
  /** The creator ends the draft for everyone and removes it, whatever its status. */
  "draft:close": (callback: (result: ActionResult) => void) => void;
  "draft:pick": (payload: { scryfallId: string }, callback: (result: ActionResult) => void) => void;
  /**
   * A Winston draft's active player takes the pile they're looking at, or passes it. `pileIndex` is the pile they
   * mean, so a repeated click can't act on the next pile.
   */
  "winston:take": (payload: { pileIndex: number }, callback: (result: ActionResult) => void) => void;
  "winston:pass": (payload: { pileIndex: number }, callback: (result: ActionResult) => void) => void;
  /** The cards of the cube draft this socket is seated in, to look through while waiting. Fails for a set draft. */
  "lobby:cubeCards": (
    callback: (
      result: ActionResultWithData<{ cubeName: string; cards: Card[]; unresolvedNames: string[] }>
    ) => void
  ) => void;
  /** Opens one booster of this socket's set draft, dealt to no one, to show what its packs look like. */
  "lobby:samplePack": (callback: (result: ActionResultWithData<{ cards: Card[] }>) => void) => void;
}

/** Events the server emits to clients. */
export interface ServerToClientEvents {
  /** Every draft on the server, newest first. Broadcast to everyone on connect and after every change. */
  "drafts:list": (drafts: DraftSummary[]) => void;
  /**
   * Sent to the players seated in a draft after every change to it, and to a socket once it takes a seat. Never
   * carries pack/pick contents.
   */
  "lobby:state": (state: LobbyStateView) => void;
  /** Sent to the players seated in a draft just after it was closed, by its creator or the host. */
  "draft:closed": (draftId: string) => void;
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
