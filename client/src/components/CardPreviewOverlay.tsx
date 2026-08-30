import { useCardPreview } from "../CardPreviewContext.js";
import { resolveImageUrl } from "../socket.js";

/** Fixed-corner large preview of whichever card is currently hovered — mounted once at the app root. */
export function CardPreviewOverlay() {
  const { hoveredCard } = useCardPreview();
  if (!hoveredCard) return null;

  const isDoubleFaced = Boolean(hoveredCard.backImageUrl);

  return (
    <div className={`card-preview-overlay${isDoubleFaced ? " card-preview-overlay--dfc" : ""}`}>
      <img src={resolveImageUrl(hoveredCard.imageUrl)} alt={hoveredCard.name} />
      {hoveredCard.backImageUrl && <img src={resolveImageUrl(hoveredCard.backImageUrl)} alt={`${hoveredCard.name} (back)`} />}
    </div>
  );
}
