import type { Server, Socket } from "socket.io";
import type { ClientToServerEvents, ServerToClientEvents } from "@draft-simulator/shared";
import * as lobbyManager from "../session/lobbyManager.js";
import { buildLobbyStateView } from "../session/lobbyStateView.js";
import { buildDeckExports } from "../session/deckExport.js";

type IoServer = Server<ClientToServerEvents, ServerToClientEvents>;
type IoSocket = Socket<ClientToServerEvents, ServerToClientEvents>;

/** socket.id -> playerId. The server, never the client, decides who is picking. */
const socketPlayers = new Map<string, string>();

function broadcastLobbyState(io: IoServer): void {
  io.emit("lobby:state", buildLobbyStateView());
}

/** Pushes each connected player their own current pack — never anyone else's. */
function sendPrivatePacks(io: IoServer): void {
  const session = lobbyManager.getSession();
  if (!session || session.status !== "drafting") return;
  for (const [socketId, playerId] of socketPlayers) {
    const pack = session.currentPacks[playerId];
    if (pack) io.to(socketId).emit("draft:packUpdate", pack);
  }
}

/** Pushes each connected player their own deck export — never anyone else's. */
function sendPrivateDeckExports(io: IoServer): void {
  const session = lobbyManager.getSession();
  if (!session || session.status !== "complete") return;
  const exportsByPlayer = new Map(buildDeckExports(session).map((deckExport) => [deckExport.playerId, deckExport]));
  for (const [socketId, playerId] of socketPlayers) {
    const deckExport = exportsByPlayer.get(playerId);
    if (deckExport) io.to(socketId).emit("draft:complete", deckExport);
  }
}

export function registerSocketHandlers(io: IoServer): void {
  io.on("connection", (socket: IoSocket) => {
    console.log(`Client connected: ${socket.id}`);
    socket.emit("lobby:state", buildLobbyStateView());

    socket.on("lobby:create", async (payload, callback) => {
      try {
        const { host, cubeMeta } = await lobbyManager.createLobby(
          payload.hostName,
          payload.cubeIdOrUrl,
          payload.packCount,
          payload.packSize,
          payload.playerCount
        );
        socketPlayers.set(socket.id, host.id);
        callback({ ok: true, playerId: host.id, ...cubeMeta });
        broadcastLobbyState(io);
      } catch (err) {
        callback({ ok: false, error: (err as Error).message });
      }
    });

    socket.on("lobby:join", (payload, callback) => {
      try {
        const player = lobbyManager.addPlayer(payload.playerName);
        socketPlayers.set(socket.id, player.id);
        callback({ ok: true, playerId: player.id });
        broadcastLobbyState(io);
      } catch (err) {
        callback({ ok: false, error: (err as Error).message });
      }
    });

    socket.on("draft:start", (callback) => {
      try {
        const playerId = socketPlayers.get(socket.id);
        const session = lobbyManager.getSession();
        const isHost = session?.players.find((p) => p.id === playerId)?.isHost === true;
        if (!isHost) throw new Error("Only the host can start the draft");

        lobbyManager.beginDraft();
        callback({ ok: true });
        broadcastLobbyState(io);
        sendPrivatePacks(io);
      } catch (err) {
        callback({ ok: false, error: (err as Error).message });
      }
    });

    socket.on("draft:pick", (payload, callback) => {
      try {
        const playerId = socketPlayers.get(socket.id);
        if (!playerId) throw new Error("Not joined to this draft");

        const session = lobbyManager.pick(playerId, payload.scryfallId);
        callback({ ok: true });
        broadcastLobbyState(io);

        if (session.status === "complete") {
          sendPrivateDeckExports(io);
        } else if (session.waitingOn.length === session.players.length) {
          // Every player is waiting again only once a fresh round has actually
          // been dealt (rotation or a new pack) — that's the one moment packs
          // change. Sending on every single pick would push stale/redundant
          // packs to players who haven't picked yet this round.
          sendPrivatePacks(io);
        }
      } catch (err) {
        callback({ ok: false, error: (err as Error).message });
      }
    });

    socket.on("disconnect", () => {
      console.log(`Client disconnected: ${socket.id}`);
      const playerId = socketPlayers.get(socket.id);
      if (playerId) {
        lobbyManager.setPlayerConnected(playerId, false);
        socketPlayers.delete(socket.id);
        broadcastLobbyState(io);
      }
    });
  });
}
