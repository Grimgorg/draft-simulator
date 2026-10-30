import { useEffect, useRef, useState } from "react";
import type { Card, LobbyStateView, Pack } from "@draft-simulator/shared";
import { neighborSeat, passDirection } from "@draft-simulator/shared";
import { socket } from "../socket.js";
import { withOccurrenceKeys } from "../occurrenceKeys.js";
import { buildDraftPilesKey, getStoredDraftPiles, storeDraftPiles } from "../pileStorage.js";
import { CardImage } from "./CardImage.js";
import { CardPile } from "./CardPile.js";
import { CloseDraftButton } from "./DraftControls.js";
import { HotkeyInfo } from "./HotkeyInfo.js";
import { WinstonTable } from "./WinstonTable.js";

interface DraftBoardProps {
  lobbyState: LobbyStateView;
  myPlayerId: string;
  myPack: Pack | null;
  /** A Winston draft's pile, when it's my turn to look at one. */
  myPile: Card[] | null;
  myPool: Card[];
  /** Called once the draft's creator has closed it from here. */
  onClosed: () => void;
}

interface Pile {
  id: number;
  /** Indices into `myPool`, bottom to top — the pool only ever grows by
   * appending picks, so a pool index is a stable identity for a card. */
  cards: number[];
}

const MIN_POOL_PANE_HEIGHT = 160;
const MAX_POOL_PANE_RATIO = 0.7;
const DEFAULT_POOL_PANE_HEIGHT = 280;
/** How long to wait for the server to acknowledge a pick before letting the player retry. */
const PICK_ACK_TIMEOUT_MS = 10_000;

