/**
 * What `npm run dev:desktop` runs before opening its window (Tauri's
 * beforeDevCommand, which runs a single command): the server and the
 * client's Vite dev server, both with reload. The dev window loads the
 * management UI from Vite, which talks to the server on :4001. Stops both
 * when Tauri stops it, or when either one exits.
 *
 * Node runs this .ts file directly (type stripping, Node 22.18+).
 */
import { spawn } from "node:child_process";
import path from "node:path";

const ROOT = path.join(import.meta.dirname, "../..");

// npm is a .cmd script on Windows, which only starts through a shell.
const children = ["dev:server", "dev:client"].map((script) =>
  spawn("npm", ["run", script], { cwd: ROOT, stdio: "inherit", shell: process.platform === "win32" }),
);

function stopAll(exitCode: number): void {
  for (const child of children) {
    if (child.exitCode === null) child.kill();
  }
  process.exit(exitCode);
}

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => stopAll(0));
}
for (const child of children) {
  child.on("exit", (code) => stopAll(code ?? 1));
}
