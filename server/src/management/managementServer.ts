import fs from "node:fs";
import { createServer, type IncomingHttpHeaders } from "node:http";
import type { AddressInfo } from "node:net";
import path from "node:path";
import express from "express";
import { Server } from "socket.io";
import {
  REPOSITORY_URL,
  type ActionResult,
  type BrowserTarget,
  type ManagementClientToServerEvents,
  type ManagementServerToClientEvents,
  type ServerSettings,
} from "@draft-simulator/shared";
import { countCards, getLastImportedAt } from "../cardData/cardRepository.js";
import { serveEmbeddedClient } from "../packaged/embeddedClient.js";
import { isPackaged, resolveClientDist } from "../packaged/seaRuntime.js";
import * as lobbyManager from "../session/lobbyManager.js";
import { buildLobbyStateView } from "../session/lobbyStateView.js";
import {
  getDraftServerState,
  getPlayerConnectionCount,
  onDraftServerChange,
  startDraftServer,
  stopDraftServer,
} from "./draftServer.js";
import { getLogHistory, onLog } from "./logBuffer.js";
import { buildManagementStateView, listLanAddresses } from "./managementStateView.js";
import { openInBrowser } from "./openInBrowser.js";
import { validateSettings, writeSettings } from "./settingsFile.js";

type ManagementIoServer = Server<ManagementClientToServerEvents, ManagementServerToClientEvents>;

export interface ManagementServerOptions {
  /** 0 picks any free port. */
  port: number;
  envFilePath: string;
  /** The settings saved in the .env file when the app started. */
  savedSettings: ServerSettings;
  isCardDatabaseRefreshing: () => boolean;
  /** Opens a URL in the default browser. Tests pass a fake, so they don't open real browser windows. */
  openInBrowser?: (url: string) => Promise<ActionResult>;
}

export interface ManagementServer {
  /** Where the management UI is, e.g. http://127.0.0.1:4001/ */
  url: string;
  /** Starts the draft server with the saved settings. */
  startDraftServer: () => Promise<ActionResult>;
  /** Sends the current state to the management UI, for changes it isn't told about otherwise. */
  broadcastState: () => void;
  close: () => Promise<void>;
}

const LOOPBACK_HOSTNAMES = new Set(["localhost", "127.0.0.1", "[::1]"]);

function isLoopbackUrl(url: string): boolean {
  try {
    return LOOPBACK_HOSTNAMES.has(new URL(url).hostname);
  } catch {
    return false;
  }
}

/**
 * The management server only listens on 127.0.0.1, but a website open in the
 * host's browser can still send requests to it, and DNS rebinding can make
 * them look same-origin. Both carry the attacker's name in Host or Origin,
 * so only loopback names are let through. Requests without an Origin don't
 * come from a web page.
 */
