import fs from "node:fs";
import { createServer, type Server as HttpServer } from "node:http";
import path from "node:path";
import express from "express";
import cors from "cors";
import { Server } from "socket.io";
import type {
  ActionResult,
  ClientToServerEvents,
  DraftServerStatus,
  ServerSettings,
  ServerToClientEvents,
} from "@draft-simulator/shared";
import { countCards, getLastImportedAt } from "../cardData/cardRepository.js";
import { serveCardBackImage, serveCardImage } from "../images/imageCache.js";
import { serveEmbeddedClient } from "../packaged/embeddedClient.js";
import { isPackaged, resolveClientDist } from "../packaged/seaRuntime.js";
import { requireLobbyPassword } from "../realtime/lobbyPassword.js";
import { registerSocketHandlers } from "../realtime/socketHandlers.js";
import { validateSettings } from "./settingsFile.js";

export type DraftIoServer = Server<ClientToServerEvents, ServerToClientEvents>;

/** The server players connect to: the client, card images and the draft's socket traffic, all on one port. */
export function createDraftHttpServer(lobbyPassword: string | undefined): { httpServer: HttpServer; io: DraftIoServer } {
  const app = express();
  app.use(cors());
  app.use(express.json());

  app.get("/health", (_req, res) => {
    res.json({ status: "ok", cardsCached: countCards(), cardsLastImportedAt: getLastImportedAt() ?? null });
  });

  // The management page is built alongside the player client, but it's only
  // served by the management server, which only this computer can reach.
  app.use("/manage.html", (_req, res) => {
    res.sendStatus(404);
  });

  app.get("/images/:scryfallId", serveCardImage);
  app.get("/images/:scryfallId/back", serveCardBackImage);

  // Once the client is built (npm run build --workspace client), serve it
  // directly so everyone — host included — just opens this server's address
  // in a browser. In dev, the client runs separately on Vite's own port.
  // The executable carries its own copy of the built client.
  if (isPackaged) {
    app.use(serveEmbeddedClient());
  } else {
    const clientDist = resolveClientDist();
    if (fs.existsSync(clientDist)) {
      app.use(express.static(clientDist));
      app.get("/", (_req, res) => {
        res.sendFile(path.join(clientDist, "index.html"));
      });
    }
  }

  const httpServer = createServer(app);
  const io: DraftIoServer = new Server(httpServer, {
    cors: { origin: "*" },
  });

  io.use(requireLobbyPassword(lobbyPassword));
  registerSocketHandlers(io);

  return { httpServer, io };
}

export interface DraftServerState {
  status: DraftServerStatus;
  /** The settings it's running with, while it runs (or stops). */
  running?: ServerSettings;
  /** Why the last start failed, when status is "failed". */
  error?: string;
}

let state: DraftServerState = { status: "stopped" };
let current: { httpServer: HttpServer; io: DraftIoServer } | undefined;
const changeListeners = new Set<() => void>();

function notifyChange(): void {
  for (const listener of changeListeners) {
    try {
      listener();
    } catch (err) {
      console.error("A draft server listener failed:", err);
    }
  }
}

function setState(next: DraftServerState): void {
  state = next;
  notifyChange();
}

export function getDraftServerState(): DraftServerState {
  return state;
}

/** Open player connections, including browsers that haven't taken a seat yet. */
export function getPlayerConnectionCount(): number {
  return current?.io.sockets.sockets.size ?? 0;
}

/** Calls `listener` after every status change and every player connect or disconnect; returns a function that stops it. */
export function onDraftServerChange(listener: () => void): () => void {
  changeListeners.add(listener);
  return () => changeListeners.delete(listener);
}

/** What the host reads when the port can't be used: the likely cause and what to do about it, not a stack trace. */
export function buildListenErrorMessage(port: number, err: NodeJS.ErrnoException): string {
  if (err.code === "EADDRINUSE") {
    return (
      `Port ${port} is already in use. Is another copy of Draft Simulator running? ` +
      "Close it, or choose a different port in the settings."
    );
  }
  if (err.code === "EACCES") {
    return `Draft Simulator isn't allowed to use port ${port}. Choose a port above 1023 in the settings.`;
  }
  return `Couldn't start the server on port ${port}: ${err.message}`;
}

function listen(httpServer: HttpServer, port: number): Promise<void> {
  return new Promise((resolve, reject) => {
    httpServer.once("error", reject);
    httpServer.listen(port, "0.0.0.0", () => {
      httpServer.off("error", reject);
      resolve();
    });
  });
}

function fail(error: string): ActionResult {
  console.error(error);
  setState({ status: "failed", error });
  return { ok: false, error };
}

/**
 * Starts the server players connect to. Never throws: a failure, such as a
 * busy port, is logged and kept in the state for the management UI, and the
 * process keeps running so the host can pick another port there.
 */
export async function startDraftServer(settings: ServerSettings, managementPort?: number): Promise<ActionResult> {
  if (state.status !== "stopped" && state.status !== "failed") {
    return { ok: false, error: `The server is already ${state.status}.` };
  }
  const invalid = validateSettings(settings, managementPort);
  if (invalid) return fail(invalid);

  setState({ status: "starting" });
  const { httpServer, io } = createDraftHttpServer(settings.lobbyPassword || undefined);
  io.on("connection", (socket) => {
    notifyChange();
    socket.on("disconnect", () => notifyChange());
  });

  try {
    await listen(httpServer, settings.port);
  } catch (err) {
    io.close();
    return fail(buildListenErrorMessage(settings.port, err as NodeJS.ErrnoException));
  }
  // Errors after listening are rare (the port is already ours); without a
  // listener one would be an uncaught exception and end every player's draft.
  httpServer.on("error", (err) => {
    console.error("Draft server error:", err);
  });

  current = { httpServer, io };
  console.log(`Draft server is running on port ${settings.port}.`);
  setState({ status: "running", running: settings });
  return { ok: true };
}

/**
 * Stops the server and disconnects every player. The draft itself stays in
 * memory and in the snapshot, and players' browsers reconnect to it on
 * their own once the server is started again.
 */
export async function stopDraftServer(): Promise<ActionResult> {
  if (state.status !== "running" || !current) {
    return { ok: false, error: "The server isn't running." };
  }
  const { httpServer, io } = current;
  current = undefined;
  setState({ status: "stopping", running: state.running });

  await new Promise<void>((resolve) => {
    io.close(() => resolve());
    // close() waits for every open HTTP connection to end, and a browser can
    // hold a keep-alive connection open for minutes.
    httpServer.closeAllConnections();
  });
  console.log("Draft server stopped.");
  setState({ status: "stopped" });
  return { ok: true };
}
