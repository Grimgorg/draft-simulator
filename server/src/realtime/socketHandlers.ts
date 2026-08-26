import type { Server, Socket } from "socket.io";
import type { ClientToServerEvents, ServerToClientEvents } from "@draft-simulator/shared";
import * as lobbyManager from "../session/lobbyManager.js";
import { buildLobbyStateView } from "../session/lobbyStateView.js";
import { buildDeckExports } from "../session/deckExport.js";
import { buildHubStateView } from "../session/hubStateView.js";
import { buildMatchStateView } from "../session/matchStateView.js";
import { rollDie } from "../session/gameEngine.js";
import type { MatchSession } from "../session/gameEngine.js";

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

function broadcastHubState(io: IoServer): void {
  io.emit("hub:state", buildHubStateView());
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

/** Pushes one player's private match view (if they're currently in a match) to one specific socket. */
function sendMatchStateTo(io: IoServer, socketId: string, playerId: string): void {
  const match = lobbyManager.getActiveMatch(playerId);
  if (match) io.to(socketId).emit("match:state", buildMatchStateView(match, playerId));
}

/** Pushes the current match state to both participants' live sockets, if connected. */
function broadcastMatchState(io: IoServer, match: MatchSession): void {
  for (const playerId of match.players) {
    const socketId = playerSockets.get(playerId);
    if (socketId) sendMatchStateTo(io, socketId, playerId);
  }
}

/** Pushes a player's pending incoming challenge (if any) to one specific socket. */
function sendPendingChallengeTo(io: IoServer, socketId: string, playerId: string): void {
  const pending = lobbyManager.getPendingChallenge(playerId);
  if (!pending) return;
  const fromName = lobbyManager.getSession()?.players.find((p) => p.id === pending.fromId)?.name ?? "Someone";
  io.to(socketId).emit("hub:challengeReceived", { fromId: pending.fromId, fromName });
}

function getPlayerName(playerId: string): string {
  return lobbyManager.getSession()?.players.find((p) => p.id === playerId)?.name ?? "Someone";
}

/** Emits one event to both of a match's participants' live sockets, if connected. For transient events (reveal, dice) that never touch match:state. */
function emitToParticipants<E extends keyof ServerToClientEvents>(
  io: IoServer,
  match: MatchSession,
  event: E,
  ...args: Parameters<ServerToClientEvents[E]>
): void {
  for (const playerId of match.players) {
    const socketId = playerSockets.get(playerId);
    if (socketId) io.to(socketId).emit(event, ...args);
  }
}

export function registerSocketHandlers(io: IoServer): void {
  io.on("connection", (socket: IoSocket) => {
    console.log(`Client connected: ${socket.id}`);
    socket.emit("lobby:state", buildLobbyStateView());
    socket.emit("hub:state", buildHubStateView());

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
        sendMatchStateTo(io, socket.id, player.id);
        sendPendingChallengeTo(io, socket.id, player.id);
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
        if (!session) throw new Error("No draft in progress to cancel");
        const isHost = session.players.find((p) => p.id === playerId)?.isHost === true;
        if (!isHost) throw new Error("Only the host can cancel the draft");

        lobbyManager.cancelDraft();
        callback({ ok: true });
        broadcastLobbyState(io);
        broadcastHubState(io);
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

    socket.on("deck:submit", (payload, callback) => {
      try {
        const playerId = socketPlayers.get(socket.id);
        if (!playerId) throw new Error("Not joined to this draft");

        lobbyManager.submitDeck(playerId, payload.scryfallIds);
        callback({ ok: true });
        broadcastHubState(io);
      } catch (err) {
        callback({ ok: false, error: (err as Error).message });
      }
    });

    socket.on("deck:unready", (callback) => {
      try {
        const playerId = socketPlayers.get(socket.id);
        if (!playerId) throw new Error("Not joined to this draft");

        lobbyManager.unready(playerId);
        callback({ ok: true });
        broadcastHubState(io);
      } catch (err) {
        callback({ ok: false, error: (err as Error).message });
      }
    });

    socket.on("hub:challenge", (payload, callback) => {
      try {
        const playerId = socketPlayers.get(socket.id);
        if (!playerId) throw new Error("Not joined to this draft");

        lobbyManager.challenge(playerId, payload.opponentId);
        callback({ ok: true });

        const opponentSocketId = playerSockets.get(payload.opponentId);
        if (opponentSocketId) sendPendingChallengeTo(io, opponentSocketId, payload.opponentId);
      } catch (err) {
        callback({ ok: false, error: (err as Error).message });
      }
    });

    socket.on("hub:respondChallenge", (payload, callback) => {
      try {
        const playerId = socketPlayers.get(socket.id);
        if (!playerId) throw new Error("Not joined to this draft");

        const match = lobbyManager.respondToChallenge(playerId, payload.fromId, payload.accept);
        callback({ ok: true });
        broadcastHubState(io);
        if (match) broadcastMatchState(io, match);
      } catch (err) {
        callback({ ok: false, error: (err as Error).message });
      }
    });

    socket.on("match:concede", (callback) => {
      try {
        const playerId = socketPlayers.get(socket.id);
        if (!playerId) throw new Error("Not joined to this draft");

        const match = lobbyManager.concede(playerId);
        callback({ ok: true });
        broadcastHubState(io);
        for (const p of match.players) {
          const socketId = playerSockets.get(p);
          if (socketId) io.to(socketId).emit("match:ended");
        }
      } catch (err) {
        callback({ ok: false, error: (err as Error).message });
      }
    });

    socket.on("match:drawCard", (callback) => {
      try {
        const playerId = socketPlayers.get(socket.id);
        if (!playerId) throw new Error("Not joined to this draft");

        const match = lobbyManager.drawCard(playerId);
        callback({ ok: true });
        broadcastMatchState(io, match);
      } catch (err) {
        callback({ ok: false, error: (err as Error).message });
      }
    });

    socket.on("match:shuffleLibrary", (callback) => {
      try {
        const playerId = socketPlayers.get(socket.id);
        if (!playerId) throw new Error("Not joined to this draft");

        const match = lobbyManager.shuffleLibrary(playerId);
        callback({ ok: true });
        broadcastMatchState(io, match);
      } catch (err) {
        callback({ ok: false, error: (err as Error).message });
      }
    });

    socket.on("match:mulligan", (callback) => {
      try {
        const playerId = socketPlayers.get(socket.id);
        if (!playerId) throw new Error("Not joined to this draft");

        const match = lobbyManager.mulligan(playerId);
        callback({ ok: true });
        broadcastMatchState(io, match);
      } catch (err) {
        callback({ ok: false, error: (err as Error).message });
      }
    });

    socket.on("match:moveCard", (payload, callback) => {
      try {
        const playerId = socketPlayers.get(socket.id);
        if (!playerId) throw new Error("Not joined to this draft");

        const battlefieldTarget =
          payload.battlefieldRow !== undefined ? { row: payload.battlefieldRow, stackId: payload.battlefieldStackId } : undefined;
        const match = lobbyManager.moveCard(playerId, payload.instanceId, payload.toZone, payload.toLibraryPosition, battlefieldTarget);
        callback({ ok: true });
        broadcastMatchState(io, match);
      } catch (err) {
        callback({ ok: false, error: (err as Error).message });
      }
    });

    socket.on("match:tapCard", (payload, callback) => {
      try {
        const playerId = socketPlayers.get(socket.id);
        if (!playerId) throw new Error("Not joined to this draft");

        const match = lobbyManager.tapCard(playerId, payload.instanceId, payload.tapped);
        callback({ ok: true });
        broadcastMatchState(io, match);
      } catch (err) {
        callback({ ok: false, error: (err as Error).message });
      }
    });

    socket.on("match:untapAll", (callback) => {
      try {
        const playerId = socketPlayers.get(socket.id);
        if (!playerId) throw new Error("Not joined to this draft");

        const match = lobbyManager.untapAll(playerId);
        callback({ ok: true });
        broadcastMatchState(io, match);
      } catch (err) {
        callback({ ok: false, error: (err as Error).message });
      }
    });

    socket.on("match:setCardCounter", (payload, callback) => {
      try {
        const playerId = socketPlayers.get(socket.id);
        if (!playerId) throw new Error("Not joined to this draft");

        const match = lobbyManager.setCardCounter(playerId, payload.instanceId, payload.label, payload.delta);
        callback({ ok: true });
        broadcastMatchState(io, match);
      } catch (err) {
        callback({ ok: false, error: (err as Error).message });
      }
    });

    socket.on("match:setBattlefieldSlot", (payload, callback) => {
      try {
        const playerId = socketPlayers.get(socket.id);
        if (!playerId) throw new Error("Not joined to this draft");

        const match = lobbyManager.setBattlefieldSlot(playerId, payload.instanceId, payload.row, payload.stackId);
        callback({ ok: true });
        broadcastMatchState(io, match);
      } catch (err) {
        callback({ ok: false, error: (err as Error).message });
      }
    });

    socket.on("match:flipFaceDown", (payload, callback) => {
      try {
        const playerId = socketPlayers.get(socket.id);
        if (!playerId) throw new Error("Not joined to this draft");

        const match = lobbyManager.flipFaceDown(playerId, payload.instanceId, payload.faceDown);
        callback({ ok: true });
        broadcastMatchState(io, match);
      } catch (err) {
        callback({ ok: false, error: (err as Error).message });
      }
    });

    socket.on("match:createToken", (payload, callback) => {
      try {
        const playerId = socketPlayers.get(socket.id);
        if (!playerId) throw new Error("Not joined to this draft");

        const match = lobbyManager.createToken(playerId, payload.label);
        callback({ ok: true });
        broadcastMatchState(io, match);
      } catch (err) {
        callback({ ok: false, error: (err as Error).message });
      }
    });

    socket.on("match:deleteToken", (payload, callback) => {
      try {
        const playerId = socketPlayers.get(socket.id);
        if (!playerId) throw new Error("Not joined to this draft");

        const match = lobbyManager.deleteToken(playerId, payload.instanceId);
        callback({ ok: true });
        broadcastMatchState(io, match);
      } catch (err) {
        callback({ ok: false, error: (err as Error).message });
      }
    });

    socket.on("match:peekLibrary", (payload, callback) => {
      try {
        const playerId = socketPlayers.get(socket.id);
        if (!playerId) throw new Error("Not joined to this draft");

        const cards = lobbyManager.peekLibrary(playerId, payload.count);
        callback({ ok: true, cards });
      } catch (err) {
        callback({ ok: false, error: (err as Error).message });
      }
    });

    socket.on("match:revealCard", (payload, callback) => {
      try {
        const playerId = socketPlayers.get(socket.id);
        if (!playerId) throw new Error("Not joined to this draft");

        const { match, card } = lobbyManager.findOwnCard(playerId, payload.instanceId);
        callback({ ok: true });
        emitToParticipants(io, match, "match:revealed", {
          fromPlayerId: playerId,
          fromName: getPlayerName(playerId),
          card: card.card,
          tokenLabel: card.tokenLabel,
        });
      } catch (err) {
        callback({ ok: false, error: (err as Error).message });
      }
    });

    socket.on("match:setPlayerCounter", (payload, callback) => {
      try {
        const playerId = socketPlayers.get(socket.id);
        if (!playerId) throw new Error("Not joined to this draft");

        const match = lobbyManager.setPlayerCounter(playerId, payload.label, payload.delta);
        callback({ ok: true });
        broadcastMatchState(io, match);
      } catch (err) {
        callback({ ok: false, error: (err as Error).message });
      }
    });

    socket.on("match:rollDie", (payload, callback) => {
      try {
        const playerId = socketPlayers.get(socket.id);
        if (!playerId) throw new Error("Not joined to this draft");

        const match = lobbyManager.getActiveMatch(playerId);
        if (!match) throw new Error("You're not currently in a match");
        const result = rollDie(payload.sides);
        callback({ ok: true });
        emitToParticipants(io, match, "match:diceResult", {
          fromPlayerId: playerId,
          fromName: getPlayerName(playerId),
          sides: payload.sides,
          result,
        });
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
