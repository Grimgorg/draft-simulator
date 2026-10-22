import fs from "node:fs";
import { createServer, type Server as HttpServer } from "node:http";
import path from "node:path";
import express from "express";
import cors from "cors";
import { Server } from "socket.io";
import type { ClientToServerEvents, ServerToClientEvents } from "@draft-simulator/shared";
import { countCards, getLastImportedAt } from "../cardData/cardRepository.js";
import { serveCardBackImage, serveCardImage } from "../images/imageCache.js";
import { serveEmbeddedClient } from "../packaged/embeddedClient.js";
import { isPackaged, resolveClientDist } from "../packaged/seaRuntime.js";
import { requireLobbyPassword } from "../realtime/lobbyPassword.js";
import { registerSocketHandlers } from "../realtime/socketHandlers.js";

export type DraftIoServer = Server<ClientToServerEvents, ServerToClientEvents>;

/** The server players connect to: the client, card images and the draft's socket traffic, all on one port. */
export function createDraftHttpServer(lobbyPassword: string | undefined): { httpServer: HttpServer; io: DraftIoServer } {
  const app = express();
  app.use(cors());
  app.use(express.json());

  app.get("/health", (_req, res) => {
    res.json({ status: "ok", cardsCached: countCards(), cardsLastImportedAt: getLastImportedAt() ?? null });
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
