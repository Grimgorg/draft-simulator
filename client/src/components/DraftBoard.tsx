import { useState } from "react";
import type { Card, LobbyStateView, Pack } from "@draft-simulator/shared";
import { socket } from "../socket.js";
import { CardImage } from "./CardImage.js";

interface DraftBoardProps {
  lobbyState: LobbyStateView;
  myPlayerId: string;
  myPack: Pack | null;
  myPool: Card[];
}

export function DraftBoard({ lobbyState, myPlayerId, myPack, myPool }: DraftBoardProps) {
  const [picking, setPicking] = useState(false);
  const [error, setError] = useState<string | null>(null);

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

  return (
    <div className="screen draft-screen">
      <header className="draft-header">
        <h1>
          Pack {lobbyState.currentPackNumber} of {lobbyState.settings?.packCount}, pick{" "}
          {lobbyState.currentPickNumber}
        </h1>
        {waitingOnNames.length > 0 && (
          <p className="subtitle">Waiting on: {waitingOnNames.join(", ")}</p>
        )}
        {error && <p className="error">{error}</p>}
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

      <section className="pool">
        <h2>Your pool ({myPool.length})</h2>
        <div className="pool-grid">
          {myPool.map((card, i) => (
            <CardImage key={`${card.scryfallId}-${i}`} card={card} />
          ))}
        </div>
      </section>
    </div>
  );
}
