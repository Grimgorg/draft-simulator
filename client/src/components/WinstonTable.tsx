import { useState } from "react";
import type { Card, Player, WinstonTableView } from "@draft-simulator/shared";
import { withOccurrenceKeys } from "../occurrenceKeys.js";
import { socket } from "../socket.js";
import { CardImage } from "./CardImage.js";

interface WinstonTableProps {
  table: WinstonTableView;
  players: Player[];
  myPlayerId: string;
  /** The pile I'm looking at: set only on my turn. */
  myPile: Card[] | null;
}

// Like a pick's, so a lost acknowledgement can't leave the buttons disabled until the page is reloaded.
const ACTION_ACK_TIMEOUT_MS = 10_000;

/** A Winston draft's stack and piles, face down, and the pile the active player is looking at. */
export function WinstonTable({ table, players, myPlayerId, myPile }: WinstonTableProps) {
  const [acting, setActing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isMyTurn = table.activePlayerId === myPlayerId;
  const activeName = players.find((p) => p.id === table.activePlayerId)?.name ?? "someone";
  const pileNumber = table.pileIndex + 1;
  const isLastPile = table.pileSizes.slice(table.pileIndex + 1).every((size) => size === 0);

  function act(event: "winston:take" | "winston:pass") {
    if (acting) return;
    setActing(true);
    setError(null);
    socket.timeout(ACTION_ACK_TIMEOUT_MS).emit(event, { pileIndex: table.pileIndex }, (err, result) => {
      setActing(false);
      if (err) {
        setError("The server didn't respond. Please try again.");
        return;
      }
      if (!result.ok) setError(result.error);
    });
  }

  return (
    <>
      <header className="draft-header">
        <h1>{isMyTurn ? `Your turn: pile ${pileNumber}` : `${activeName}'s turn`}</h1>
        <p className="subtitle">
          {isMyTurn
            ? "Take this pile, or pass it: it gets the top card of the stack, and you look at the next pile."
            : `${activeName} is looking at pile ${pileNumber}...`}
        </p>
        {error && <p className="error">{error}</p>}
      </header>

      <div className="winston-table" aria-label="Winston table">
        <div className="winston-pile winston-stack">
          <span className="winston-count">{table.stackCount}</span>
          <span>Stack</span>
        </div>
        {table.pileSizes.map((size, index) => (
          <div
            key={index}
            className={`winston-pile${size === 0 ? " winston-pile-empty" : ""}${
              index === table.pileIndex ? " winston-pile-current" : ""
            }`}
          >
            <span className="winston-count">{size}</span>
            <span>Pile {index + 1}</span>
          </div>
        ))}
      </div>

      {isMyTurn &&
        (myPile ? (
          <>
            <div className="winston-actions">
              <button type="button" disabled={acting} onClick={() => act("winston:take")}>
                Take pile ({myPile.length} {myPile.length === 1 ? "card" : "cards"})
              </button>
              <button type="button" disabled={acting || !table.canPass} onClick={() => act("winston:pass")}>
                {isLastPile ? "Pass and draw from the stack" : "Pass"}
              </button>
            </div>
            {!table.canPass && <p className="subtitle">The stack is empty and this is the last pile: take it.</p>}
            <section className="pack-grid">
              {withOccurrenceKeys(myPile).map(({ key, card }) => (
                <CardImage key={key} card={card} />
              ))}
            </section>
          </>
        ) : (
          <p className="subtitle">Waiting for the pile...</p>
        ))}
    </>
  );
}
