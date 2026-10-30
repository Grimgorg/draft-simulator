import { randomUUID } from "node:crypto";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import type { Request, Response } from "express";
import { DATA_DIR } from "../db/database.js";
import { getBackImageUri, getSourceImageUri } from "../cardData/cardRepository.js";

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
 * Serves one card image from the local cache (keyed by `cacheKey`),
 * downloading and caching it from `sourceUri` on first request. Keeps the
 * client from ever talking to Scryfall directly and keeps the draft usable
 * if the host's internet drops mid-session.
 */
async function serveImage(res: Response, lookupSourceUri: () => string | undefined, cacheKey: string): Promise<void> {
  const cachedPath = path.join(imageDir, `${cacheKey}.jpg`);

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
  await serveImage(res, () => getSourceImageUri(scryfallId), scryfallId);
}

/** Serves the back face of a double-faced card; 404s for single-faced cards. */
export async function serveCardBackImage(req: Request, res: Response): Promise<void> {
  const { scryfallId } = req.params;
  if (!isScryfallId(scryfallId)) {
    res.status(404).json({ error: "Unknown card" });
    return;
  }
  await serveImage(res, () => getBackImageUri(scryfallId), `${scryfallId}_back`);
}
