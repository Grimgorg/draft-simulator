import { useMemo } from "react";
import type { Card } from "@draft-simulator/shared";
import { CardImage } from "./CardImage.js";
import { UnresolvedCardsWarning } from "./UnresolvedCardsWarning.js";

interface CubePreviewModalProps {
  cubeName: string;
  cards: Card[];
  unresolvedNames: string[];
  onClose: () => void;
}

export function CubePreviewModal({ cubeName, cards, unresolvedNames, onClose }: CubePreviewModalProps) {
  // Cubes list one entry per physical slot (basics/staples repeat many
  // times) — for an art check, one copy per unique card is what's useful.
  const uniqueCards = useMemo(() => {
    const seen = new Map<string, Card>();
    for (const card of cards) {
      if (!seen.has(card.scryfallId)) seen.set(card.scryfallId, card);
    }
    return [...seen.values()].sort((a, b) => a.name.localeCompare(b.name));
  }, [cards]);

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="cube-preview-heading"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-header">
          <div>
            <h2 id="cube-preview-heading">{cubeName}</h2>
            <p className="subtitle">
              {uniqueCards.length} unique card{uniqueCards.length === 1 ? "" : "s"} ({cards.length} total)
            </p>
          </div>
          <button type="button" className="modal-close" onClick={onClose} aria-label="Close preview">
            &times;
          </button>
        </div>
        <UnresolvedCardsWarning names={unresolvedNames} />
        <div className="modal-body pack-grid">
          {uniqueCards.map((card) => (
            <CardImage key={card.scryfallId} card={card} />
          ))}
        </div>
      </div>
    </div>
  );
}
