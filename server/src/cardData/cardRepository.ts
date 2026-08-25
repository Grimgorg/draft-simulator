import type { Card } from "@draft-simulator/shared";
import { getDb } from "../db/database.js";

interface CardRow {
  scryfall_id: string;
  name: string;
  name_lower: string;
  front_name_lower: string;
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

/**
 * Looks up a card by exact name, falling back to matching just the front
 * face for double-faced cards (Scryfall stores those as "Front // Back",
 * but sources like CubeCobra often refer to them by front face name alone).
 */
function findRow(byExactName: import("better-sqlite3").Statement, byFrontName: import("better-sqlite3").Statement, name: string): CardRow | undefined {
  const lower = name.toLowerCase();
  return (byExactName.get(lower) ?? byFrontName.get(lower)) as CardRow | undefined;
}

export function findCardByName(name: string): Card | undefined {
  const db = getDb();
  const byExactName = db.prepare("SELECT * FROM cards WHERE name_lower = ?");
  const byFrontName = db.prepare("SELECT * FROM cards WHERE front_name_lower = ? LIMIT 1");
  const row = findRow(byExactName, byFrontName, name);
  return row ? rowToCard(row) : undefined;
}

/** Resolves a batch of card names against the local cache. Names with no match are simply absent from the result. */
export function findCardsByNames(names: string[]): Map<string, Card> {
  const db = getDb();
  const byExactName = db.prepare("SELECT * FROM cards WHERE name_lower = ?");
  const byFrontName = db.prepare("SELECT * FROM cards WHERE front_name_lower = ? LIMIT 1");
  const result = new Map<string, Card>();
  for (const name of names) {
    const row = findRow(byExactName, byFrontName, name);
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

export function getLastImportedAt(): string | undefined {
  const row = getDb().prepare("SELECT value FROM import_meta WHERE key = 'last_imported_at'").get() as
    | { value: string }
    | undefined;
  return row?.value;
}

export function setLastImportedAt(iso: string): void {
  getDb()
    .prepare("INSERT INTO import_meta (key, value) VALUES ('last_imported_at', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
    .run(iso);
}