export function DraftBoard({ lobbyState, myPlayerId, myPack, myPile, myPool, onClosed }: DraftBoardProps) {
  const [picking, setPicking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Present for the whole "drafting" -> "complete" lifecycle of one session,
  // so this key also doubles as the hand-off point DeckBuilder reads from.
  const storageKey = lobbyState.sessionId ? buildDraftPilesKey(lobbyState.sessionId, myPlayerId) : null;

  const [piles, setPiles] = useState<Pile[]>(() => (storageKey && getStoredDraftPiles(storageKey)) || []);
  const [poolPaneHeight, setPoolPaneHeight] = useState(DEFAULT_POOL_PANE_HEIGHT);

  // Resumed once at mount from whatever `piles` was just restored from —
  // every pool index appears in exactly one pile, so a plain count/max is
  // enough to keep new picks and new pile ids from colliding with restored
  // ones.
  const seenPoolLength = useRef(piles.reduce((sum, p) => sum + p.cards.length, 0));
  const nextPileId = useRef(piles.reduce((max, p) => Math.max(max, p.id + 1), 0));
  const containerRef = useRef<HTMLDivElement>(null);
  const draggingDivider = useRef(false);

  // The pool only grows (picks are appended, never reordered/removed), so
  // each newly-arrived card becomes its own new pile ready to be dragged
  // onto an existing one — nothing here disturbs piles the player already
  // arranged.
  useEffect(() => {
    if (myPool.length > seenPoolLength.current) {
      const additions: Pile[] = [];
      for (let i = seenPoolLength.current; i < myPool.length; i++) {
        additions.push({ id: nextPileId.current++, cards: [i] });
      }
      setPiles((prev) => [...prev, ...additions]);
      seenPoolLength.current = myPool.length;
    }
  }, [myPool.length]);

  // Keeps the pool arrangement across a refresh, and doubles as the source
  // DeckBuilder reads from to carry the arrangement into deck building.
  useEffect(() => {
    if (storageKey) storeDraftPiles(storageKey, piles);
  }, [storageKey, piles]);

  const stillWaitingOn = lobbyState.waitingOn ?? [];
  const isMyTurn = stillWaitingOn.includes(myPlayerId);
  const waitingOnNames = stillWaitingOn
    .filter((id) => id !== myPlayerId)
    .map((id) => lobbyState.players.find((p) => p.id === id)?.name ?? "someone");

  const seats = lobbyState.players;
  const mySeat = seats.findIndex((p) => p.id === myPlayerId);
  const hasNeighbors = seats.length > 1 && mySeat !== -1 && !!lobbyState.currentPackNumber;
  const direction = hasNeighbors
    ? passDirection(lobbyState.currentPackNumber!, lobbyState.settings?.alternatingDraft ?? true)
    : 1;
  const passingTo = hasNeighbors ? seats[neighborSeat(mySeat, direction, seats.length)] : null;
  const passingFrom = hasNeighbors ? seats[neighborSeat(mySeat, -direction, seats.length)] : null;

  function handlePick(card: Card) {
    if (picking) return;
    setPicking(true);
    setError(null);
    // With a timeout, so a lost acknowledgement (e.g. a connection blip mid
    // pick) can't leave every card disabled until the page is reloaded.
    socket.timeout(PICK_ACK_TIMEOUT_MS).emit("draft:pick", { scryfallId: card.scryfallId }, (err, result) => {
      setPicking(false);
      if (err) {
        setError("The server didn't respond to that pick. Please try again.");
        return;
      }
      if (!result.ok) setError(result.error);
      // No optimistic pool update needed: the server pushes the updated
      // pool right back via draft:myState.
    });
  }

  /** Moves a whole dragged run (a card plus everything stacked on top of it)
   * from wherever it currently sits to wherever `apply` decides to place it.
   * Piles emptied by the move are kept (not pre-filtered) until after
   * `apply` runs, so dropping a run back onto its own now-empty source pile
   * still finds that pile to append to. */
  function movePoolIndices(poolIndices: number[], apply: (withoutSource: Pile[], removedCards: number[]) => Pile[]) {
    setPiles((prev) => {
      const movingSet = new Set(poolIndices);
      const withoutSource = prev.map((pile) => {
        const kept = pile.cards.filter((i) => !movingSet.has(i));
        return kept.length === pile.cards.length ? pile : { ...pile, cards: kept };
      });
      // Preserve the dragged run's own bottom-to-top order rather than
      // whichever order piles happen to be scanned in.
      const removedCards = poolIndices.filter((i) => prev.some((pile) => pile.cards.includes(i)));
      if (removedCards.length === 0) return prev;
      return apply(withoutSource, removedCards).filter((pile) => pile.cards.length > 0);
    });
  }

  function handleDropOnPile(poolIndices: number[], targetPileId: number) {
    movePoolIndices(poolIndices, (withoutSource, removedCards) =>
      withoutSource.map((pile) => (pile.id === targetPileId ? { ...pile, cards: [...pile.cards, ...removedCards] } : pile)),
    );
  }

  function handleDropOnBackground(e: React.DragEvent) {
    e.preventDefault();
    const poolIndices = e.dataTransfer
      .getData("text/plain")
      .split(",")
      .map(Number)
      .filter((n) => !Number.isNaN(n));
    if (poolIndices.length === 0) return;
    movePoolIndices(poolIndices, (withoutSource, removedCards) => [
      ...withoutSource,
      { id: nextPileId.current++, cards: removedCards },
    ]);
  }

  function handleDividerPointerDown(e: React.PointerEvent<HTMLDivElement>) {
    draggingDivider.current = true;
    e.currentTarget.setPointerCapture(e.pointerId);
  }

  function handleDividerPointerMove(e: React.PointerEvent<HTMLDivElement>) {
    if (!draggingDivider.current || !containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const newHeight = rect.bottom - e.clientY;
    const maxHeight = rect.height * MAX_POOL_PANE_RATIO;
    setPoolPaneHeight(Math.min(maxHeight, Math.max(MIN_POOL_PANE_HEIGHT, newHeight)));
  }

  function handleDividerPointerUp() {
    draggingDivider.current = false;
  }

  return (
    <div className="draft-screen" ref={containerRef}>
      <div className="pack-pane">
        {lobbyState.winston ? (
          <WinstonTable table={lobbyState.winston} players={lobbyState.players} myPlayerId={myPlayerId} myPile={myPile} />
        ) : (
          <>
            <header className="draft-header">
              <h1>
                Pack {lobbyState.currentPackNumber} of {lobbyState.settings?.packCount}, pick{" "}
                {lobbyState.currentPickNumber}
              </h1>
              {passingFrom && passingTo && (
                <div className="pass-info">
                  <span className="tag">◀ Receiving from {passingFrom.name}</span>
                  <span className="tag">Passing to {passingTo.name} ▶</span>
                </div>
              )}
              {waitingOnNames.length > 0 && (
                <p className="subtitle">Waiting on: {waitingOnNames.join(", ")}</p>
              )}
              {error && <p className="error">{error}</p>}
            </header>

            <section className="pack-grid">
              {!isMyTurn ? (
                <p className="subtitle">Waiting for other players to pick...</p>
              ) : myPack ? (
                withOccurrenceKeys(myPack.cards).map(({ key, card }) => (
                  <CardImage key={key} card={card} onClick={() => handlePick(card)} disabled={picking} />
                ))
              ) : (
                <p className="subtitle">Waiting for the next pack...</p>
              )}
            </section>
          </>
        )}
      </div>

      <div
        className="pane-divider"
        onPointerDown={handleDividerPointerDown}
        onPointerMove={handleDividerPointerMove}
        onPointerUp={handleDividerPointerUp}
      />

      <section
        className="pool-pane"
        style={{ height: poolPaneHeight }}
        onDragOver={(e) => e.preventDefault()}
        onDrop={handleDropOnBackground}
      >
        <div className="pool-pane-header">
          <h2>Your pool ({myPool.length})</h2>
          <HotkeyInfo />
          {lobbyState.creatorPlayerId === myPlayerId && (
            <div className="pool-pane-actions">
              <CloseDraftButton status={lobbyState.status} onClosed={onClosed} />
            </div>
          )}
        </div>
        <div className="pile-row">
          {piles.map((pile) => (
            <CardPile
              key={pile.id}
              // Piles restored from storage can briefly reference indices
              // before `myPool` (arriving over the socket after reconnect)
              // has caught up — filtering rather than trusting every index
              // keeps render safe for that window; it self-heals once
              // `myPool` arrives since piles aren't re-derived, only
              // re-rendered.
              cards={pile.cards.flatMap((i) => (myPool[i] ? [{ id: String(i), card: myPool[i]! }] : []))}
              onDropCard={(ids) => handleDropOnPile(ids.map(Number), pile.id)}
            />
          ))}
        </div>
      </section>
    </div>
  );
}
