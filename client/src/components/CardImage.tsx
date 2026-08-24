import type { Card } from "@draft-simulator/shared";
import { resolveImageUrl } from "../socket.js";

interface CardImageProps {
  card: Card;
  onClick?: () => void;
  disabled?: boolean;
}

export function CardImage({ card, onClick, disabled }: CardImageProps) {
  const content = <img src={resolveImageUrl(card.imageUrl)} alt={card.name} loading="lazy" />;

  if (!onClick) {
    return <div className="card">{content}</div>;
  }

  return (
    <button type="button" className="card card-button" onClick={onClick} disabled={disabled} aria-label={card.name}>
      {content}
    </button>
  );
}
