/**
 * Starts a built executable in an empty folder, the way the desktop app runs
 * it, and checks the parts that only exist when packaged: the embedded SQLite
 * addon, the embedded client and management UI, the data dir and example
 * .env in DRAFT_SIMULATOR_HOME, the "Management UI:" line the app reads, and
 * that the server exits once the app's end of its stdin closes.
 *
 * Run with: npm run smoke-test-exe --workspace server -- <executable> <cards.sqlite3>
 * The card DB is copied in so the executable doesn't download its own.
 */
import { spawn } from "node:child_process";
import { once } from "node:events";
import fs from "node:fs";
import { createServer, type AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";

const [executableArg, cardDbArg] = process.argv.slice(2);
if (!executableArg || !cardDbArg) {
  console.error("Usage: smokeTestExecutable.ts <executable> <cards.sqlite3>");
  process.exit(1);
}

// npm runs workspace scripts from server/; INIT_CWD is where it was invoked.
const invokedFrom = process.env.INIT_CWD ?? process.cwd();
const workDir = fs.mkdtempSync(path.join(os.tmpdir(), "draft-simulator-smoke-"));
const executable = path.join(workDir, path.basename(executableArg));
fs.copyFileSync(path.resolve(invokedFrom, executableArg), executable);
fs.chmodSync(executable, 0o755);
// Apart from the executable, as the desktop app's per-user app data folder is.
const homeDir = path.join(workDir, "home");
fs.mkdirSync(path.join(homeDir, "data"), { recursive: true });
fs.copyFileSync(path.resolve(invokedFrom, cardDbArg), path.join(homeDir, "data/cards.sqlite3"));

async function freePort(): Promise<number> {
  const probe = createServer().listen(0, "127.0.0.1");
  await once(probe, "listening");
  const { port } = probe.address() as AddressInfo;
  await new Promise((resolve) => probe.close(resolve));
  return port;
}

const port = await freePort();

const env: NodeJS.ProcessEnv = {
  ...process.env,
  PORT: String(port),
  // What the desktop app passes (desktop/src-tauri/src/main.rs).
  MANAGEMENT_PORT: "0",
  DRAFT_SIMULATOR_HOME: homeDir,
  DRAFT_SIMULATOR_MANAGED: "1",
  CARD_CACHE_MAX_AGE_DAYS: "36500",
};
delete env.LOBBY_PASSWORD;
const child = spawn(executable, [], { cwd: workDir, env, stdio: ["pipe", "pipe", "pipe"] });
let output = "";
child.stdout.on("data", (chunk) => (output += chunk));
child.stderr.on("data", (chunk) => (output += chunk));

const baseUrl = `http://127.0.0.1:${port}`;

function check(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function waitForHealth(): Promise<{ cardsCached: number }> {
  const deadline = Date.now() + 60_000;
  for (;;) {
    check(child.exitCode === null, `The executable exited during startup (code ${child.exitCode}).`);
    check(Date.now() < deadline, "The executable didn't answer /health within 60s.");
    try {
      const res = await fetch(`${baseUrl}/health`);
      if (res.ok) return (await res.json()) as { cardsCached: number };
    } catch {
      // Not listening yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
}

try {
  const health = await waitForHealth();
  check(health.cardsCached > 0, `The executable reports ${health.cardsCached} cached cards; the SQLite addon or data dir is broken.`);

  const index = await fetch(`${baseUrl}/`);
  const html = await index.text();
  check(index.ok && html.includes('<div id="root">'), `GET / didn't return the client's index.html (status ${index.status}).`);

  const scriptPath = html.match(/src="(\/assets\/[^"]+\.js)"/)?.[1];
  check(scriptPath, "index.html doesn't reference a script under /assets/.");
  const script = await fetch(`${baseUrl}${scriptPath}`);
  check(
    script.ok && script.headers.get("content-type")?.includes("javascript"),
    `GET ${scriptPath} returned ${script.status} ${script.headers.get("content-type")}.`,
  );

  const unknownCard = await fetch(`${baseUrl}/images/not-a-card`);
  check(unknownCard.status === 404, `GET /images/not-a-card returned ${unknownCard.status} instead of 404.`);

  const playerManagePage = await fetch(`${baseUrl}/manage.html`);
  check(playerManagePage.status === 404, `The player port serves the management UI (status ${playerManagePage.status}).`);

  const managementUrl = output.match(/^Management UI: (http:\/\/127\.0\.0\.1:\d+\/)$/m)?.[1];
  check(managementUrl, "The management UI's address wasn't printed in the form the desktop app reads.");
  const managePage = await fetch(managementUrl);
  const manageHtml = await managePage.text();
  check(
    managePage.ok && managePage.url.endsWith("/manage.html") && manageHtml.includes('<div id="root">'),
    `The management port didn't serve the embedded manage.html (status ${managePage.status}, ${managePage.url}).`,
  );

  check(fs.existsSync(path.join(homeDir, ".env")), "No example .env was created in DRAFT_SIMULATOR_HOME.");
  check(!fs.existsSync(path.join(workDir, ".env")), "A .env was created next to the executable, not in DRAFT_SIMULATOR_HOME.");
  check(!fs.existsSync(path.join(workDir, "data")), "A data dir was created next to the executable, not in DRAFT_SIMULATOR_HOME.");
  check(output.includes(`running on port ${port}`), "The draft server didn't log that it's running.");

  // What happens when the desktop app crashes: its end of the pipe closes.
  const exited = once(child, "exit");
  child.stdin.end();
  const timeout = new Promise((resolve) => setTimeout(resolve, 10_000, "timeout"));
  check((await Promise.race([exited, timeout])) !== "timeout", "The executable kept running after its stdin closed.");

  console.log(`Smoke test passed for ${path.basename(executableArg)}.`);
} catch (err) {
  console.error(`Smoke test failed: ${(err as Error).message}\n--- executable output ---\n${output}`);
  process.exitCode = 1;
} finally {
  if (child.exitCode === null) {
    child.kill();
    await once(child, "exit");
  }
  // Windows can hold the files briefly after the process exits; a leftover temp dir isn't worth failing over.
  try {
    fs.rmSync(workDir, { recursive: true, force: true, maxRetries: 5 });
  } catch (err) {
    console.warn(`Couldn't remove ${workDir}:`, err);
  }
}
