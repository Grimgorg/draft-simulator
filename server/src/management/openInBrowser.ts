import { spawn } from "node:child_process";
import type { ActionResult } from "@draft-simulator/shared";

interface OpenCommand {
  command: string;
  args: string[];
}

// Each OS's own opener rather than the `open` package: on Linux that runs an
// xdg-open script it ships as a file, which the executable can't load.
function buildOpenCommand(url: string, platform: NodeJS.Platform): OpenCommand {
  if (platform === "darwin") return { command: "open", args: [url] };
  // The empty argument is start's window title; without it a quoted URL would be taken as the title.
  if (platform === "win32") return { command: "cmd", args: ["/c", "start", "", url] };
  return { command: "xdg-open", args: [url] };
}

/** Runs the opener without waiting for it, and reports whether it could be started. */
export function runOpenCommand({ command, args }: OpenCommand): Promise<ActionResult> {
  return new Promise((resolve) => {
    try {
      const child = spawn(command, args, { detached: true, stdio: "ignore", windowsHide: true });
      // Without an error listener, a missing opener (no xdg-open on a bare Linux
      // desktop) is an uncaught exception that ends every player's draft.
      child.once("error", (err) => resolve({ ok: false, error: `Couldn't open the browser: ${err.message}` }));
      child.once("spawn", () => {
        child.unref();
        resolve({ ok: true });
      });
    } catch (err) {
      resolve({ ok: false, error: `Couldn't open the browser: ${err instanceof Error ? err.message : String(err)}` });
    }
  });
}

/** Opens the URL in the default browser. Only pass URLs the server built itself: they go to a shell on Windows. */
export function openInBrowser(url: string): Promise<ActionResult> {
  return runOpenCommand(buildOpenCommand(url, process.platform));
}
