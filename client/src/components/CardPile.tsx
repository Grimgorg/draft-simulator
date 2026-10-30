import type { Card } from "@draft-simulator/shared";
import { CardImage } from "./CardImage.js";

interface PiledCard {
  id: string;
  card: Card;
}

interface CardPileProps {
  cards: PiledCard[];
  /** Called with the dragged card's id plus every id stacked on top of it,
   * bottom to top — dragging a card brings its whole "run" along, unless the
   * drag started with Ctrl or ⌘ held, which takes just that card. */
  onDropCard: (ids: string[]) => void;
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

  function handleDragStart(e: React.DragEvent, index: number) {
    // Everything stacked above the dragged card (higher index, per the
    // z-index convention below) comes along as one rigid run. Ctrl takes
    // the card out on its own; ⌘ too, since on a Mac Ctrl+click opens the
    // context menu and the drag never starts.
    const movingIds = e.ctrlKey || e.metaKey ? [cards[index]!.id] : cards.slice(index).map((c) => c.id);
    e.dataTransfer.setData("text/plain", movingIds.join(","));
    e.dataTransfer.effectAllowed = "move";
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    e.stopPropagation();
    const raw = e.dataTransfer.getData("text/plain");
    const ids = raw ? raw.split(",") : [];
    if (ids.length > 0) onDropCard(ids);
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
          onDragStart={(e) => handleDragStart(e, i)}
        >
          <CardImage card={card} />
        </div>
      ))}
    </div>
  );
}
