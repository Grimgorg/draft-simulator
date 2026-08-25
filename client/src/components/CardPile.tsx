import type { Card } from "@draft-simulator/shared";
import { CardImage } from "./CardImage.js";

interface PiledCard {
  poolIndex: number;
  card: Card;
}

interface CardPileProps {
  cards: PiledCard[];
  onDropCard: (poolIndex: number) => void;
}

/** Vertical offset between stacked cards — small enough to fan tightly, tall
 * enough that the name/mana-cost band printed at the top of the card art
 * stays visible on every card but the frontmost one. */
const PEEK_HEIGHT = 34;
/** Matches the pile's fixed width (see `.pile` in App.css) at Magic's card
 * aspect ratio, so the stack's reserved height is exact rather than guessed. */
const CARD_HEIGHT = 210;

export function CardPile({ cards, onDropCard }: CardPileProps) {
  const topIndex = cards.length - 1;

  function handleDragStart(e: React.DragEvent, poolIndex: number) {
    e.dataTransfer.setData("text/plain", String(poolIndex));
    e.dataTransfer.effectAllowed = "move";
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    e.stopPropagation();
    const poolIndex = Number(e.dataTransfer.getData("text/plain"));
    if (!Number.isNaN(poolIndex)) onDropCard(poolIndex);
  }

  return (
    <div
      className="pile"
      style={{ height: topIndex * PEEK_HEIGHT + CARD_HEIGHT }}
      onDragOver={(e) => e.preventDefault()}
      onDrop={handleDrop}
    >
      {cards.map(({ poolIndex, card }, i) => (
        <div
          key={poolIndex}
          className="pile-card"
          style={{ top: i * PEEK_HEIGHT, zIndex: i }}
          draggable
          onDragStart={(e) => handleDragStart(e, poolIndex)}
        >
          <CardImage card={card} />
        </div>
      ))}
    </div>
  );
}
