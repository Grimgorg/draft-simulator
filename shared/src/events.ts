import type { Card } from "./card.js";
import type { DeckExport, DraftSettings, Pack } from "./draft.js";
import type { CardInstance, HubStateView, MatchStateView, Zone } from "./game.js";
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
  /** Re-attaches this socket to an existing player id, e.g. after a page refresh or a network blip. */
  "lobby:reconnect": (payload: { playerId: string }, callback: (result: ActionResult) => void) => void;
  "draft:start": (callback: (result: ActionResult) => void) => void;
  "draft:cancel": (callback: (result: ActionResult) => void) => void;
  "draft:pick": (payload: { scryfallId: string }, callback: (result: ActionResult) => void) => void;
  /** Locks in a decklist (a subset of the caller's own drafted pool, by scryfallId, repeats allowed) and marks them ready to play. */
  "deck:submit": (payload: { scryfallIds: string[] }, callback: (result: ActionResult) => void) => void;
  /** Leaves the ready hub, going back to deck building. Rejected while in an active match. */
  "deck:unready": (callback: (result: ActionResult) => void) => void;
  /** Challenges an idle, ready opponent to a match. */
  "hub:challenge": (payload: { opponentId: string }, callback: (result: ActionResult) => void) => void;
  /** Accepts or declines the caller's current incoming challenge from `fromId`. Accepting deals both players an opening hand. */
  "hub:respondChallenge": (
    payload: { fromId: string; accept: boolean },
    callback: (result: ActionResult) => void
  ) => void;
  /** Ends the caller's current match; both players return to the hub. */
  "match:concede": (callback: (result: ActionResult) => void) => void;
  /** Draws the top card of the caller's own library into their hand. */
  "match:drawCard": (callback: (result: ActionResult) => void) => void;
  /** Shuffles the caller's own library. */
  "match:shuffleLibrary": (callback: (result: ActionResult) => void) => void;
  /** Shuffles the caller's hand back into their library and draws a fresh opening hand. No rules enforcement — callable any time, repeatedly. */
  "match:mulligan": (callback: (result: ActionResult) => void) => void;
  /**
   * The universal move primitive: relocates one of the caller's own cards
   * (from hand/battlefield/graveyard/exile) to any zone, including their own
   * library (top or bottom, default top). When moving onto the battlefield,
   * `battlefieldRow`/`battlefieldStackId` place it in a specific row/stack
   * (defaulting to row 0, its own new singleton stack).
   */
  "match:moveCard": (
    payload: {
      instanceId: string;
      toZone: Zone;
      toLibraryPosition?: "top" | "bottom";
      battlefieldRow?: number;
      battlefieldStackId?: string;
    },
    callback: (result: ActionResult) => void
  ) => void;
  /** Taps or untaps one of the caller's own battlefield cards. */
  "match:tapCard": (payload: { instanceId: string; tapped: boolean }, callback: (result: ActionResult) => void) => void;
  /** Untaps every one of the caller's own battlefield cards at once. */
  "match:untapAll": (callback: (result: ActionResult) => void) => void;
  /** Adds `delta` to a freeform counter (e.g. "+1/+1", "loyalty") on one of the caller's own battlefield cards; the counter is removed once it reaches zero or below. */
  "match:setCardCounter": (
    payload: { instanceId: string; label: string; delta: number },
    callback: (result: ActionResult) => void
  ) => void;
  /** Moves one of the caller's own battlefield cards to a row/stack slot — omit `stackId` to break it out into its own new stack. */
  "match:setBattlefieldSlot": (
    payload: { instanceId: string; row: number; stackId?: string },
    callback: (result: ActionResult) => void
  ) => void;
  /** Flips one of the caller's own battlefield cards face-down or face-up. Its identity is withheld from the opponent while face-down. */
  "match:flipFaceDown": (
    payload: { instanceId: string; faceDown: boolean },
    callback: (result: ActionResult) => void
  ) => void;
  /** Creates a free-text token directly on the caller's own battlefield. */
  "match:createToken": (payload: { label: string }, callback: (result: ActionResult) => void) => void;
  /** Permanently deletes one of the caller's own tokens (never a real drafted card) from whatever zone it's currently in. */
  "match:deleteToken": (payload: { instanceId: string }, callback: (result: ActionResult) => void) => void;
  /** Privately reveals the top `count` cards of the caller's own library (clamped to its size) via the callback — never broadcast. Pass a large count to "search" the whole library. */
  "match:peekLibrary": (
    payload: { count: number },
    callback: (result: ActionResultWithData<{ cards: CardInstance[] }>) => void
  ) => void;
  /** Reveals one of the caller's own cards (from any zone, including the library) to the opponent as a transient broadcast — never changes any zone. */
  "match:revealCard": (payload: { instanceId: string }, callback: (result: ActionResult) => void) => void;
  /** Adds `delta` to one of the caller's own player-level counters (e.g. "life", "poison"). Unlike a card counter, never removed at zero. */
  "match:setPlayerCounter": (
    payload: { label: string; delta: number },
    callback: (result: ActionResult) => void
  ) => void;
  /** Rolls a die with the given number of sides (>= 2) and broadcasts the result to both participants. */
  "match:rollDie": (payload: { sides: number }, callback: (result: ActionResult) => void) => void;
}

/** Events the server emits to clients. */
export interface ServerToClientEvents {
  /** Broadcast to everyone on connect and after every state change. Never carries pack/pick contents. */
  "lobby:state": (state: LobbyStateView) => void;
  /** Sent privately: this player's current pack (null between rounds) and their pool so far. */
  "draft:myState": (state: { pack: Pack | null; pool: Card[] }) => void;
  /** Sent privately: only to the socket of the player this export belongs to. */
  "draft:complete": (deckExport: DeckExport) => void;
  /** Sent privately: this socket's identity was just claimed by another socket via lobby:reconnect. */
  "identity:evicted": () => void;
  /** Broadcast to everyone on connect and after every hub-state change (ready up, unready). Never carries deck contents. */
  "hub:state": (state: HubStateView) => void;
  /** Sent privately: someone has challenged this player to a match. */
  "hub:challengeReceived": (payload: { fromId: string; fromName: string }) => void;
  /** Sent privately to each participant after every change to their match — never carries the opponent's hidden zone contents. */
  "match:state": (state: MatchStateView) => void;
  /** Sent privately to both participants when their match ends (e.g. a concede). */
  "match:ended": () => void;
  /** Broadcast to both match participants: someone revealed one of their own cards. Transient — not persisted, doesn't change match:state. */
  "match:revealed": (payload: { fromPlayerId: string; fromName: string; card: Card | null; tokenLabel?: string }) => void;
  /** Broadcast to both match participants: a die roll result. */
  "match:diceResult": (payload: { fromPlayerId: string; fromName: string; sides: number; result: number }) => void;
}
