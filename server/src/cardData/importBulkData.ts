/**
 * One-off/occasional import script: pulls Scryfall's "oracle_cards" bulk data
 * file (one entry per unique card, not per printing) and loads it into the
 * local SQLite cache used for CubeCobra import resolution and image serving.
 *
 * Run with: npm run import-cards --workspace server
 */
import readline from "node:readline";
import { Readable } from "node:stream";
import zlib from "node:zlib";
import { DB_PATH, getDb } from "../db/database.js";

const USER_AGENT = "DraftSimulator/0.1 (personal cube draft tool; not for redistribution)";

interface ScryfallCardFace {
  mana_cost?: string;
  colors?: string[];
  image_uris?: { normal?: string };
}

interface ScryfallCard {
  id: string;
  name: string;
  lang: string;
  mana_cost?: string;
  cmc?: number;
  colors?: string[];
  type_line?: string;
  image_uris?: { normal?: string };
  card_faces?: ScryfallCardFace[];
}

interface BulkDataEntry {
  type: string;
  jsonl_download_uri: string;
  updated_at: string;
  compressed_size: number;
}

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url, {
    headers: { "User-Agent": USER_AGENT, Accept: "application/json" },
  });
  if (!res.ok) {
    throw new Error(`Request to ${url} failed: ${res.status} ${res.statusText}`);
  }
  return res.json() as Promise<T>;
}

/** Downloads and decompresses Scryfall's gzip-compressed JSONL bulk data file (one card object per line). */
async function fetchOracleCards(url: string): Promise<ScryfallCard[]> {
  const res = await fetch(url, { headers: { "User-Agent": USER_AGENT } });
  if (!res.ok || !res.body) {
    throw new Error(`Request to ${url} failed: ${res.status} ${res.statusText}`);
  }

  const gunzip = Readable.fromWeb(res.body as import("node:stream/web").ReadableStream<Uint8Array>).pipe(
    zlib.createGunzip()
  );
  const lines = readline.createInterface({ input: gunzip, crlfDelay: Infinity });

  const cards: ScryfallCard[] = [];
  for await (const line of lines) {
    if (!line.trim()) continue;
    cards.push(JSON.parse(line) as ScryfallCard);
  }
  return cards;
}

function extractImageUri(card: ScryfallCard): string | undefined {
  return card.image_uris?.normal ?? card.card_faces?.find((f) => f.image_uris?.normal)?.image_uris?.normal;
}

function extractManaCost(card: ScryfallCard): string {
  if (card.mana_cost !== undefined) return card.mana_cost;
  const faceCosts = card.card_faces?.map((f) => f.mana_cost ?? "").filter(Boolean) ?? [];
  return faceCosts.join(" // ");
}

function extractColors(card: ScryfallCard): string[] {
  if (card.colors) return card.colors;
  const faceColors = card.card_faces?.flatMap((f) => f.colors ?? []) ?? [];
  return [...new Set(faceColors)];
}

async function main() {
  console.log("Fetching Scryfall bulk data catalog...");
  const { data: entries } = await fetchJson<{ data: BulkDataEntry[] }>("https://api.scryfall.com/bulk-data");

  const oracleCards = entries.find((entry) => entry.type === "oracle_cards");
  if (!oracleCards) {
    throw new Error("Could not find an 'oracle_cards' entry in the Scryfall bulk data catalog");
  }

  const sizeMb = (oracleCards.compressed_size / 1_000_000).toFixed(1);
  console.log(`Downloading oracle_cards (${sizeMb} MB compressed, last updated ${oracleCards.updated_at})...`);
  const cards = await fetchOracleCards(oracleCards.jsonl_download_uri);
  console.log(`Downloaded ${cards.length} cards. Importing into local database...`);

  const db = getDb();
  const insert = db.prepare(`
    INSERT INTO cards (scryfall_id, name, name_lower, front_name_lower, mana_cost, cmc, colors, type_line, source_image_uri)
    VALUES (@scryfall_id, @name, @name_lower, @front_name_lower, @mana_cost, @cmc, @colors, @type_line, @source_image_uri)
  `);

  const importAll = db.transaction((rows: ScryfallCard[]) => {
    db.exec("DELETE FROM cards");
    let imported = 0;
    let skipped = 0;
    for (const card of rows) {
      const imageUri = extractImageUri(card);
      if (!imageUri) {
        skipped++;
        continue;
      }
      insert.run({
        scryfall_id: card.id,
        name: card.name,
        name_lower: card.name.toLowerCase(),
        // CubeCobra (and other sources) often refer to double-faced cards by
        // just their front face name, e.g. "Delver of Secrets" rather than
        // Scryfall's combined "Delver of Secrets // Insectile Aberration".
        front_name_lower: card.name.split(" // ")[0]!.trim().toLowerCase(),
        mana_cost: extractManaCost(card),
        cmc: card.cmc ?? 0,
        colors: JSON.stringify(extractColors(card)),
        type_line: card.type_line ?? "",
        source_image_uri: imageUri,
      });
      imported++;
    }
    return { imported, skipped };
  });

  const { imported, skipped } = importAll(cards);
  console.log(`Imported ${imported} cards into ${DB_PATH} (skipped ${skipped} with no image).`);
}

main().catch((err: unknown) => {
  console.error("Card import failed:", err);
  process.exitCode = 1;
});
