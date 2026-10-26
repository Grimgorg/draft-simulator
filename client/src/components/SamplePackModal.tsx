import type { Card } from "@draft-simulator/shared";
import { CardImage } from "./CardImage.js";

interface SamplePackModalProps {
  setName: string;
  /** Null until the first pack arrives. */
  cards: Card[] | null;
  opening: boolean;
  error: string | null;
  onOpenAnother: () => void;
  onClose: () => void;
}

export function SamplePackModal({ setName, cards, opening, error, onOpenAnother, onClose }: SamplePackModalProps) {
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="sample-pack-heading"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-header">
          <div>
            <h2 id="sample-pack-heading">{setName}</h2>
            <p className="subtitle">A sample pack: the draft's packs are opened fresh when it starts.</p>
          </div>
          <button type="button" className="modal-close" onClick={onClose} aria-label="Close sample pack">
            &times;
          </button>
        </div>
        <div className="preview-actions">
          <button type="button" onClick={onOpenAnother} disabled={opening}>
            {opening ? "Opening..." : "Open another"}
          </button>
        </div>
        {error && <p className="error">{error}</p>}
        <div className="modal-body pack-grid">
          {cards?.map((card, index) => (
            // A pack can hold two copies of a card (e.g. basics), so the id alone isn't a unique key.
            <CardImage key={`${index}-${card.scryfallId}`} card={card} />
          ))}
        </div>
      </div>
    </div>
  );
}
