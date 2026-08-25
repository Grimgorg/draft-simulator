import { useEffect, useRef, useState } from "react";
import type { Card, LobbyStateView, Pack } from "@draft-simulator/shared";
import { socket } from "../socket.js";
import { CancelDraftButton } from "./CancelDraftButton.js";
import { CardImage } from "./CardImage.js";
import { CardPile } from "./CardPile.js";

interface DraftBoardProps {
  lobbyState: LobbyStateView;
  myPlayerId: string;
  myPack: Pack | null;
  myPool: Card[];
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

export function DraftBoard({ lobbyState, myPlayerId, myPack, myPool }: DraftBoardProps) {
  const [picking, setPicking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [piles, setPiles] = useState<Pile[]>([]);
  const [poolPaneHeight, setPoolPaneHeight] = useState(DEFAULT_POOL_PANE_HEIGHT);

  const seenPoolLength = useRef(0);
  const nextPileId = useRef(0);
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

  const isHost = lobbyState.hostId === myPlayerId;
  const stillWaitingOn = lobbyState.waitingOn ?? [];
  const isMyTurn = stillWaitingOn.includes(myPlayerId);
  const waitingOnNames = stillWaitingOn
    .filter((id) => id !== myPlayerId)
    .map((id) => lobbyState.players.find((p) => p.id === id)?.name ?? "someone");

  function handlePick(card: Card) {
    if (picking) return;
    setPicking(true);
    setError(null);
    socket.emit("draft:pick", { scryfallId: card.scryfallId }, (result) => {
      setPicking(false);
      if (!result.ok) setError(result.error);
      // No optimistic pool update needed: the server pushes the updated
      // pool right back via draft:myState.
    });
  }

  function movePoolIndex(poolIndex: number, apply: (withoutSource: Pile[], removedCard: number) => Pile[]) {
    setPiles((prev) => {
      let removedCard: number | null = null;
      const withoutSource = prev.map((pile) => {
        if (pile.cards.includes(poolIndex)) {
          removedCard = poolIndex;
          return { ...pile, cards: pile.cards.filter((i) => i !== poolIndex) };
        }
        return pile;
      });
      if (removedCard === null) return prev;
      return apply(withoutSource, removedCard).filter((pile) => pile.cards.length > 0);
    });
  }

  function handleDropOnPile(poolIndex: number, targetPileId: number) {
    movePoolIndex(poolIndex, (withoutSource, removedCard) =>
      withoutSource.map((pile) => (pile.id === targetPileId ? { ...pile, cards: [...pile.cards, removedCard] } : pile)),
    );
  }

  function handleDropOnBackground(e: React.DragEvent) {
    e.preventDefault();
    const poolIndex = Number(e.dataTransfer.getData("text/plain"));
    if (Number.isNaN(poolIndex)) return;
    movePoolIndex(poolIndex, (withoutSource, removedCard) => [
      ...withoutSource,
      { id: nextPileId.current++, cards: [removedCard] },
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
        <header className="draft-header">
          <h1>
            Pack {lobbyState.currentPackNumber} of {lobbyState.settings?.packCount}, pick{" "}
            {lobbyState.currentPickNumber}
          </h1>
          {waitingOnNames.length > 0 && (
            <p className="subtitle">Waiting on: {waitingOnNames.join(", ")}</p>
          )}
          {error && <p className="error">{error}</p>}
          {isHost && <CancelDraftButton />}
        </header>

        <section className="pack-grid">
          {!isMyTurn ? (
            <p className="subtitle">Waiting for other players to pick...</p>
          ) : myPack ? (
            myPack.cards.map((card) => (
              <CardImage key={card.scryfallId} card={card} onClick={() => handlePick(card)} disabled={picking} />
            ))
          ) : (
            <p className="subtitle">Waiting for the next pack...</p>
          )}
        </section>
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
        <h2>Your pool ({myPool.length})</h2>
        <div className="pile-row">
          {piles.map((pile) => (
            <CardPile
              key={pile.id}
              cards={pile.cards.map((i) => ({ id: String(i), card: myPool[i] }))}
              onDropCard={(id) => handleDropOnPile(Number(id), pile.id)}
            />
          ))}
        </div>
      </section>
    </div>
  );
}
