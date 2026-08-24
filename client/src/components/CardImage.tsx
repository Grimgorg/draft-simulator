import type { Card } from "@draft-simulator/shared";
import { useCardPreview } from "../CardPreviewContext.js";
import { resolveImageUrl } from "../socket.js";

interface CardImageProps {
  card: Card;
  onClick?: () => void;
  disabled?: boolean;
}

export function CardImage({ card, onClick, disabled }: CardImageProps) {
  const { setHoveredCard } = useCardPreview();
  const content = <img src={resolveImageUrl(card.imageUrl)} alt={card.name} loading="lazy" />;

  const hoverHandlers = {
    onMouseEnter: () => setHoveredCard(card),
    onMouseLeave: () => setHoveredCard(null),
  };

  if (!onClick) {
    return (
      <div className="card" {...hoverHandlers}>
        {content}
      </div>
    );
  }

  return (
    <button
      type="button"
      className="card card-button"
      onClick={onClick}
      disabled={disabled}
      aria-label={card.name}
      {...hoverHandlers}
    >
      {content}
    </button>
  );
}
