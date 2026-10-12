import { spawn } from "node:child_process";
import { once } from "node:events";
import fs from "node:fs";
import { createServer } from "node:http";
import { createServer as createNetServer, type AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { test as base, expect, type Page } from "@playwright/test";

export { expect };

export const CUBE_ID = "e2e-cube";
export const CUBE_NAME = "E2E Test Cube";
/** Real card names, so the server resolves them against the local card cache like any cube. */
export const CUBE_CARDS = [
  "Lightning Bolt",
  "Counterspell",
  "Llanowar Elves",
  "Swords to Plowshares",
  "Dark Ritual",
  "Giant Growth",
  "Serra Angel",
  "Shivan Dragon",
];

const SERVER_ENTRY = path.join(import.meta.dirname, "../server/dist/index.js");

interface RunningServer {
  url: string;
  close: () => Promise<void>;
}

interface DraftServer extends RunningServer {
  output: () => string;
}

/** Stands in for CubeCobra's cube JSON endpoint, so the tests never depend on cubecobra.com. */
async function startFakeCubeCobra(): Promise<RunningServer> {
  const server = createServer((req, res) => {
    if (req.url !== `/cube/api/cubeJSON/${CUBE_ID}`) {
      res.writeHead(404).end();
      return;
    }
    const mainboard = CUBE_CARDS.map((name) => ({ details: { name } }));
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ name: CUBE_NAME, cards: { mainboard } }));
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}`,
    close: () => new Promise((resolve) => server.close(() => resolve())),
  };
}

async function freePort(): Promise<number> {
  const probe = createNetServer().listen(0, "127.0.0.1");
  await once(probe, "listening");
  const { port } = probe.address() as AddressInfo;
  await new Promise((resolve) => probe.close(resolve));
  return port;
}

/**
 * Runs the built server as its own process, on its own port and snapshot file,
 * so every test starts from an empty server. It's started directly rather
 * than through `npm start`, which would load server/.env and its lobby password.
 */
async function startDraftServer(cubeCobraUrl: string): Promise<DraftServer> {
  const port = await freePort();
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "draft-simulator-e2e-"));
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    PORT: String(port),
    CUBECOBRA_BASE_URL: cubeCobraUrl,
    DRAFT_SNAPSHOT_PATH: path.join(tmpDir, "draft-session.json"),
    // Never start a background card cache refresh (a large download) mid-test.
    CARD_CACHE_MAX_AGE_DAYS: "36500",
  };
  delete env.LOBBY_PASSWORD;

  const child = spawn(process.execPath, [SERVER_ENTRY], { env, stdio: ["ignore", "pipe", "pipe"] });
  let output = "";
  child.stdout.on("data", (chunk) => (output += chunk));
  child.stderr.on("data", (chunk) => (output += chunk));
  const exited = once(child, "exit");

  const url = `http://127.0.0.1:${port}`;
  const deadline = Date.now() + 20_000;
  for (;;) {
    if (child.exitCode !== null) throw new Error(`The draft server exited during startup:\n${output}`);
    if (Date.now() > deadline) {
      child.kill();
      throw new Error(`The draft server didn't answer /health within 20s:\n${output}`);
    }
    try {
      if ((await fetch(`${url}/health`)).ok) break;
    } catch {
      // Not listening yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  return {
    url,
    output: () => output,
    close: async () => {
      if (child.exitCode === null) child.kill();
      await exited;
      fs.rmSync(tmpDir, { recursive: true, force: true });
    },
  };
}

interface Fixtures {
  draftServer: DraftServer;
  /** Opens the app in a fresh browser context: a separate player with their own localStorage. */
  openPlayer: () => Promise<Page>;
}

export const test = base.extend<Fixtures>({
  draftServer: async ({}, use, testInfo) => {
    const cubeCobra = await startFakeCubeCobra();
    const server = await startDraftServer(cubeCobra.url);
    try {
      await use(server);
    } finally {
      await server.close();
      await cubeCobra.close();
      if (testInfo.status !== testInfo.expectedStatus) {
        await testInfo.attach("server-output.txt", { body: server.output(), contentType: "text/plain" });
      }
    }
  },
  openPlayer: async ({ browser, draftServer }, use) => {
    const contexts: Awaited<ReturnType<typeof browser.newContext>>[] = [];
    await use(async () => {
      const context = await browser.newContext({ baseURL: draftServer.url });
      contexts.push(context);
      const page = await context.newPage();
      await page.goto("/");
      return page;
    });
    for (const context of contexts) await context.close();
  },
});
