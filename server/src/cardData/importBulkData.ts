/**
 * One-off/occasional import script: pulls Scryfall's "default_cards" bulk
 * data file (every printing of every card), reduces each card down to its
 * first (earliest-released) normal paper-set printing, and loads the result
 * into the local SQLite cache used for CubeCobra import resolution and image
 * serving. Also keeps every printing of the sets that set drafts open (see
 * selectSetPrintings).
 *
 * Run with: npm run import-cards --workspace server
 */
import readline from "node:readline";
import { pathToFileURL } from "node:url";
import { Readable } from "node:stream";
import zlib from "node:zlib";
import { DB_PATH, getDb } from "../db/database.js";
import { SET_PRINTING_CODES } from "../setBoosters/printingSets.js";
import { setLastImportedAt } from "./cardRepository.js";

const USER_AGENT = "DraftSimulator/0.1 (personal cube draft tool; not for redistribution)";

interface ScryfallCardFace {
  mana_cost?: string;
  colors?: string[];
  image_uris?: { normal?: string };
}

export interface ScryfallCard {
  id: string;
  oracle_id: string;
  name: string;
  layout: string;
  lang: string;
  released_at: string;
  set: string;
  collector_number: string;
  rarity: string;
  digital?: boolean;
  promo?: boolean;
  full_art?: boolean;
  border_color?: string;
  frame_effects?: string[];
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
async function fetchBulkCards(url: string): Promise<ScryfallCard[]> {
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

/**
 * True for genuine two-sided physical cards (transform, modal DFC, etc.) —
 * as opposed to split/flip/adventure cards, which pack both halves into one
 * face and so still carry a top-level `image_uris`.
 */
function isDoubleSided(card: ScryfallCard): boolean {
  return !card.image_uris && (card.card_faces?.filter((f) => f.image_uris?.normal).length ?? 0) >= 2;
}

function extractBackImageUri(card: ScryfallCard): string | undefined {
  if (!isDoubleSided(card)) return undefined;
  return card.card_faces![1]!.image_uris?.normal;
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

const SPECIAL_FRAME_EFFECTS = new Set(["extendedart", "showcase", "etched"]);

/** True for full-art, borderless, extended-art/showcase, or etched-foil treatments — as opposed to a plain/standard card frame. */
function isSpecialArt(card: ScryfallCard): boolean {
  if (card.full_art) return true;
  if (card.border_color === "borderless") return true;
  return (card.frame_effects ?? []).some((effect) => SPECIAL_FRAME_EFFECTS.has(effect));
}

/**
 * Bulk-data entries that aren't draftable cards but often share a real card's
 * name: an eternalize token copies its card's name ("Timeless Witness"), and an
 * Art Series card is named "Front // Front" after a double-faced card. Imported,
 * they won the name lookup for dozens of real cards, so a cube resolved those
 * slots to a token or an art card instead of the card itself.
 */
const NON_CARD_LAYOUTS = new Set(["token", "double_faced_token", "emblem", "art_series", "front_card"]);

/**
 * Reduces every printing of every card down to a single "first printing" per
 * card: the earliest-released, normal paper-set printing with a standard
 * card frame. Falls back to promo/digital/special-art/imageless printings
 * only when a card has no better option, so no card is ever dropped for
 * lack of an eligible "normal" printing. Tokens and other non-card layouts
 * are dropped entirely (see NON_CARD_LAYOUTS).
 */
export function selectFirstPrintings(cards: ScryfallCard[]): ScryfallCard[] {
  const groups = new Map<string, ScryfallCard[]>();
  for (const card of cards) {
    if (NON_CARD_LAYOUTS.has(card.layout)) continue;
    const key = card.oracle_id ?? card.name.toLowerCase();
    const group = groups.get(key);
    if (group) group.push(card);
    else groups.set(key, [card]);
  }

  const selected: ScryfallCard[] = [];
  for (const printings of groups.values()) {
    const withImage = printings.filter((c) => extractImageUri(c));
    const pool = withImage.length > 0 ? withImage : printings;

    const normalPrintings = pool.filter((c) => !c.digital && !c.promo);
    const nonPromo = normalPrintings.length > 0 ? normalPrintings : pool;

    const normalFrame = nonPromo.filter((c) => !isSpecialArt(c));
    const candidates = normalFrame.length > 0 ? normalFrame : nonPromo;

    selected.push(candidates.reduce((earliest, c) => (c.released_at < earliest.released_at ? c : earliest)));
  }
  return selected;
}

/**
 * Every printing of the given sets that a booster can hold, for set drafts: unlike a cube, which names
 * cards, a set's packs are built from specific printings (an alternate frame is a different printing of
 * the same card). Imageless printings are dropped like in selectFirstPrintings.
 */
export function selectSetPrintings(cards: ScryfallCard[], setCodes: readonly string[]): ScryfallCard[] {
  return cards.filter(
    (card) => setCodes.includes(card.set) && !NON_CARD_LAYOUTS.has(card.layout) && extractImageUri(card) !== undefined
  );
}

/** The columns `cards` and `set_printings` share. */
function cardColumns(card: ScryfallCard, imageUri: string) {
  return {
    scryfall_id: card.id,
    name: card.name,
    mana_cost: extractManaCost(card),
    cmc: card.cmc ?? 0,
    colors: JSON.stringify(extractColors(card)),
    type_line: card.type_line ?? "",
    source_image_uri: imageUri,
    back_image_uri: extractBackImageUri(card) ?? null,
    // Missing on some layouts (reversible cards keep it on each face only).
    oracle_id: card.oracle_id ?? null,
  };
}

export async function importCardDatabase(): Promise<{ imported: number; skipped: number }> {
  console.log("Fetching Scryfall bulk data catalog...");
  const { data: entries } = await fetchJson<{ data: BulkDataEntry[] }>("https://api.scryfall.com/bulk-data");

  const defaultCards = entries.find((entry) => entry.type === "default_cards");
  if (!defaultCards) {
    throw new Error("Could not find a 'default_cards' entry in the Scryfall bulk data catalog");
  }

  const sizeMb = (defaultCards.compressed_size / 1_000_000).toFixed(1);
  console.log(`Downloading default_cards (${sizeMb} MB compressed, last updated ${defaultCards.updated_at})...`);
  const printings = await fetchBulkCards(defaultCards.jsonl_download_uri);
  console.log(`Downloaded ${printings.length} printings. Selecting first printing per card...`);
  const cards = selectFirstPrintings(printings);
  const setPrintings = selectSetPrintings(printings, SET_PRINTING_CODES);
  console.log(
    `Resolved to ${cards.length} unique cards and ${setPrintings.length} printings for set drafts. ` +
      "Importing into local database..."
  );

  const db = getDb();
  const insert = db.prepare(`
    INSERT INTO cards (scryfall_id, name, name_lower, front_name_lower, mana_cost, cmc, colors, type_line, source_image_uri, back_image_uri, oracle_id)
    VALUES (@scryfall_id, @name, @name_lower, @front_name_lower, @mana_cost, @cmc, @colors, @type_line, @source_image_uri, @back_image_uri, @oracle_id)
  `);
  const insertSetPrinting = db.prepare(`
    INSERT INTO set_printings (scryfall_id, set_code, collector_number, rarity, name, mana_cost, cmc, colors, type_line, source_image_uri, back_image_uri, oracle_id)
    VALUES (@scryfall_id, @set_code, @collector_number, @rarity, @name, @mana_cost, @cmc, @colors, @type_line, @source_image_uri, @back_image_uri, @oracle_id)
  `);

  const importAll = db.transaction((rows: ScryfallCard[]) => {
    db.exec("DELETE FROM cards");
    db.exec("DELETE FROM set_printings");
    for (const printing of setPrintings) {
      insertSetPrinting.run({
        ...cardColumns(printing, extractImageUri(printing)!),
        set_code: printing.set,
        collector_number: printing.collector_number,
        rarity: printing.rarity,
      });
    }
    let imported = 0;
    let skipped = 0;
    for (const card of rows) {
      const imageUri = extractImageUri(card);
      if (!imageUri) {
        skipped++;
        continue;
      }
      insert.run({
        ...cardColumns(card, imageUri),
        name_lower: card.name.toLowerCase(),
        // CubeCobra (and other sources) often refer to double-faced cards by
        // just their front face name, e.g. "Delver of Secrets" rather than
        // Scryfall's combined "Delver of Secrets // Insectile Aberration".
        front_name_lower: card.name.split(" // ")[0]!.trim().toLowerCase(),
      });
      imported++;
    }
    return { imported, skipped };
  });

  const { imported, skipped } = importAll(cards);
  console.log(`Imported ${imported} cards into ${DB_PATH} (skipped ${skipped} with no image).`);
  setLastImportedAt(new Date().toISOString());
  return { imported, skipped };
}

// Only run automatically when this file is executed directly (`npm run
// import-cards`) — not when `importCardDatabase` is imported and called
// elsewhere, e.g. the server's startup staleness check. Compared via
// pathToFileURL rather than a hand-built `file://${argv[1]}`: on Windows,
// argv[1] is a backslashed "C:\..." path that never equals import.meta.url's
// "file:///C:/..." form, so the script silently did nothing there.
const isMainModule = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMainModule) {
  importCardDatabase().catch((err: unknown) => {
    console.error("Card import failed:", err);
    process.exitCode = 1;
  });
}
