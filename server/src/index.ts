import fs from "node:fs";
import { createServer } from "node:http";
import path from "node:path";
import express from "express";
import cors from "cors";
import { Server } from "socket.io";
import type { ClientToServerEvents, ServerToClientEvents } from "@draft-simulator/shared";
import { getDb } from "./db/database.js";
import { countCards, getLastImportedAt } from "./cardData/cardRepository.js";
import { refreshCardDatabaseIfStale } from "./cardData/cardDatabaseFreshness.js";
import { ensureImageDir, serveCardBackImage, serveCardImage } from "./images/imageCache.js";
import { requireLobbyPassword } from "./realtime/lobbyPassword.js";
import { registerSocketHandlers } from "./realtime/socketHandlers.js";

const PORT = Number(process.env.PORT ?? 4000);

// Node's default for an unhandled rejection is to kill the process, which
// for a host running a live draft means everyone is stuck until a restart.
// Every known async path handles its own errors; this is the backstop so a
// missed one gets logged instead of taking the draft down.
process.on("unhandledRejection", (reason) => {
  console.error("Unhandled promise rejection (server kept running):", reason);
});

getDb();
ensureImageDir();

// An empty cache means the app can't resolve any cube at all, so block
// startup on the first import. Otherwise — just stale — refresh in the
// background so the host isn't stuck waiting right before a draft.
if (countCards() === 0) {
  await refreshCardDatabaseIfStale();
} else {
  refreshCardDatabaseIfStale();
}

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

io.use(requireLobbyPassword(process.env.LOBBY_PASSWORD));
registerSocketHandlers(io);

httpServer.listen(PORT, "0.0.0.0", () => {
  console.log(`Draft Simulator server listening on http://0.0.0.0:${PORT}`);
});
