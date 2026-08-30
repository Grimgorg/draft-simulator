import { useMemo } from "react";
import type { Card } from "@draft-simulator/shared";
import { CardImage } from "./CardImage.js";

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
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <div>
            <h2>{cubeName}</h2>
            <p className="subtitle">
              {uniqueCards.length} unique card{uniqueCards.length === 1 ? "" : "s"} ({cards.length} total)
            </p>
          </div>
          <button type="button" className="modal-close" onClick={onClose} aria-label="Close preview">
            &times;
          </button>
        </div>
        {unresolvedNames.length > 0 && (
          <p className="warning">
            {unresolvedNames.length} card(s) from this cube couldn't be found and were skipped:{" "}
            {unresolvedNames.join(", ")}
          </p>
        )}
        <div className="modal-body pack-grid">
          {uniqueCards.map((card) => (
            <CardImage key={card.scryfallId} card={card} />
          ))}
        </div>
      </div>
    </div>
  );
}
