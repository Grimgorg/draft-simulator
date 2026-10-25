import type { Card } from "@draft-simulator/shared";

/** One printing of a card in a set, as a set's booster draws it. */
export interface SetPrinting {
  card: Card;
  /** Scryfall's set code: "fra". */
  setCode: string;
  /** Scryfall's collector number: a string, as some sets number cards "12a" or "★". */
  collectorNumber: string;
  /** Scryfall's rarity: "common", "uncommon", "rare", "mythic" (or "special", "bonus"). */
  rarity: string;
  /** The same for every printing of one card, so a booster-fun version can be matched to its regular printing. */
  oracleId: string;
}
