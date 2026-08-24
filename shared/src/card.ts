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
}

/** One card entry as it appears in an imported CubeCobra cube list. */
export interface CubeCard {
  name: string;
  /** Set when the name couldn't be resolved against the local card cache or Scryfall. */
  unresolved?: boolean;
}
