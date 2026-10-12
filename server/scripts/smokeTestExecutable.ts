/**
 * Starts a built executable in an empty folder and checks the parts that only
 * exist when packaged: the embedded SQLite addon, the embedded client, the
 * data dir and the example .env next to the executable.
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
fs.mkdirSync(path.join(workDir, "data"));
fs.copyFileSync(path.resolve(invokedFrom, cardDbArg), path.join(workDir, "data/cards.sqlite3"));

const probe = createServer().listen(0, "127.0.0.1");
await once(probe, "listening");
const { port } = probe.address() as AddressInfo;
await new Promise((resolve) => probe.close(resolve));

const env: NodeJS.ProcessEnv = { ...process.env, PORT: String(port), CARD_CACHE_MAX_AGE_DAYS: "36500" };
delete env.LOBBY_PASSWORD;
const child = spawn(executable, [], { cwd: workDir, env, stdio: ["ignore", "pipe", "pipe"] });
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

  check(fs.existsSync(path.join(workDir, ".env")), "No example .env was created next to the executable.");
  check(output.includes(`running on port ${port}`), "The startup banner wasn't printed.");

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
