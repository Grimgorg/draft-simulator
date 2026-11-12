import type { Server, Socket } from "socket.io";
import type {
  ActionResult,
  ClientToServerEvents,
  NewDraftSettings,
  ServerToClientEvents,
} from "@draft-simulator/shared";
import * as lobbyManager from "../session/lobbyManager.js";
import { buildDraftSummaries, buildLobbyStateView } from "../session/lobbyStateView.js";
import { buildDeckExports } from "../session/deckExport.js";
import { buildWinstonPile } from "../draftEngine/winstonDraft.js";

type IoServer = Server<ClientToServerEvents, ServerToClientEvents>;
type IoSocket = Socket<ClientToServerEvents, ServerToClientEvents>;

/** The player a socket is seated as, in which draft. */
interface Seat {
  draftId: string;
  playerId: string;
}

/** socket.id -> its seat. The server, never the client, decides who is picking, and in which draft. */
const socketSeats = new Map<string, Seat>();
/** playerId -> socket.id, the reverse of socketSeats. Lets a rejoin evict a stale live session. */
const playerSockets = new Map<string, string>();
/**
 * The running draft server, so the host's actions in the management UI reach
 * the players. Unset until it first starts; a stopped one has no sockets left
 * to emit to, and players get the state when they connect again.
 */
let currentIo: IoServer | undefined;

/** The Socket.IO room of a draft's seated sockets: lobby:state goes only there, never to the other drafts. */
function draftRoom(draftId: string): string {
  return `draft:${draftId}`;
}

/** Frees the socket's seat, if it has one, and marks its player disconnected. Returns the draft it was in. */
function releaseSeat(socket: IoSocket): string | undefined {
  const seat = socketSeats.get(socket.id);
  if (!seat) return undefined;
  socketSeats.delete(socket.id);
  socket.leave(draftRoom(seat.draftId));
  // Only clear the reverse mapping if it still points at this socket —
  // an eviction may have already rebound the player to a newer socket.
  if (playerSockets.get(seat.playerId) === socket.id) {
    playerSockets.delete(seat.playerId);
    lobbyManager.setPlayerConnected(seat.draftId, seat.playerId, false);
  }
  return seat.draftId;
}

function bindSocketToPlayer(io: IoServer, socket: IoSocket, draftId: string, playerId: string): void {
  const current = socketSeats.get(socket.id);
  if (current?.playerId !== playerId) {
    const previousDraft = releaseSeat(socket);
    if (previousDraft !== undefined && previousDraft !== draftId) broadcastLobbyState(io, previousDraft);
  }
  const staleSocketId = playerSockets.get(playerId);
  if (staleSocketId && staleSocketId !== socket.id) {
    io.to(staleSocketId).emit("identity:evicted");
    socketSeats.delete(staleSocketId);
    io.sockets.sockets.get(staleSocketId)?.disconnect(true);
  }
  socketSeats.set(socket.id, { draftId, playerId });
  playerSockets.set(playerId, socket.id);
  socket.join(draftRoom(draftId));
}

function requireSeat(socket: IoSocket): Seat {
  const seat = socketSeats.get(socket.id);
  if (!seat) throw new Error("Not joined to this draft");
  return seat;
}

function requireCreator(seat: Seat): void {
  if (lobbyManager.getCreatorPlayerId(seat.draftId) !== seat.playerId) {
    throw new Error("Only the player who created this draft can do that");
  }
}

function broadcastDraftList(io: IoServer): void {
  removeExpiredDrafts(io);
  io.emit("drafts:list", buildDraftSummaries());
}

function broadcastLobbyState(io: IoServer, draftId: string): void {
  const view = buildLobbyStateView(draftId);
  if (view) io.to(draftRoom(draftId)).emit("lobby:state", view);
}

/** Tells a closed draft's players, and frees their seats: there's nothing left for their sockets to be in. */
function releaseClosedDraft(io: IoServer, draftId: string): void {
  io.to(draftRoom(draftId)).emit("draft:closed", draftId);
  for (const [socketId, seat] of socketSeats) {
    if (seat.draftId !== draftId) continue;
    socketSeats.delete(socketId);
    if (playerSockets.get(seat.playerId) === socketId) playerSockets.delete(seat.playerId);
    io.sockets.sockets.get(socketId)?.leave(draftRoom(draftId));
  }
}

/** Removes the drafts that finished a day ago. Checked whenever the list goes out, so it needs no timer. */
function removeExpiredDrafts(io: IoServer): void {
  for (const draftId of lobbyManager.removeExpiredDrafts()) releaseClosedDraft(io, draftId);
}

/**
 * Pushes one player's own current state (their pack + pool while drafting,
 * or their deck export once complete) to one specific socket. Never sends
 * anyone else's data.
 */
function sendDraftStateTo(io: IoServer, socketId: string, { draftId, playerId }: Seat): void {
  const session = lobbyManager.getSession(draftId);
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
      ...(session.settings.format === "winston" ? { pile: buildWinstonPile(session, playerId) } : {}),
    });
  }
}

