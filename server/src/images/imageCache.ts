import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import type { Request, Response } from "express";
import { DATA_DIR } from "../db/database.js";
import { getSourceImageUri } from "../cardData/cardRepository.js";

const IMAGE_DIR = path.join(DATA_DIR, "images");
const USER_AGENT = "DraftSimulator/0.1 (personal cube draft tool; not for redistribution)";

export function ensureImageDir(): void {
  fs.mkdirSync(IMAGE_DIR, { recursive: true });
}

/**
 * Serves a card image from the local cache, downloading and caching it from
 * Scryfall on first request. Keeps the client from ever talking to Scryfall
 * directly and keeps the draft usable if the host's internet drops mid-session.
 */
export async function serveCardImage(req: Request, res: Response): Promise<void> {
  const { scryfallId } = req.params;
  const cachedPath = path.join(IMAGE_DIR, `${scryfallId}.jpg`);

  if (fs.existsSync(cachedPath)) {
    res.sendFile(cachedPath);
    return;
  }

  const sourceUri = getSourceImageUri(scryfallId);
  if (!sourceUri) {
    res.status(404).json({ error: "Unknown card" });
    return;
  }

  try {
    const upstream = await fetch(sourceUri, { headers: { "User-Agent": USER_AGENT } });
    if (!upstream.ok) {
      res.status(502).json({ error: "Failed to fetch card image from Scryfall" });
      return;
    }
    const buffer = Buffer.from(await upstream.arrayBuffer());
    await fsp.writeFile(cachedPath, buffer);
    res.type("image/jpeg").send(buffer);
  } catch (err) {
    console.error(`Failed to fetch/cache image for ${scryfallId}:`, err);
    res.status(502).json({ error: "Failed to fetch card image" });
  }
}
