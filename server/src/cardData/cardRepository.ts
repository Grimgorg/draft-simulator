import type BetterSqlite3 from "better-sqlite3";
import type { Card } from "@draft-simulator/shared";
import { getDb } from "../db/database.js";

const statements = new WeakMap<BetterSqlite3.Database, Map<string, BetterSqlite3.Statement>>();

/**
 * Prepares each distinct query once per database connection and reuses it.
 * Preparing a fresh statement on every call (as this file used to, on hot
 * paths like every card image request) leaves a stream of statements for
 * the garbage collector to finalize — and with better-sqlite3 11.x on
 * Node 24, finalizing one at the wrong moment aborted the whole process
 * ("Assertion failed: (env) != nullptr"), taking a live draft down with it.
 * Reuse is also simply faster.
 */
function statement(sql: string): BetterSqlite3.Statement {
  const db = getDb();
  let cache = statements.get(db);
  if (!cache) {
    cache = new Map();
    statements.set(db, cache);
  }
  let stmt = cache.get(sql);
  if (!stmt) {
    stmt = db.prepare(sql);
    cache.set(sql, stmt);
  }
  return stmt;
}

const BY_EXACT_NAME = "SELECT * FROM cards WHERE name_lower = ?";
const BY_FRONT_NAME = "SELECT * FROM cards WHERE front_name_lower = ? LIMIT 1";

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
  back_image_uri: string | null;
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
    ...(row.back_image_uri ? { backImageUrl: `/images/${row.scryfall_id}/back` } : {}),
  };
}

/**
 * Looks up a card by exact name, falling back to matching just the front
 * face for double-faced cards (Scryfall stores those as "Front // Back",
 * but sources like CubeCobra often refer to them by front face name alone).
 */
function findRow(name: string): CardRow | undefined {
  const lower = name.toLowerCase();
  return (statement(BY_EXACT_NAME).get(lower) ?? statement(BY_FRONT_NAME).get(lower)) as CardRow | undefined;
}

export function findCardByName(name: string): Card | undefined {
  const row = findRow(name);
  return row ? rowToCard(row) : undefined;
}

/** Resolves a batch of card names against the local cache. Names with no match are simply absent from the result. */
export function findCardsByNames(names: string[]): Map<string, Card> {
  const result = new Map<string, Card>();
  for (const name of names) {
    const row = findRow(name);
    if (row) result.set(name, rowToCard(row));
  }
  return result;
}

export function getSourceImageUri(scryfallId: string): string | undefined {
  const row = statement("SELECT source_image_uri FROM cards WHERE scryfall_id = ?").get(scryfallId) as { source_image_uri: string } | undefined;
  return row?.source_image_uri;
}

export function getBackImageUri(scryfallId: string): string | undefined {
  const row = statement("SELECT back_image_uri FROM cards WHERE scryfall_id = ?").get(scryfallId) as { back_image_uri: string | null } | undefined;
  return row?.back_image_uri ?? undefined;
}

export function countCards(): number {
  const row = statement("SELECT COUNT(*) as count FROM cards").get() as { count: number };
  return row.count;
}

export function getLastImportedAt(): string | undefined {
  const row = statement("SELECT value FROM import_meta WHERE key = 'last_imported_at'").get() as
    | { value: string }
    | undefined;
  return row?.value;
}

export function setLastImportedAt(iso: string): void {
  statement(
    "INSERT INTO import_meta (key, value) VALUES ('last_imported_at', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value"
  ).run(iso);
}
