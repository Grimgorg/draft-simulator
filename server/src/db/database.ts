import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { isPackaged, loadEmbeddedSqliteAddon, resolveDataDir } from "../packaged/seaRuntime.js";

export const DATA_DIR = resolveDataDir();
export const DB_PATH = path.join(DATA_DIR, "cards.sqlite3");

let db: Database.Database | undefined;

export function getDb(): Database.Database {
  if (db) return db;

  fs.mkdirSync(DATA_DIR, { recursive: true });
  // better-sqlite3 accepts an already-loaded addon object here, though its
  // types only declare a path string: https://github.com/WiseLibs/better-sqlite3/issues/972
  db = new Database(
    DB_PATH,
    isPackaged ? { nativeBinding: loadEmbeddedSqliteAddon(DATA_DIR) as unknown as string } : undefined,
  );
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
      back_image_uri TEXT,
      oracle_id TEXT
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
  if (!cardColumns.some((column) => column.name === "oracle_id")) {
    db.exec("ALTER TABLE cards ADD COLUMN oracle_id TEXT");
    // The new column is empty until the next import, and cubes can't fall back to
    // oracle ids until then, so mark the cache stale: the next startup refreshes it.
    db.exec("DELETE FROM import_meta WHERE key = 'last_imported_at'");
  }
  // Created only after the migration: on an older table the column doesn't exist before it.
  db.exec("CREATE INDEX IF NOT EXISTS idx_cards_oracle_id ON cards(oracle_id)");

  return db;
}