function broadcastDraftStateToAll(io: IoServer, draftId: string): void {
  for (const [socketId, seat] of socketSeats) {
    if (seat.draftId === draftId) sendDraftStateTo(io, socketId, seat);
  }
}

function errorResult(err: unknown): { ok: false; error: string } {
  return { ok: false, error: err instanceof Error ? err.message : String(err) };
}

/** Opens the draft a player asked for: a set's boosters or a CubeCobra cube. Returns its id. */
async function createLobby(settings: NewDraftSettings): Promise<string> {
  if (settings.format !== undefined && settings.format !== "winston") {
    throw new Error(`Unknown draft format "${String(settings.format)}"`);
  }
  const format = settings.format === "winston" ? ("winston" as const) : undefined;
  const packCount = Number(settings.packCount);
  const alternatingDraft = settings.alternatingDraft === true;
  if (settings.setCode !== undefined) {
    if (settings.cubeIdOrUrl) throw new Error("Choose a cube or a set, not both");
    return lobbyManager.createSetLobby(String(settings.setCode), packCount, alternatingDraft, format).draftId;
  }
  const cube = String(settings.cubeIdOrUrl ?? "").trim();
  return (await lobbyManager.createLobby(cube, packCount, Number(settings.packSize), alternatingDraft, format))
    .draftId;
}

/**
 * The host's way to end a draft from the management UI, for one that's stuck or whose creator is gone. It lives
 * here because this is the only code that emits to players. Like the handlers below it never throws.
 */
export function closeDraft(draftId: string): ActionResult {
  try {
    lobbyManager.closeDraft(draftId);
    if (currentIo) {
      releaseClosedDraft(currentIo, draftId);
      broadcastDraftList(currentIo);
    }
    return { ok: true };
  } catch (err) {
    return errorResult(err);
  }
}

/** The host's way to free a seat from the management UI, like a draft's creator can. Never throws. */
export function releaseSeatAsHost(draftId: string, playerId: string): ActionResult {
  try {
    lobbyManager.releaseSeat(draftId, playerId);
    if (currentIo) {
      broadcastLobbyState(currentIo, draftId);
      broadcastDraftList(currentIo);
    }
    return { ok: true };
  } catch (err) {
    return errorResult(err);
  }
}

