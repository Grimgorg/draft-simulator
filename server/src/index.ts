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
import { ensureImageDir, serveCardImage } from "./images/imageCache.js";
import { registerSocketHandlers } from "./realtime/socketHandlers.js";

const PORT = Number(process.env.PORT ?? 4000);

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

// Optional password gate for the whole site (HTTP Basic Auth), for when the
// server is exposed beyond a trusted LAN. Unset by default — no password
// required. Distinct from LOBBY_PASSWORD below, which only gates the draft
// socket connection; this gates every HTTP request, including the page and
// static assets.
const SITE_PASSWORD = process.env.SITE_PASSWORD;
if (SITE_PASSWORD) {
  app.use((req, res, next) => {
    const [scheme, encoded] = req.headers.authorization?.split(" ") ?? [];
    const password =
      scheme === "Basic" && encoded ? Buffer.from(encoded, "base64").toString("utf8").split(":")[1] : undefined;
    if (password === SITE_PASSWORD) {
      next();
    } else {
      res.set("WWW-Authenticate", 'Basic realm="Draft Simulator"');
      res.status(401).send("Password required");
    }
  });
}

app.get("/health", (_req, res) => {
  res.json({ status: "ok", cardsCached: countCards(), cardsLastImportedAt: getLastImportedAt() ?? null });
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

// Optional shared password gating the actual draft (the socket connection),
// for when the server is exposed beyond a trusted LAN. Unset by default —
// no password required. "invalid_password" is a machine-checkable marker
// the client uses to show a password prompt rather than a generic error.
const LOBBY_PASSWORD = process.env.LOBBY_PASSWORD;
io.use((socket, next) => {
  if (!LOBBY_PASSWORD || socket.handshake.auth?.password === LOBBY_PASSWORD) {
    next();
  } else {
    next(new Error("invalid_password"));
  }
});

registerSocketHandlers(io);

httpServer.listen(PORT, "0.0.0.0", () => {
  console.log(`Draft Simulator server listening on http://0.0.0.0:${PORT}`);
});
