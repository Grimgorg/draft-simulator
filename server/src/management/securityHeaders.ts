import type { RequestHandler } from "express";

/**
 * The player page's Content-Security-Policy. Everything it loads comes from this server, card images included
 * (through /images), so nothing else is allowed: if a cube or player name ever got turned into markup, the policy
 * still keeps it from running a script or sending anything elsewhere. frame-ancestors stops other sites from showing
 * the page in a frame and tricking players into clicks on it.
 */
export const PLAYER_PAGE_POLICY = [
  "default-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join("; ");

/**
 * The management page only gets frame-ancestors: framed by a website the host visits, its buttons could be clicked
 * through a disguise. The desktop app's window shows this page and adds its own scripts to it; a script policy here
 * hasn't been tried there.
 */
export const MANAGEMENT_PAGE_POLICY = "frame-ancestors 'none'";

/** Headers for every response of a server; `policy` is its Content-Security-Policy. */
export function securityHeaders(policy: string): RequestHandler {
  return (_req, res, next) => {
    res.setHeader("Content-Security-Policy", policy);
    // For browsers without frame-ancestors.
    res.setHeader("X-Frame-Options", "DENY");
    // Files are only ever what their Content-Type says, so a browser can't run one as a script.
    res.setHeader("X-Content-Type-Options", "nosniff");
    // Links out don't tell other sites the server's address.
    res.setHeader("Referrer-Policy", "no-referrer");
    next();
  };
}