export function registerSocketHandlers(io: IoServer): void {
  currentIo = io;
  io.on("connection", (socket: IoSocket) => {
    console.log(`Client connected: ${socket.id}`);
    // Every client event ends with an acknowledgement callback, which the handlers report through. An event sent
    // by hand without one made `callback(...)` throw outside any try, and that uncaught error stopped the server,
    // ending every draft. The client never sends one, so it's dropped before it reaches a handler.
    socket.use((packet, next) => {
      if (typeof packet[packet.length - 1] === "function") next();
    });
    try {
      removeExpiredDrafts(io);
      socket.emit("drafts:list", buildDraftSummaries());
    } catch (err) {
      console.error(`Error while sending the draft list to ${socket.id}:`, err);
    }

    socket.on("draft:create", async (payload, callback) => {
      try {
        // Checked before the cube import, so a draft is never left without its creator.
        const playerName = lobbyManager.validatePlayerName(String(payload?.playerName ?? ""));
        const draftId = await createLobby(payload);
        const { player, seatToken } = lobbyManager.joinDraft(draftId, playerName);
        bindSocketToPlayer(io, socket, draftId, player.id);
        // A browser that closed while the cube was imported has a seat no one is in.
        if (!socket.connected) releaseSeat(socket);
        callback({ ok: true, draftId, playerId: player.id, seatToken });
        broadcastLobbyState(io, draftId);
        broadcastDraftList(io);
      } catch (err) {
        callback(errorResult(err));
      }
    });

    socket.on("lobby:cubeCards", (callback) => {
      try {
        callback({ ok: true, ...lobbyManager.getCubeCards(requireSeat(socket).draftId) });
      } catch (err) {
        callback(errorResult(err));
      }
    });

    socket.on("lobby:samplePack", (callback) => {
      try {
        callback({ ok: true, cards: lobbyManager.openSamplePack(requireSeat(socket).draftId) });
      } catch (err) {
        callback(errorResult(err));
      }
    });

    socket.on("lobby:join", (payload, callback) => {
      try {
        const draftId = String(payload?.draftId);
        const { player, seatToken } = lobbyManager.joinDraft(draftId, String(payload?.playerName ?? ""));
        bindSocketToPlayer(io, socket, draftId, player.id);
        callback({ ok: true, playerId: player.id, seatToken });
        broadcastLobbyState(io, draftId);
        broadcastDraftList(io);
      } catch (err) {
        callback(errorResult(err));
      }
    });

    socket.on("lobby:reconnect", (payload, callback) => {
      try {
        const draftId = String(payload?.draftId);
        const player = lobbyManager.getSession(draftId)?.players.find((p) => p.id === payload?.playerId);
        if (!player) throw new Error("No matching player found for this draft");
        // Before binding: a socket without the seat's token mustn't even evict the one that has it.
        const seatToken = lobbyManager.claimSeat(draftId, player.id, payload?.seatToken);

        bindSocketToPlayer(io, socket, draftId, player.id);
        lobbyManager.setPlayerConnected(draftId, player.id, true);
        callback({ ok: true, seatToken });
        // Pack before lobby state, as in draft:pick.
        sendDraftStateTo(io, socket.id, { draftId, playerId: player.id });
        broadcastLobbyState(io, draftId);
        broadcastDraftList(io);
      } catch (err) {
        callback(errorResult(err));
      }
    });

    socket.on("lobby:leave", (callback) => {
      try {
        const seat = requireSeat(socket);
        const status = lobbyManager.getSession(seat.draftId)?.status;
        if (status === "drafting") throw new Error("You can't leave a draft that's under way");
        if (status === "lobby") lobbyManager.removePlayer(seat.draftId, seat.playerId);
        releaseSeat(socket);
        callback({ ok: true });
        broadcastLobbyState(io, seat.draftId);
        broadcastDraftList(io);
      } catch (err) {
        callback(errorResult(err));
      }
    });

    socket.on("draft:start", (callback) => {
      try {
        const seat = requireSeat(socket);
        requireCreator(seat);
        lobbyManager.beginDraft(seat.draftId);
        callback({ ok: true });
        // Pack before lobby state, as in draft:pick.
        broadcastDraftStateToAll(io, seat.draftId);
        broadcastLobbyState(io, seat.draftId);
        broadcastDraftList(io);
      } catch (err) {
        callback(errorResult(err));
      }
    });

    socket.on("draft:close", (callback) => {
      try {
        const seat = requireSeat(socket);
        requireCreator(seat);
        lobbyManager.closeDraft(seat.draftId);
        callback({ ok: true });
        releaseClosedDraft(io, seat.draftId);
        broadcastDraftList(io);
      } catch (err) {
        callback(errorResult(err));
      }
    });

    socket.on("lobby:releaseSeat", (payload, callback) => {
      try {
        const seat = requireSeat(socket);
        requireCreator(seat);
        const playerId = String(payload?.playerId);
        if (playerId === seat.playerId) throw new Error("You can't release your own seat");
        lobbyManager.releaseSeat(seat.draftId, playerId);
        callback({ ok: true });
        broadcastLobbyState(io, seat.draftId);
        broadcastDraftList(io);
      } catch (err) {
        callback(errorResult(err));
      }
    });

    socket.on("draft:pick", (payload, callback) => {
      try {
        const seat = requireSeat(socket);
        const outcome = lobbyManager.pick(seat.draftId, seat.playerId, String(payload?.scryfallId));
        callback({ ok: true });

        if (outcome !== "waitingOnOthers") {
          // Either the draft just finished, or a fresh round was just dealt
          // (rotation or a new pack) — that's the moment everyone's pack/pool
          // actually changes, this picker included. New packs go out before
          // the lobby state that says "your turn": the other order briefly
          // showed each player the pack they'd already picked from as
          // pickable, so a quick click sent a card that was no longer theirs.
          broadcastDraftStateToAll(io, seat.draftId);
          broadcastLobbyState(io, seat.draftId);
          if (outcome === "draftComplete") broadcastDraftList(io);
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
          broadcastLobbyState(io, seat.draftId);
          sendDraftStateTo(io, socket.id, seat);
        }
      } catch (err) {
        callback(errorResult(err));
      }
    });

    // Every Winston action can change what both players see (the active player's pile, the turn, pile sizes),
    // so both get their state again. The pile goes out before the lobby state, as in draft:pick.
    const winstonAction =
      (act: (draftId: string, playerId: string, pileIndex: number) => unknown) =>
      (payload: { pileIndex: number }, callback: (result: ActionResult) => void) => {
        try {
          const seat = requireSeat(socket);
          act(seat.draftId, seat.playerId, Number(payload?.pileIndex));
          callback({ ok: true });
          broadcastDraftStateToAll(io, seat.draftId);
          broadcastLobbyState(io, seat.draftId);
          if (lobbyManager.getSession(seat.draftId)?.status === "complete") broadcastDraftList(io);
        } catch (err) {
          callback(errorResult(err));
        }
      };
    socket.on("winston:take", winstonAction(lobbyManager.takeWinstonPile));
    socket.on("winston:pass", winstonAction(lobbyManager.passWinstonPile));

    socket.on("disconnect", () => {
      console.log(`Client disconnected: ${socket.id}`);
      // Unlike the handlers above there's no callback to report an error
      // through, and an exception thrown from here is uncaught — it takes
      // the whole server (and everyone's draft) down with it.
      try {
        const draftId = releaseSeat(socket);
        if (draftId !== undefined) {
          broadcastLobbyState(io, draftId);
          broadcastDraftList(io);
        }
      } catch (err) {
        console.error(`Error while handling disconnect of ${socket.id}:`, err);
      }
    });
  });
}
