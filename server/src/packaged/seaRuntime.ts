import fs from "node:fs";
import path from "node:path";
import { getAsset, isSea } from "node:sea";

/** True when running as the packaged single executable rather than from a checkout. */
export const isPackaged = isSea();

/** Asset key the build script embeds better-sqlite3's native addon under. */
export const SQLITE_ADDON_ASSET = "better_sqlite3.node";

// The executable runs a CommonJS bundle, where import.meta.dirname is
// undefined — so it's only read on the checkout path, never when packaged.

/** Where the card DB, image cache and draft snapshot live: next to the executable when packaged. */
export function resolveDataDir(): string {
  return isPackaged ? path.join(path.dirname(process.execPath), "data") : path.join(import.meta.dirname, "../../data");
}

/** The built client in a checkout. The executable serves its embedded copy instead. */
export function resolveClientDist(): string {
  return path.join(import.meta.dirname, "../../../client/dist");
}

/** The .env the host edits to change settings: next to the executable, or server/.env for `npm start`. */
export function resolveEnvFilePath(): string {
  return isPackaged ? path.join(path.dirname(process.execPath), ".env") : path.resolve(".env");
}

/**
 * The executable can't load a native addon from inside itself, and its
 * require() only resolves built-in modules. So the embedded addon is written
 * to the data dir and loaded by path — rewritten only when a new build
 * brings a different one, since Windows refuses to overwrite a loaded file.
 */
export function loadEmbeddedSqliteAddon(dataDir: string): object {
  const addonBytes = Buffer.from(getAsset(SQLITE_ADDON_ASSET));
  const addonPath = path.join(dataDir, "native", SQLITE_ADDON_ASSET);
  if (!fs.existsSync(addonPath) || !fs.readFileSync(addonPath).equals(addonBytes)) {
    fs.mkdirSync(path.dirname(addonPath), { recursive: true });
    fs.writeFileSync(addonPath, addonBytes);
  }
  const addonModule = { exports: {} };
  process.dlopen(addonModule, addonPath);
  return addonModule.exports;
}

/**
 * Exits after a fatal error. A host who double-clicked the executable on
 * Windows would otherwise see the console window vanish before they could
 * read why, so it stays open until they press Enter.
 */
export function exitAfterFatalError(): void {
  if (isPackaged && process.stdin.isTTY) {
    console.error("Press Enter to close this window.");
    process.stdin.once("data", () => process.exit(1));
    process.stdin.resume();
  } else {
    process.exit(1);
  }
}
