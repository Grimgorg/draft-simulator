import type { Card } from "@draft-simulator/shared";
import { CardImage } from "./CardImage.js";

interface PiledCard {
  id: string;
  card: Card;
}

interface CardPileProps {
  cards: PiledCard[];
  onDropCard: (id: string) => void;
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

  function handleDragStart(e: React.DragEvent, id: string) {
    e.dataTransfer.setData("text/plain", id);
    e.dataTransfer.effectAllowed = "move";
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    e.stopPropagation();
    const id = e.dataTransfer.getData("text/plain");
    if (id) onDropCard(id);
  }

  return (
    <div
      className="pile"
      style={{ height: topIndex * PEEK_HEIGHT + CARD_HEIGHT }}
      onDragOver={(e) => e.preventDefault()}
      onDrop={handleDrop}
    >
      {cards.map(({ id, card }, i) => (
        <div
          key={id}
          className="pile-card"
          style={{ top: i * PEEK_HEIGHT, zIndex: i }}
          draggable
          onDragStart={(e) => handleDragStart(e, id)}
        >
          <CardImage card={card} />
        </div>
      ))}
    </div>
  );
}
