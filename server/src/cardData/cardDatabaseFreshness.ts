import { countCards, getLastImportedAt } from "./cardRepository.js";
import { importCardDatabase } from "./importBulkData.js";

function maxAgeDays(): number {
  const raw = process.env.CARD_CACHE_MAX_AGE_DAYS;
  const parsed = raw === undefined ? NaN : Number(raw);
  // `raw || 30` would silently ignore an explicit "0" (falsy), which should
  // mean "always refresh," not "use the default."
  return Number.isFinite(parsed) ? parsed : 30;
}

const MAX_AGE_MS = maxAgeDays() * 24 * 60 * 60 * 1000;

/**
 * Refreshes the local Scryfall card cache when it's empty or older than
 * `CARD_CACHE_MAX_AGE_DAYS` (default 30) — the server runs on-demand per
 * draft rather than continuously, so a time-based schedule (cron, an
 * in-process interval) would often just miss its window. Checking on every
 * startup instead means the host never has to remember to re-run
 * `import-cards` manually.
 */
export async function refreshCardDatabaseIfStale(): Promise<void> {
  const isEmpty = countCards() === 0;
  const lastImportedAt = getLastImportedAt();
  const isStale = isEmpty || !lastImportedAt || Date.now() - Date.parse(lastImportedAt) > MAX_AGE_MS;

  if (!isStale) {
    console.log(`Card database is up to date (last refreshed ${lastImportedAt}).`);
    return;
  }

  console.log(
    isEmpty
      ? "No local card database found — importing now, this may take a minute..."
      : `Card database is stale (last refreshed ${lastImportedAt ?? "never"}) — refreshing...`,
  );
  try {
    const { imported, skipped } = await importCardDatabase();
    console.log(`Card database refreshed: ${imported} cards imported (${skipped} skipped).`);
  } catch (err) {
    console.error("Automatic card database refresh failed; continuing with the existing cache.", err);
  }
}
