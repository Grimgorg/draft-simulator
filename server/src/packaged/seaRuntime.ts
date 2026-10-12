import path from "node:path";
import { isSea } from "node:sea";

/** True when running as the packaged single executable rather than from a checkout. */
export const isPackaged = isSea();

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
