import path from "node:path";
import { getAsset, getAssetKeys } from "node:sea";
import type { NextFunction, Request, Response } from "express";

/** Prefix of the asset keys the build script embeds client/dist under. */
export const CLIENT_ASSET_PREFIX = "client/";

/**
 * The executable's stand-in for express.static(client/dist): serves the
 * built client from the assets embedded at build time. Only exact asset
 * keys are served, so a request path can never reach anything else.
 */
export function serveEmbeddedClient() {
  const clientKeys = new Set(getAssetKeys().filter((key) => key.startsWith(CLIENT_ASSET_PREFIX)));

  return (req: Request, res: Response, next: NextFunction): void => {
    if (req.method !== "GET" && req.method !== "HEAD") {
      next();
      return;
    }
    const key = req.path === "/" ? `${CLIENT_ASSET_PREFIX}index.html` : `${CLIENT_ASSET_PREFIX}${req.path.slice(1)}`;
    if (!clientKeys.has(key)) {
      next();
      return;
    }
    res.type(path.extname(key));
    res.send(Buffer.from(getAsset(key)));
  };
}