export function isAllowedManagementRequest(headers: IncomingHttpHeaders): boolean {
  if (!headers.host || !isLoopbackUrl(`http://${headers.host}`)) return false;
  return headers.origin === undefined || isLoopbackUrl(headers.origin);
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * Serves the management UI and handles its socket traffic: the host's
 * controls for the draft server, its settings and its logs. The only code
 * that emits manage:* events.
 */
export async function startManagementServer(options: ManagementServerOptions): Promise<ManagementServer> {
  let savedSettings = options.savedSettings;
  /** Known once listening: options.port can be 0. */
  let managementPort = options.port;

  function startWithSavedSettings(): Promise<ActionResult> {
    return startDraftServer(savedSettings, managementPort);
  }

  const app = express();
  app.use((req, res, next) => {
    if (isAllowedManagementRequest(req.headers)) next();
    else res.sendStatus(403);
  });
  app.get("/", (_req, res) => {
    res.redirect("/manage.html");
  });
  // The player client is built alongside this page; only its page is kept out.
  app.use("/index.html", (_req, res) => {
    res.sendStatus(404);
  });
  if (isPackaged) {
    app.use(serveEmbeddedClient());
  } else {
    const clientDist = resolveClientDist();
    if (fs.existsSync(path.join(clientDist, "manage.html"))) {
      app.use(express.static(clientDist, { index: false }));
    } else {
      app.get("/manage.html", (_req, res) => {
        res
          .status(404)
          .type("text")
          .send(
            "The management UI isn't built yet. Run `npm run build --workspace client`, " +
              "or open http://localhost:5173/manage.html while `npm run dev:client` runs.",
          );
      });
    }
  }

  const httpServer = createServer(app);
  const io: ManagementIoServer = new Server(httpServer, {
    allowRequest: (req, callback) => callback(null, isAllowedManagementRequest(req.headers)),
    // In dev the page comes from Vite's port, so it's cross-origin here.
    cors: { origin: (origin, callback) => callback(null, origin === undefined || isLoopbackUrl(origin)) },
  });

  function buildState() {
    return buildManagementStateView({
      server: getDraftServerState(),
      savedSettings,
      envFilePath: options.envFilePath,
      lanAddresses: listLanAddresses(),
      playerConnections: getPlayerConnectionCount(),
      cardDatabase: {
        cardCount: countCards(),
        lastImportedAt: getLastImportedAt() ?? null,
        refreshing: options.isCardDatabaseRefreshing(),
      },
      lobby: buildLobbyStateView(),
    });
  }

  function broadcastState(): void {
    io.emit("manage:state", buildState());
  }

  /** Only URLs built here reach the opener, which hands them to a shell on Windows. */
  function openTarget(target: BrowserTarget): Promise<ActionResult> {
    const open = options.openInBrowser ?? openInBrowser;
    if (target === "repository") return open(REPOSITORY_URL);
    if (target === "playerPage") {
      const { status, running } = getDraftServerState();
      if (status !== "running" || !running) return Promise.resolve({ ok: false, error: "Start the server first." });
      return open(`http://localhost:${running.port}`);
    }
    return Promise.resolve({ ok: false, error: `Unknown target: ${String(target)}` });
  }

  async function restart(): Promise<ActionResult> {
    if (getDraftServerState().status === "running") {
      const stopped = await stopDraftServer();
      if (!stopped.ok) return stopped;
    }
    return startWithSavedSettings();
  }

  // Every handler reports through its callback and never throws: an uncaught
  // error would end the process, and every player's draft with it.
  io.on("connection", (socket) => {
    try {
      socket.emit("manage:logHistory", getLogHistory());
      socket.emit("manage:state", buildState());
    } catch (err) {
      console.error("Couldn't send the management UI its first state:", err);
    }

    socket.on("manage:startServer", async (callback) => {
      try {
        callback(await startWithSavedSettings());
      } catch (err) {
        callback({ ok: false, error: errorMessage(err) });
      }
    });

    socket.on("manage:stopServer", async (callback) => {
      try {
        callback(await stopDraftServer());
      } catch (err) {
        callback({ ok: false, error: errorMessage(err) });
      }
    });

    socket.on("manage:restartServer", async (callback) => {
      try {
        callback(await restart());
      } catch (err) {
        callback({ ok: false, error: errorMessage(err) });
      }
    });

    socket.on("manage:openInBrowser", async (target, callback) => {
      try {
        callback(await openTarget(target));
      } catch (err) {
        callback({ ok: false, error: errorMessage(err) });
      }
    });

    socket.on("manage:saveSettings", (payload, callback) => {
      try {
        const settings: ServerSettings = { port: Number(payload.port), lobbyPassword: String(payload.lobbyPassword).trim() };
        const invalid = validateSettings(settings, managementPort);
        if (invalid) {
          callback({ ok: false, error: invalid });
          return;
        }
        writeSettings(options.envFilePath, settings);
        savedSettings = settings;
        console.log(`Settings saved to ${options.envFilePath}.`);
        callback({ ok: true });
        broadcastState();
      } catch (err) {
        console.error(`Couldn't save the settings to ${options.envFilePath}:`, err);
        callback({ ok: false, error: `Couldn't save the settings to ${options.envFilePath}: ${errorMessage(err)}` });
      }
    });
  });

  const stopListening = [
    lobbyManager.onStateChange(broadcastState),
    onDraftServerChange(broadcastState),
    onLog((entry) => io.emit("manage:log", entry)),
  ];

  try {
    await new Promise<void>((resolve, reject) => {
      httpServer.once("error", reject);
      httpServer.listen(options.port, "127.0.0.1", () => {
        httpServer.off("error", reject);
        resolve();
      });
    });
  } catch (err) {
    for (const stop of stopListening) stop();
    io.close();
    if ((err as NodeJS.ErrnoException).code === "EADDRINUSE") {
      throw new Error(
        `Port ${options.port} for the management UI is already in use. Is another copy of Draft Simulator ` +
          "running? Close it, or set MANAGEMENT_PORT to a different port.",
      );
    }
    throw err;
  }
  httpServer.on("error", (err) => {
    console.error("Management server error:", err);
  });

  managementPort = (httpServer.address() as AddressInfo).port;
  return {
    url: `http://127.0.0.1:${managementPort}/`,
    startDraftServer: startWithSavedSettings,
    broadcastState,
    close: () =>
      new Promise<void>((resolve) => {
        for (const stop of stopListening) stop();
        io.close(() => resolve());
        httpServer.closeAllConnections();
      }),
  };
}
