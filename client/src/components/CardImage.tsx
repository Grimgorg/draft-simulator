import { useEffect, useRef } from "react";
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
  const isHovered = useRef(false);
  const content = <img src={resolveImageUrl(card.imageUrl)} alt={card.name} loading="lazy" />;

  // onMouseLeave never fires when this element is unmounted while still
  // hovered (e.g. the pack updates after a pick, or the draft is
  // cancelled/reset) — without this, the preview overlay would keep
  // showing this card forever on whatever screen comes next.
  useEffect(() => {
    return () => {
      if (isHovered.current) setHoveredCard(null);
    };
  }, [setHoveredCard]);

  const hoverHandlers = {
    onMouseEnter: () => {
      isHovered.current = true;
      setHoveredCard(card);
    },
    onMouseLeave: () => {
      isHovered.current = false;
      setHoveredCard(null);
    },
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
