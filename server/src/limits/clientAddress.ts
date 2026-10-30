import type { IncomingHttpHeaders } from "node:http";

function isLoopbackAddress(address: string): boolean {
  return address === "::1" || address.startsWith("127.") || address.startsWith("::ffff:127.");
}

/**
 * The address a player connects from, which the rate limits count against. X-Forwarded-For is only believed on a
 * connection from this computer: a reverse proxy running here (Caddy, nginx) passes the player's address in it, and
 * no one else can make a connection come from here. Its last entry is the one that proxy added; earlier ones came
 * from the client and could be anything. Behind a proxy on another machine, every player shares that machine's
 * address.
 */
export function clientAddress(remoteAddress: string | undefined, headers: IncomingHttpHeaders): string {
  const remote = remoteAddress ?? "unknown";
  const forwardedFor = headers["x-forwarded-for"];
  if (!isLoopbackAddress(remote) || forwardedFor === undefined) return remote;
  const header = Array.isArray(forwardedFor) ? forwardedFor.join(",") : forwardedFor;
  return (
    header
      .split(",")
      .map((entry) => entry.trim())
      .filter((entry) => entry !== "")
      .at(-1) ?? remote
  );
}
