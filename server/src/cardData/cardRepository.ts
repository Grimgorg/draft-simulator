import type { Card } from "@draft-simulator/shared";
import { getDb } from "../db/database.js";

interface CardRow {
  scryfall_id: string;
  name: string;
  name_lower: string;
  mana_cost: string;
  cmc: number;
  colors: string;
  type_line: string;
  source_image_uri: string;
}

function rowToCard(row: CardRow): Card {
  return {
    scryfallId: row.scryfall_id,
    name: row.name,
    manaCost: row.mana_cost,
    cmc: row.cmc,
    colors: JSON.parse(row.colors) as string[],
    typeLine: row.type_line,
    // Local, server-served path — the client never talks to Scryfall directly.
    imageUrl: `/images/${row.scryfall_id}`,
  };
}

export function findCardByName(name: string): Card | undefined {
  const row = getDb()
    .prepare("SELECT * FROM cards WHERE name_lower = ?")
    .get(name.toLowerCase()) as CardRow | undefined;
  return row ? rowToCard(row) : undefined;
}

/** Resolves a batch of card names against the local cache. Names with no match are simply absent from the result. */
export function findCardsByNames(names: string[]): Map<string, Card> {
  const stmt = getDb().prepare("SELECT * FROM cards WHERE name_lower = ?");
  const result = new Map<string, Card>();
  for (const name of names) {
    const row = stmt.get(name.toLowerCase()) as CardRow | undefined;
    if (row) result.set(name, rowToCard(row));
  }
  return result;
}

export function getSourceImageUri(scryfallId: string): string | undefined {
  const row = getDb()
    .prepare("SELECT source_image_uri FROM cards WHERE scryfall_id = ?")
    .get(scryfallId) as { source_image_uri: string } | undefined;
  return row?.source_image_uri;
}

export function countCards(): number {
  const row = getDb().prepare("SELECT COUNT(*) as count FROM cards").get() as { count: number };
  return row.count;
}
