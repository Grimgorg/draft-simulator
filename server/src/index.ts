import fs from "node:fs";
import { createServer } from "node:http";
import path from "node:path";
import express from "express";
import cors from "cors";
import { Server } from "socket.io";
import type { ClientToServerEvents, ServerToClientEvents } from "@draft-simulator/shared";
import { getDb } from "./db/database.js";
import { countCards } from "./cardData/cardRepository.js";
import { ensureImageDir, serveCardImage } from "./images/imageCache.js";
import { registerSocketHandlers } from "./realtime/socketHandlers.js";

const PORT = Number(process.env.PORT ?? 4000);

getDb();
ensureImageDir();

const app = express();
app.use(cors());
app.use(express.json());

app.get("/health", (_req, res) => {
  res.json({ status: "ok", cardsCached: countCards() });
});

app.get("/images/:scryfallId", serveCardImage);

// Once the client is built (npm run build --workspace client), serve it
// directly so everyone — host included — just opens this server's address
// in a browser. In dev, the client runs separately on Vite's own port.
const clientDist = path.join(import.meta.dirname, "../../client/dist");
if (fs.existsSync(clientDist)) {
  app.use(express.static(clientDist));
  app.get("/", (_req, res) => {
    res.sendFile(path.join(clientDist, "index.html"));
  });
}

const httpServer = createServer(app);
const io = new Server<ClientToServerEvents, ServerToClientEvents>(httpServer, {
  cors: { origin: "*" },
});

registerSocketHandlers(io);

httpServer.listen(PORT, "0.0.0.0", () => {
  console.log(`Draft Simulator server listening on http://0.0.0.0:${PORT}`);
});
