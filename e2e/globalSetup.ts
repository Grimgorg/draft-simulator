import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const ROOT = path.join(import.meta.dirname, "..");

/**
 * The tests drive the production build — the server serving the built client,
 * as `npm start` does — so build it fresh rather than test a stale dist.
 */
export default function globalSetup(): void {
  if (!fs.existsSync(path.join(ROOT, "server/data/cards.sqlite3"))) {
    throw new Error(
      "The browser tests resolve their test cube against the local card cache. " +
        "Run `npm run import-cards --workspace server` first."
    );
  }
  for (const workspace of ["shared", "server", "client"]) {
    execSync(`npm run build --workspace ${workspace}`, { cwd: ROOT, stdio: "inherit" });
  }
}
