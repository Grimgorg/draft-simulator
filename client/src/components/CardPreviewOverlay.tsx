import { useCardPreview } from "../CardPreviewContext.js";
import { resolveImageUrl } from "../socket.js";

/** Fixed-corner large preview of whichever card is currently hovered — mounted once at the app root. */
export function CardPreviewOverlay() {
  const { hoveredCard } = useCardPreview();
  if (!hoveredCard) return null;

  return (
    <div className="card-preview-overlay">
      <img src={resolveImageUrl(hoveredCard.imageUrl)} alt={hoveredCard.name} />
    </div>
  );
}
