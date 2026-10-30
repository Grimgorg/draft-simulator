import { randomUUID } from "node:crypto";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import type { Request, Response } from "express";
import { DATA_DIR } from "../db/database.js";
import { getBackImageUri, getSourceImageUri } from "../cardData/cardRepository.js";
import { clientAddress } from "../limits/clientAddress.js";
import { createWindowCounter } from "../limits/windowCounter.js";

let imageDir = path.join(DATA_DIR, "images");
const USER_AGENT = "DraftSimulator/0.1 (personal cube draft tool; not for redistribution)";

export function ensureImageDir(): void {
  fs.mkdirSync(imageDir, { recursive: true });
}

/** Test-only: caches images in an isolated directory instead of the real data dir. */
export function setImageDirForTests(isolatedImageDir: string): void {
  imageDir = isolatedImageDir;
}

/**
 * New images, downloaded from Scryfall and cached, that one address may cause per hour. A draft needs a few hundred,
 * and looking through a big cube about one per card; without a limit, one client could make the server download all
 * ~35,000 cards, gigabytes on the host's disk. Images already cached don't count. Scryfall's image hosts have no rate
 * limits of their own, so this is only about the host's disk and bandwidth.
 */
const MAX_DOWNLOADS_PER_HOUR = 2000;
const DOWNLOAD_WINDOW_MS = 60 * 60 * 1000;
let maxDownloadsPerHour = MAX_DOWNLOADS_PER_HOUR;
let downloadsByAddress = createWindowCounter(DOWNLOAD_WINDOW_MS);

/** Test-only: a fresh download count, with its own limit and clock. Without arguments, the real ones. */
export function setImageDownloadLimitForTests(limit = MAX_DOWNLOADS_PER_HOUR, now: () => number = Date.now): void {
  maxDownloadsPerHour = limit;
  downloadsByAddress = createWindowCounter(DOWNLOAD_WINDOW_MS, now);
}

/**
 * The cache file for `cacheKey`, or undefined unless it lies directly inside the image dir. A second barrier behind
 * the routes' UUID check, so loosening that check can't bring back the path traversal it fixed.
 */
export function resolveCachedImagePath(cacheKey: string): string | undefined {
  const root = path.resolve(imageDir) + path.sep;
  const cachedPath = path.resolve(root, `${cacheKey}.jpg`);
  if (!cachedPath.startsWith(root) || path.dirname(cachedPath) + path.sep !== root) return undefined;
  return cachedPath;
}

/**
 * Serves one card image from the local cache (keyed by `cacheKey`),
 * downloading and caching it from `sourceUri` on first request. Keeps the
 * client from ever talking to Scryfall directly and keeps the draft usable
 * if the host's internet drops mid-session.
 */
async function serveImage(
  req: Request,
  res: Response,
  lookupSourceUri: () => string | undefined,
  cacheKey: string
): Promise<void> {
  const cachedPath = resolveCachedImagePath(cacheKey);
  if (!cachedPath) {
    res.status(404).json({ error: "Unknown card" });
    return;
  }

  if (fs.existsSync(cachedPath)) {
    res.sendFile(cachedPath);
    return;
  }

  // Everything below stays inside the try, the database lookup included:
  // this is an async Express 4 handler, so anything thrown outside it would
  // be an unhandled rejection instead of an error response.
  try {
    const sourceUri = lookupSourceUri();
    if (!sourceUri) {
      res.status(404).json({ error: "Unknown card" });
      return;
    }

    const address = clientAddress(req.socket.remoteAddress, req.headers);
    if (downloadsByAddress.count(address) >= maxDownloadsPerHour) {
      res.status(429).json({ error: "Too many new card images from this address. Try again later." });
      return;
    }
    downloadsByAddress.add(address);

    const upstream = await fetch(sourceUri, { headers: { "User-Agent": USER_AGENT } });
    if (!upstream.ok) {
      res.status(502).json({ error: "Failed to fetch card image from Scryfall" });
      return;
    }
    const buffer = Buffer.from(await upstream.arrayBuffer());
    res.type("image/jpeg").send(buffer);

    // Cached via temp file + rename: every player sees the same cards, so
    // concurrent first requests for one image are common, and a plain
    // writeFile on cachedPath let another request find (and serve) a
    // half-written file. A failed cache write only costs a re-download.
    const tmpPath = `${cachedPath}.${randomUUID()}.tmp`;
    try {
      await fsp.writeFile(tmpPath, buffer);
      await fsp.rename(tmpPath, cachedPath);
    } catch (cacheErr) {
      await fsp.rm(tmpPath, { force: true });
      console.error(`Failed to cache image for ${cacheKey}:`, cacheErr);
    }
  } catch (err) {
    console.error(`Failed to fetch/cache image for ${cacheKey}:`, err);
    if (!res.headersSent) res.status(502).json({ error: "Failed to fetch card image" });
  }
}

// Scryfall ids are UUIDs. The id becomes part of a file path, and Express decodes "%2F" in route params, so
// "/images/..%2F..%2Fphoto" once served any .jpg the server could read: only a UUID may reach the disk.
const SCRYFALL_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isScryfallId(id: string | undefined): id is string {
  return id !== undefined && SCRYFALL_ID_PATTERN.test(id);
}

export async function serveCardImage(req: Request, res: Response): Promise<void> {
  const { scryfallId } = req.params;
  if (!isScryfallId(scryfallId)) {
    res.status(404).json({ error: "Unknown card" });
    return;
  }
  await serveImage(req, res, () => getSourceImageUri(scryfallId), scryfallId);
}

/** Serves the back face of a double-faced card; 404s for single-faced cards. */
export async function serveCardBackImage(req: Request, res: Response): Promise<void> {
  const { scryfallId } = req.params;
  if (!isScryfallId(scryfallId)) {
    res.status(404).json({ error: "Unknown card" });
    return;
  }
  await serveImage(req, res, () => getBackImageUri(scryfallId), `${scryfallId}_back`);
}
