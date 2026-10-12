/** A card as resolved from the local Scryfall cache, ready for draft use. */
export interface Card {
  /** Scryfall's stable card id — used everywhere as the canonical card identifier. */
  scryfallId: string;
  name: string;
  manaCost: string;
  cmc: number;
  colors: string[];
  typeLine: string;
  /** Path served by the local server (server/data/images), not a raw Scryfall URL. */
  imageUrl: string;
  /** Set only for double-faced cards (transform, modal DFC, etc.) — the back face's image path. */
  backImageUrl?: string;
}
