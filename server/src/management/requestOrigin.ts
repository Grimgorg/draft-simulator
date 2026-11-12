import type { IncomingHttpHeaders } from "node:http";

const LOOPBACK_HOSTNAMES = new Set(["localhost", "127.0.0.1", "[::1]"]);
/** `npm run dev:client` serves the player page from Vite's port, not the draft server's. */
const VITE_DEV_PORT = "5173";

export function isLoopbackUrl(url: string): boolean {
  try {
    return LOOPBACK_HOSTNAMES.has(new URL(url).hostname);
  } catch {
    return false;
  }
}

/** Whether `origin` is the player page that `npm run dev:client` serves on this computer. */
export function isViteDevOrigin(origin: string): boolean {
  // isLoopbackUrl parsed it already, so URL can't throw here.
  return isLoopbackUrl(origin) && new URL(origin).port === VITE_DEV_PORT;
}

/**
 * Whether a player socket may connect. Browsers send an Origin, and only the player page itself, served by this
 * same server, may open one: without the check any website a player visited could open a socket to the server from
 * their browser and create drafts or take seats. Socket.IO's cors option doesn't cover WebSocket connections, so
 * this runs as allowRequest, on every request.
 *
 * The page's address is the Host the browser sent, or X-Forwarded-Host when a reverse proxy rewrites Host. A web
 * page can't set either on a request to another site: Host never, and X-Forwarded-Host only with a CORS preflight,
 * which the draft server refuses for other origins. Requests without an Origin don't come from a web page; keeping
 * those out is the lobby password's job.
 */
export function isAllowedPlayerRequest(headers: IncomingHttpHeaders, allowViteDevServer: boolean): boolean {
  const origin = headers.origin;
  if (origin === undefined) return true;
  let originHost: string;
  try {
    originHost = new URL(origin).host;
  } catch {
    return false;
  }
  const pageHosts = [headers.host ?? "", ...String(headers["x-forwarded-host"] ?? "").split(",")]
    .map((host) => host.trim().toLowerCase())
    .filter((host) => host !== "");
  if (pageHosts.includes(originHost.toLowerCase())) return true;
  return allowViteDevServer && isViteDevOrigin(origin);
}
