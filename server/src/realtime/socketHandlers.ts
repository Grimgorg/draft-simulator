import type { Server, Socket } from "socket.io";
import type {
  ActionResult,
  ClientToServerEvents,
  NewDraftSettings,
  ServerToClientEvents,
} from "@draft-simulator/shared";
import * as lobbyManager from "../session/lobbyManager.js";
import { buildLobbyStateView } from "../session/lobbyStateView.js";
import { buildDeckExports } from "../session/deckExport.js";
import { importCubeFromCubeCobra } from "../cubeImport/cubeCobraImporter.js";

type IoServer = Server<ClientToServerEvents, ServerToClientEvents>;
type IoSocket = Socket<ClientToServerEvents, ServerToClientEvents>;

/** socket.id -> playerId. The server, never the client, decides who is picking. */
const socketPlayers = new Map<string, string>();
/** playerId -> socket.id, the reverse of socketPlayers. Lets a rejoin evict a stale live session. */
const playerSockets = new Map<string, string>();
/**
 * The running draft server, so the host's actions in the management UI reach
 * the players. Unset until it first starts; a stopped one has no sockets left
 * to emit to, and players get the state when they connect again.
 */
let currentIo: IoServer | undefined;

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

function errorResult(err: unknown): ActionResult {
  return { ok: false, error: err instanceof Error ? err.message : String(err) };
}

/**
 * The host's draft controls, called from the management UI. They live here
 * because this is the only code that emits to players. Like the handlers
 * below they never throw.
 */
export async function createDraft(settings: NewDraftSettings): Promise<ActionResult> {
  try {
    if (settings.setCode !== undefined) {
      if (settings.cubeIdOrUrl) throw new Error("Choose a cube or a set, not both");
      lobbyManager.createSetLobby(settings.setCode, settings.packCount, settings.playerCount, settings.alternatingDraft);
    } else {
      await lobbyManager.createLobby(
        settings.cubeIdOrUrl ?? "",
        settings.packCount,
        settings.packSize,
        settings.playerCount,
        settings.alternatingDraft
      );
    }
    if (currentIo) broadcastLobbyState(currentIo);
    return { ok: true };
  } catch (err) {
    return errorResult(err);
  }
}

export function startDraft(): ActionResult {
  try {
    lobbyManager.beginDraft();
    if (currentIo) {
      // Pack before lobby state, as in draft:pick.
      broadcastDraftStateToAll(currentIo);
      broadcastLobbyState(currentIo);
    }
    return { ok: true };
  } catch (err) {
    return errorResult(err);
  }
}

export function cancelDraft(): ActionResult {
  try {
    const session = lobbyManager.getSession();
    if (!session || session.status === "complete") throw new Error("No draft in progress to cancel");
    lobbyManager.cancelDraft();
    if (currentIo) broadcastLobbyState(currentIo);
    return { ok: true };
  } catch (err) {
    return errorResult(err);
  }
}

export function registerSocketHandlers(io: IoServer): void {
  currentIo = io;
  io.on("connection", (socket: IoSocket) => {
    console.log(`Client connected: ${socket.id}`);
    socket.emit("lobby:state", buildLobbyStateView());

    socket.on("cube:preview", async (payload, callback) => {
      try {
        const result = await importCubeFromCubeCobra(payload.cubeIdOrUrl);
        callback({ ok: true, cubeName: result.cubeName, cards: result.cards, unresolvedNames: result.unresolvedNames });
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
        // Pack before lobby state, as in draft:pick.
        sendDraftStateTo(io, socket.id, player.id);
        broadcastLobbyState(io);
      } catch (err) {
        callback({ ok: false, error: (err as Error).message });
      }
    });

    socket.on("draft:pick", (payload, callback) => {
      try {
        const playerId = socketPlayers.get(socket.id);
        if (!playerId) throw new Error("Not joined to this draft");

        const outcome = lobbyManager.pick(playerId, payload.scryfallId);
        callback({ ok: true });

        if (outcome !== "waitingOnOthers") {
          // Either the draft just finished, or a fresh round was just dealt
          // (rotation or a new pack) — that's the moment everyone's pack/pool
          // actually changes, this picker included. New packs go out before
          // the lobby state that says "your turn": the other order briefly
          // showed each player the pack they'd already picked from as
          // pickable, so a quick click sent a card that was no longer theirs.
          broadcastDraftStateToAll(io);
          broadcastLobbyState(io);
        } else {
          // The picker's own pool already grew inside lobbyManager.pick
          // above, so push it to them right away rather than making them
          // wait on everyone else to finish the round. Skipped when the
          // round just advanced (branch above) so this exact pick never
          // fires two draft:myState updates at once for the same player —
          // this player may still get a second, later update once someone
          // else's pick finally completes the round. Sent after the lobby
          // state (which takes the picker out of waitingOn), so their
          // now-smaller pack never shows up as still pickable.
          broadcastLobbyState(io);
          sendDraftStateTo(io, socket.id, playerId);
        }
      } catch (err) {
        callback({ ok: false, error: (err as Error).message });
      }
    });

    socket.on("disconnect", () => {
      console.log(`Client disconnected: ${socket.id}`);
      // Unlike the handlers above there's no callback to report an error
      // through, and an exception thrown from here is uncaught — it takes
      // the whole server (and everyone's draft) down with it.
      try {
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
      } catch (err) {
        console.error(`Error while handling disconnect of ${socket.id}:`, err);
      }
    });
  });
}
