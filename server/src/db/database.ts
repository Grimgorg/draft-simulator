import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";

export const DATA_DIR = path.join(import.meta.dirname, "../../data");
export const DB_PATH = path.join(DATA_DIR, "cards.sqlite3");

let db: Database.Database | undefined;

export function getDb(): Database.Database {
  if (db) return db;

  fs.mkdirSync(DATA_DIR, { recursive: true });
  db = new Database(DB_PATH);
  db.pragma("journal_mode = WAL");
  db.exec(`
    CREATE TABLE IF NOT EXISTS cards (
      scryfall_id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      name_lower TEXT NOT NULL,
      front_name_lower TEXT NOT NULL,
      mana_cost TEXT NOT NULL,
      cmc REAL NOT NULL,
      colors TEXT NOT NULL,
      type_line TEXT NOT NULL,
      source_image_uri TEXT NOT NULL,
      back_image_uri TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_cards_name_lower ON cards(name_lower);
    CREATE INDEX IF NOT EXISTS idx_cards_front_name_lower ON cards(front_name_lower);

    CREATE TABLE IF NOT EXISTS import_meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);

  // The CREATE TABLE above only applies to a fresh database — existing
  // installs need their already-created `cards` table migrated in place.
  const cardColumns = db.prepare("PRAGMA table_info(cards)").all() as { name: string }[];
  if (!cardColumns.some((column) => column.name === "back_image_uri")) {
    db.exec("ALTER TABLE cards ADD COLUMN back_image_uri TEXT");
  }

  return db;
}
