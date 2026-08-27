import type { Server, Socket } from "socket.io";
import type { ClientToServerEvents, ServerToClientEvents } from "@draft-simulator/shared";
import * as lobbyManager from "../session/lobbyManager.js";
import { buildLobbyStateView } from "../session/lobbyStateView.js";
import { buildDeckExports } from "../session/deckExport.js";

type IoServer = Server<ClientToServerEvents, ServerToClientEvents>;
type IoSocket = Socket<ClientToServerEvents, ServerToClientEvents>;

/** socket.id -> playerId. The server, never the client, decides who is picking. */
const socketPlayers = new Map<string, string>();
/** playerId -> socket.id, the reverse of socketPlayers. Lets a rejoin evict a stale live session. */
const playerSockets = new Map<string, string>();

function bindSocketToPlayer(io: IoServer, socket: IoSocket, playerId: string): void {
  const staleSocketId = playerSockets.get(playerId);
  if (staleSocketId && staleSocketId !== socket.id) {
    io.to(staleSocketId).emit("identity:evicted");
    socketPlayers.delete(staleSocketId);
    io.sockets.sockets.get(staleSocketId)?.disconnect(true);
  }
  socketPlayers.set(socket.id, playerId);
  playerSockets.set(playerId, socket.id);
}

function broadcastLobbyState(io: IoServer): void {
  io.emit("lobby:state", buildLobbyStateView());
}

/**
 * Pushes one player's own current state (their pack + pool while drafting,
 * or their deck export once complete) to one specific socket. Never sends
 * anyone else's data.
 */
function sendDraftStateTo(io: IoServer, socketId: string, playerId: string): void {
  const session = lobbyManager.getSession();
  if (!session) return;

  if (session.status === "complete") {
    // The final round's picks never get their own draft:myState broadcast
    // (the round that completes the draft only triggers draft:complete), so
    // without this the client's local pool would be missing the last pack's
    // worth of picks.
    io.to(socketId).emit("draft:myState", { pack: null, pool: session.pools[playerId] ?? [] });
    const deckExport = buildDeckExports(session).find((e) => e.playerId === playerId);
    if (deckExport) io.to(socketId).emit("draft:complete", deckExport);
  } else if (session.status === "drafting") {
    io.to(socketId).emit("draft:myState", {
      pack: session.currentPacks[playerId] ?? null,
      pool: session.pools[playerId] ?? [],
    });
  }
}

function broadcastDraftStateToAll(io: IoServer): void {
  for (const [socketId, playerId] of socketPlayers) {
    sendDraftStateTo(io, socketId, playerId);
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
        bindSocketToPlayer(io, socket, host.id);
        callback({ ok: true, playerId: host.id, ...cubeMeta });
        broadcastLobbyState(io);
      } catch (err) {
        callback({ ok: false, error: (err as Error).message });
      }
    });

    socket.on("lobby:join", (payload, callback) => {
      try {
        const player = lobbyManager.addPlayer(payload.playerName);
        bindSocketToPlayer(io, socket, player.id);
        callback({ ok: true, playerId: player.id });
        broadcastLobbyState(io);
      } catch (err) {
        callback({ ok: false, error: (err as Error).message });
      }
    });

    socket.on("lobby:reconnect", (payload, callback) => {
      try {
        const session = lobbyManager.getSession();
        const player = session?.players.find((p) => p.id === payload.playerId);
        if (!session || !player) {
          throw new Error("No matching player found for this draft");
        }

        bindSocketToPlayer(io, socket, player.id);
        lobbyManager.setPlayerConnected(player.id, true);
        callback({ ok: true });
        broadcastLobbyState(io);
        sendDraftStateTo(io, socket.id, player.id);
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
        broadcastDraftStateToAll(io);
      } catch (err) {
        callback({ ok: false, error: (err as Error).message });
      }
    });

    socket.on("draft:cancel", (callback) => {
      try {
        const playerId = socketPlayers.get(socket.id);
        const session = lobbyManager.getSession();
        if (!session || session.status === "complete") throw new Error("No draft in progress to cancel");
        const isHost = session.players.find((p) => p.id === playerId)?.isHost === true;
        if (!isHost) throw new Error("Only the host can cancel the draft");

        lobbyManager.cancelDraft();
        callback({ ok: true });
        broadcastLobbyState(io);
      } catch (err) {
        callback({ ok: false, error: (err as Error).message });
      }
    });

    socket.on("lobby:reset", (callback) => {
      try {
        const playerId = socketPlayers.get(socket.id);
        const session = lobbyManager.getSession();
        if (!session || session.status !== "complete") throw new Error("No completed draft to reset");
        const isHost = session.players.find((p) => p.id === playerId)?.isHost === true;
        if (!isHost) throw new Error("Only the host can reset the draft");

        lobbyManager.cancelDraft();
        callback({ ok: true });
        broadcastLobbyState(io);
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

        if (session.status === "complete" || session.waitingOn.length === session.players.length) {
          // Either the draft just finished, or a fresh round was just dealt
          // (rotation or a new pack) — that's the one moment everyone's
          // pack/pool actually changes. Pushing a second, earlier update to
          // just the picker (for "instant" pool feedback) sounds appealing
          // but isn't worth it: it can arrive right before this broadcast,
          // and anything race-sensitive about event order (including tests)
          // has to handle two updates in one round instead of one.
          broadcastDraftStateToAll(io);
        }
      } catch (err) {
        callback({ ok: false, error: (err as Error).message });
      }
    });

    socket.on("disconnect", () => {
      console.log(`Client disconnected: ${socket.id}`);
      const playerId = socketPlayers.get(socket.id);
      if (playerId) {
        socketPlayers.delete(socket.id);
        // Only clear the reverse mapping if it still points at this socket —
        // an eviction may have already rebound the player to a newer socket.
        if (playerSockets.get(playerId) === socket.id) {
          playerSockets.delete(playerId);
          lobbyManager.setPlayerConnected(playerId, false);
        }
        broadcastLobbyState(io);
      }
    });
  });
}
