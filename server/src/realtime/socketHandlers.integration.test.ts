import assert from "node:assert/strict";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import test, { type TestContext } from "node:test";
import { Server } from "socket.io";
import { io as ioClient, type Socket as ClientSocket } from "socket.io-client";
import type {
  Card,
  ClientToServerEvents,
  DeckExport,
  DraftSettings,
  LobbyStateView,
  Pack,
  ServerToClientEvents,
} from "@draft-simulator/shared";
import { testCard } from "../draftEngine/testHelpers.js";
import * as lobbyManager from "../session/lobbyManager.js";
import { requireLobbyPassword } from "./lobbyPassword.js";
import { registerSocketHandlers } from "./socketHandlers.js";

/**
 * End-to-end tests of the real socket wiring. The first three need internet
 * access (they import a real CubeCobra cube) and an already-populated local
 * card cache (`npm run import-cards --workspace server`); every later test
 * builds its lobby from local test cards and runs offline.
 */

type DraftClientSocket = ClientSocket<ServerToClientEvents, ClientToServerEvents>;
type MyState = { pack: Pack | null; pool: Card[] };

function freshSnapshotPath(): string {
  return path.join(os.tmpdir(), `draft-simulator-itest-${Date.now()}-${Math.random().toString(36).slice(2)}.json`);
}

async function startTestServer(
  options: { lobbyPassword?: string } = {}
): Promise<{ url: string; close: () => Promise<void> }> {
  const httpServer = createServer();
  const io = new Server<ClientToServerEvents, ServerToClientEvents>(httpServer);
  io.use(requireLobbyPassword(options.lobbyPassword));
  registerSocketHandlers(io);

  await new Promise<void>((resolve) => httpServer.listen(0, resolve));
  const { port } = httpServer.address() as AddressInfo;

  return {
    url: `http://localhost:${port}`,
    close: () =>
      new Promise<void>((resolve, reject) => {
        io.close();
        httpServer.close((err) => (err ? reject(err) : resolve()));
      }),
  };
}

function connect(url: string, auth?: { password: string }): Promise<DraftClientSocket> {
  return new Promise((resolve, reject) => {
    const socket: DraftClientSocket = ioClient(url, { forceNew: true, auth });
    socket.once("connect", () => resolve(socket));
    socket.once("connect_error", reject);
  });
}

function waitForMyState(socket: DraftClientSocket): Promise<MyState> {
  return new Promise((resolve) => socket.once("draft:myState", resolve));
}

function waitForDeckExport(socket: DraftClientSocket): Promise<DeckExport> {
  return new Promise((resolve) => socket.once("draft:complete", resolve));
}

/**
 * Waits for a draft:myState whose pool has grown to `expectedPoolSize`,
 * then settles on the *last* one seen within a short window rather than the
 * first. A pick now produces two possible updates for the same player: an
 * instant one the moment their own pick lands (pool already grown, pack
 * mid-round), and — only once every player has picked and the round
 * actually advances — a second one with the new round's pack. Both carry
 * the same (already-final) pool size, so grabbing the first would race
 * against the second and hand back a pack that's about to be rotated away.
 */
function waitForPoolUpdate(socket: DraftClientSocket, expectedPoolSize: number): Promise<MyState> {
  return new Promise((resolve) => {
    let latest: MyState | undefined;
    function onState(payload: MyState) {
      if (payload.pool.length === expectedPoolSize) latest = payload;
    }
    socket.on("draft:myState", onState);
    setTimeout(() => {
      socket.off("draft:myState", onState);
      resolve(latest!);
    }, 100);
  });
}

function waitForEviction(socket: DraftClientSocket): Promise<void> {
  return new Promise((resolve) => socket.once("identity:evicted", () => resolve()));
}

function waitForDisconnect(socket: DraftClientSocket): Promise<void> {
  return new Promise((resolve) => socket.once("disconnect", () => resolve()));
}

function waitForLobbyState(socket: DraftClientSocket): Promise<LobbyStateView> {
  return new Promise((resolve) => socket.once("lobby:state", resolve));
}

function waitForLobbyStateWhere(
  socket: DraftClientSocket,
  predicate: (state: LobbyStateView) => boolean
): Promise<LobbyStateView> {
  return new Promise((resolve) => {
    function onState(state: LobbyStateView) {
      if (!predicate(state)) return;
      socket.off("lobby:state", onState);
      resolve(state);
    }
    socket.on("lobby:state", onState);
  });
}

/** Resolves with the reason the server refused this connection; fails the test if it was accepted. */
function connectionRefusal(url: string, auth?: { password: string }): Promise<string> {
  return new Promise((resolve, reject) => {
    const socket: DraftClientSocket = ioClient(url, { forceNew: true, auth, reconnection: false });
    socket.once("connect", () => {
      socket.close();
      reject(new Error("the server accepted the connection"));
    });
    socket.once("connect_error", (err) => {
      socket.close();
      resolve(err.message);
    });
  });
}

/** A test server whose client sockets, then the server itself, are closed when the test ends. */
async function startServerFor(t: TestContext, options: { lobbyPassword?: string } = {}) {
  const server = await startTestServer(options);
  const sockets: DraftClientSocket[] = [];
  t.after(async () => {
    for (const socket of sockets) socket.close();
    await server.close();
  });
  return {
    url: server.url,
    connect: async (auth?: { password: string }) => {
      const socket = await connect(server.url, auth);
      sockets.push(socket);
      return socket;
    },
  };
}

/**
 * Network-free setup: a lobby built from local test cards, with the host
 * attached over a real socket (as after a refresh) and one guest joined.
 */
async function seatHostAndGuest(
  server: Awaited<ReturnType<typeof startServerFor>>,
  cardIds: string[],
  settings: Partial<DraftSettings> = {}
) {
  const { host } = lobbyManager.createLobbyFromResolvedCube("Alice", "Test Cube", cardIds.map(testCard), [], {
    cubeId: "test",
    packCount: 1,
    packSize: 2,
    playerCount: 2,
    alternatingDraft: true,
    ...settings,
  });
  const hostSocket = await server.connect();
  const guestSocket = await server.connect();
  assert.deepEqual(await hostSocket.emitWithAck("lobby:reconnect", { playerId: host.id }), { ok: true });
  const join = await guestSocket.emitWithAck("lobby:join", { playerName: "Bob" });
  assert.ok(join.ok, JSON.stringify(join));
  return { hostSocket, guestSocket, hostId: host.id, guestId: join.playerId };
}

/** The first card in a player's current pack, read from the server's own state. */
function firstCardInPack(playerId: string): string {
  return lobbyManager.getSession()!.currentPacks[playerId]!.cards[0]!.scryfallId;
}

test(
  "full draft over real sockets: create -> join -> start -> picks -> complete, with pack privacy",
  { timeout: 30_000 },
  async () => {
    lobbyManager.resetForTests(freshSnapshotPath());

    const server = await startTestServer();
    const hostSocket = await connect(server.url);
    const guestSocket = await connect(server.url);

    try {
      const createResult = await new Promise<any>((resolve) =>
        hostSocket.emit(
          "lobby:create",
          {
            hostName: "Alice",
            cubeIdOrUrl: "https://cubecobra.com/cube/overview/practical",
            packCount: 1,
            packSize: 3,
            playerCount: 2,
            alternatingDraft: true,
          },
          resolve
        )
      );
      assert.equal(createResult.ok, true, JSON.stringify(createResult));
      const hostId: string = createResult.playerId;
      assert.ok(createResult.cardCount > 0);

      const joinResult = await new Promise<any>((resolve) =>
        guestSocket.emit("lobby:join", { playerName: "Bob" }, resolve)
      );
      assert.equal(joinResult.ok, true, JSON.stringify(joinResult));
      const guestId: string = joinResult.playerId;

      const hostStatePromise = waitForMyState(hostSocket);
      const guestStatePromise = waitForMyState(guestSocket);

      const startResult = await new Promise<any>((resolve) => hostSocket.emit("draft:start", resolve));
      assert.equal(startResult.ok, true, JSON.stringify(startResult));

      let hostState = await hostStatePromise;
      let guestState = await guestStatePromise;
      assert.equal(hostState.pack?.cards.length, 3);
      assert.equal(guestState.pack?.cards.length, 3);
      assert.equal(hostState.pool.length, 0);

      const hostCardIds = new Set(hostState.pack!.cards.map((c) => c.scryfallId));
      const guestCardIds = new Set(guestState.pack!.cards.map((c) => c.scryfallId));
      assert.equal(
        [...hostCardIds].some((id) => guestCardIds.has(id)),
        false,
        "host and guest must never see overlapping pack contents"
      );

      const hostExportPromise = waitForDeckExport(hostSocket);
      const guestExportPromise = waitForDeckExport(guestSocket);

      // 3 synchronized pick rounds empty the single 3-card pack each and complete the draft.
      for (let round = 0; round < 3; round++) {
        const isLastRound = round === 2;
        const nextHostState = isLastRound ? undefined : waitForPoolUpdate(hostSocket, round + 1);
        const nextGuestState = isLastRound ? undefined : waitForPoolUpdate(guestSocket, round + 1);

        const hostPick = hostState.pack!.cards[0]!.scryfallId;
        const guestPick = guestState.pack!.cards[0]!.scryfallId;

        const [hostPickResult, guestPickResult] = await Promise.all([
          new Promise<any>((resolve) => hostSocket.emit("draft:pick", { scryfallId: hostPick }, resolve)),
          new Promise<any>((resolve) => guestSocket.emit("draft:pick", { scryfallId: guestPick }, resolve)),
        ]);
        assert.equal(hostPickResult.ok, true, JSON.stringify(hostPickResult));
        assert.equal(guestPickResult.ok, true, JSON.stringify(guestPickResult));

        if (nextHostState && nextGuestState) {
          hostState = await nextHostState;
          guestState = await nextGuestState;
          assert.equal(hostState.pool.length, round + 1, "pool should grow by one each round");
        }
      }

      const hostExport = await hostExportPromise;
      const guestExport = await guestExportPromise;

      assert.equal(hostExport.playerId, hostId);
      assert.equal(guestExport.playerId, guestId);
      assert.equal(
        hostExport.cards.reduce((sum, c) => sum + c.count, 0),
        3
      );
      assert.equal(
        guestExport.cards.reduce((sum, c) => sum + c.count, 0),
        3
      );
      assert.ok(hostExport.plainText.length > 0);
    } finally {
      hostSocket.close();
      guestSocket.close();
      await server.close();
    }
  }
);

test(
  "reconnect: a dropped player's new socket resumes their exact pack/pool and can keep picking",
  { timeout: 30_000 },
  async () => {
    lobbyManager.resetForTests(freshSnapshotPath());

    const server = await startTestServer();
    const hostSocket = await connect(server.url);
    let guestSocket = await connect(server.url);

    try {
      const createResult = await new Promise<any>((resolve) =>
        hostSocket.emit(
          "lobby:create",
          {
            hostName: "Alice",
            cubeIdOrUrl: "https://cubecobra.com/cube/overview/practical",
            packCount: 1,
            packSize: 2,
            playerCount: 2,
            alternatingDraft: true,
          },
          resolve
        )
      );
      assert.equal(createResult.ok, true, JSON.stringify(createResult));

      const joinResult = await new Promise<any>((resolve) =>
        guestSocket.emit("lobby:join", { playerName: "Bob" }, resolve)
      );
      assert.equal(joinResult.ok, true, JSON.stringify(joinResult));
      const guestId: string = joinResult.playerId;

      const hostStatePromise = waitForMyState(hostSocket);
      const guestStatePromise = waitForMyState(guestSocket);
      const startResult = await new Promise<any>((resolve) => hostSocket.emit("draft:start", resolve));
      assert.equal(startResult.ok, true, JSON.stringify(startResult));
      const hostStateBeforeDrop = await hostStatePromise;
      const guestStateBeforeDrop = await guestStatePromise;
      assert.equal(guestStateBeforeDrop.pack?.cards.length, 2);
      assert.equal(guestStateBeforeDrop.pool.length, 0);

      // Host picks from their own pack; guest hasn't picked yet, so the round
      // hasn't advanced — guest's pack/pool should still be exactly what they
      // started with.
      const hostPickResult = await new Promise<any>((resolve) =>
        hostSocket.emit("draft:pick", { scryfallId: hostStateBeforeDrop.pack!.cards[0]!.scryfallId }, resolve)
      );
      assert.equal(hostPickResult.ok, true, JSON.stringify(hostPickResult));

      // Simulate the guest's browser dropping and reconnecting: close the old
      // socket, open a fresh one, and re-attach via lobby:reconnect.
      guestSocket.close();
      await new Promise((resolve) => setTimeout(resolve, 100));

      guestSocket = await connect(server.url);
      const reconnectStatePromise = waitForMyState(guestSocket);
      const reconnectResult = await new Promise<any>((resolve) =>
        guestSocket.emit("lobby:reconnect", { playerId: guestId }, resolve)
      );
      assert.equal(reconnectResult.ok, true, JSON.stringify(reconnectResult));

      const resumedState = await reconnectStatePromise;
      assert.equal(resumedState.pool.length, 0, "guest hadn't picked yet, so pool should still be empty");
      assert.deepEqual(
        resumedState.pack?.cards.map((c) => c.scryfallId).sort(),
        guestStateBeforeDrop.pack!.cards.map((c) => c.scryfallId).sort(),
        "reconnect should resume the exact same pack the guest had before dropping"
      );

      // And the reconnected socket should be fully functional, not just read-only.
      const guestPickResult = await new Promise<any>((resolve) =>
        guestSocket.emit("draft:pick", { scryfallId: resumedState.pack!.cards[0]!.scryfallId }, resolve)
      );
      assert.equal(guestPickResult.ok, true, JSON.stringify(guestPickResult));
    } finally {
      hostSocket.close();
      guestSocket.close();
      await server.close();
    }
  }
);

test(
  "rejoin mid-draft: picking a still-connected player from another tab evicts the old session",
  { timeout: 30_000 },
  async () => {
    lobbyManager.resetForTests(freshSnapshotPath());

    const server = await startTestServer();
    const hostSocket = await connect(server.url);
    const guestSocket = await connect(server.url);
    let secondGuestSocket: DraftClientSocket | undefined;

    try {
      const createResult = await new Promise<any>((resolve) =>
        hostSocket.emit(
          "lobby:create",
          {
            hostName: "Alice",
            cubeIdOrUrl: "https://cubecobra.com/cube/overview/practical",
            packCount: 1,
            packSize: 2,
            playerCount: 2,
            alternatingDraft: true,
          },
          resolve
        )
      );
      assert.equal(createResult.ok, true, JSON.stringify(createResult));

      const joinResult = await new Promise<any>((resolve) =>
        guestSocket.emit("lobby:join", { playerName: "Bob" }, resolve)
      );
      assert.equal(joinResult.ok, true, JSON.stringify(joinResult));
      const guestId: string = joinResult.playerId;

      const hostStatePromise = waitForMyState(hostSocket);
      const guestStatePromise = waitForMyState(guestSocket);
      const startResult = await new Promise<any>((resolve) => hostSocket.emit("draft:start", resolve));
      assert.equal(startResult.ok, true, JSON.stringify(startResult));
      await hostStatePromise;
      const guestStateBeforeRejoin = await guestStatePromise;

      // A second tab/browser picks "Bob" from the rejoin list while the
      // original guest socket is still very much connected.
      const evictionPromise = waitForEviction(guestSocket);
      const staleDisconnectPromise = waitForDisconnect(guestSocket);

      secondGuestSocket = await connect(server.url);
      const rejoinStatePromise = waitForMyState(secondGuestSocket);
      const rejoinResult = await new Promise<any>((resolve) =>
        secondGuestSocket!.emit("lobby:reconnect", { playerId: guestId }, resolve)
      );
      assert.equal(rejoinResult.ok, true, JSON.stringify(rejoinResult));

      await evictionPromise;
      await staleDisconnectPromise;

      const rejoinState = await rejoinStatePromise;
      assert.deepEqual(
        rejoinState.pack?.cards.map((c) => c.scryfallId).sort(),
        guestStateBeforeRejoin.pack!.cards.map((c) => c.scryfallId).sort(),
        "the newly claimed session should resume the exact same pack"
      );

      // lobby:state should still show Bob as connected (via the new socket),
      // never dropped to disconnected by the stale socket's disconnect handler.
      const lobbyStatePromise = waitForLobbyState(hostSocket);
      const secondPickResult = await new Promise<any>((resolve) =>
        secondGuestSocket!.emit("draft:pick", { scryfallId: rejoinState.pack!.cards[0]!.scryfallId }, resolve)
      );
      assert.equal(secondPickResult.ok, true, JSON.stringify(secondPickResult));
      const lobbyState = await lobbyStatePromise;
      assert.equal(
        lobbyState.players.find((p) => p.id === guestId)?.connected,
        true,
        "Bob should still show connected after the eviction, driven by the new socket"
      );
    } finally {
      hostSocket.close();
      guestSocket.close();
      secondGuestSocket?.close();
      await server.close();
    }
  }
);

test(
  "round advance: each player's new pack arrives before the lobby state that makes it their turn",
  { timeout: 30_000 },
  async () => {
    // Network-free: the lobby is built from local test cards, then both
    // players attach over real sockets.
    lobbyManager.resetForTests(freshSnapshotPath());
    const { host } = lobbyManager.createLobbyFromResolvedCube(
      "Alice",
      "Test Cube",
      ["c1", "c2", "c3", "c4"].map(testCard),
      [],
      { cubeId: "test", packCount: 1, packSize: 2, playerCount: 2, alternatingDraft: true }
    );

    const server = await startTestServer();
    const hostSocket = await connect(server.url);
    const guestSocket = await connect(server.url);

    try {
      const rejoin = await new Promise<any>((resolve) => hostSocket.emit("lobby:reconnect", { playerId: host.id }, resolve));
      assert.equal(rejoin.ok, true, JSON.stringify(rejoin));
      const join = await new Promise<any>((resolve) => guestSocket.emit("lobby:join", { playerName: "Bob" }, resolve));
      assert.equal(join.ok, true, JSON.stringify(join));

      const hostStart = waitForMyState(hostSocket);
      const guestStart = waitForMyState(guestSocket);
      await new Promise<any>((resolve) => hostSocket.emit("draft:start", resolve));
      const hostPack = (await hostStart).pack!;
      const guestPack = (await guestStart).pack!;

      // From here on, record what each client would render: its latest pack,
      // checked at the moment a lobby:state says it's this player's turn.
      const staleTurns: string[] = [];
      const turnsSeen = { host: 0, guest: 0 };
      function watch(socket: DraftClientSocket, playerId: string, label: "host" | "guest", ownPackId: string) {
        let latestPackId: string | undefined = ownPackId;
        socket.on("draft:myState", (s: MyState) => (latestPackId = s.pack?.id));
        socket.on("lobby:state", (s: LobbyStateView) => {
          if (s.currentPickNumber === 2 && s.waitingOn?.includes(playerId)) {
            turnsSeen[label]++;
            if (latestPackId === ownPackId) staleTurns.push(`${label} was shown the pack it already picked from`);
          }
        });
      }
      watch(hostSocket, host.id, "host", hostPack.id);
      watch(guestSocket, join.playerId, "guest", guestPack.id);

      await new Promise<any>((resolve) => hostSocket.emit("draft:pick", { scryfallId: hostPack.cards[0]!.scryfallId }, resolve));
      await new Promise<any>((resolve) => guestSocket.emit("draft:pick", { scryfallId: guestPack.cards[0]!.scryfallId }, resolve));
      await new Promise((resolve) => setTimeout(resolve, 200));

      assert.deepEqual(turnsSeen, { host: 1, guest: 1 }, "both players got their pick-2 turn");
      assert.deepEqual(staleTurns, []);
    } finally {
      hostSocket.close();
      guestSocket.close();
      await server.close();
    }
  }
);

test(
  "host-only actions: a guest can't start, cancel or reset, and status checks run before the host check",
  { timeout: 30_000 },
  async () => {
    // Network-free, like the round-advance test above.
    lobbyManager.resetForTests(freshSnapshotPath());
    const { host } = lobbyManager.createLobbyFromResolvedCube(
      "Alice",
      "Test Cube",
      ["c1", "c2", "c3", "c4"].map(testCard),
      [],
      { cubeId: "test", packCount: 1, packSize: 2, playerCount: 2, alternatingDraft: true }
    );

    const server = await startTestServer();
    const hostSocket = await connect(server.url);
    const guestSocket = await connect(server.url);

    try {
      await new Promise<any>((resolve) => hostSocket.emit("lobby:reconnect", { playerId: host.id }, resolve));
      await new Promise<any>((resolve) => guestSocket.emit("lobby:join", { playerName: "Bob" }, resolve));

      const guestStart = await new Promise<any>((resolve) => guestSocket.emit("draft:start", resolve));
      assert.deepEqual(guestStart, { ok: false, error: "Only the host can start the draft" });

      const guestCancel = await new Promise<any>((resolve) => guestSocket.emit("draft:cancel", resolve));
      assert.deepEqual(guestCancel, { ok: false, error: "Only the host can cancel the draft" });

      // Reset is only for a completed draft; that check comes first, even for the host.
      const guestReset = await new Promise<any>((resolve) => guestSocket.emit("lobby:reset", resolve));
      assert.deepEqual(guestReset, { ok: false, error: "No completed draft to reset" });
      const hostReset = await new Promise<any>((resolve) => hostSocket.emit("lobby:reset", resolve));
      assert.deepEqual(hostReset, { ok: false, error: "No completed draft to reset" });

      const hostStart = await new Promise<any>((resolve) => hostSocket.emit("draft:start", resolve));
      assert.deepEqual(hostStart, { ok: true });
      assert.equal(lobbyManager.getSession()!.status, "drafting");
    } finally {
      hostSocket.close();
      guestSocket.close();
      await server.close();
    }
  }
);

test(
  "privacy over a whole draft: each player only receives their own pool and deck, and a spectator neither",
  { timeout: 10_000 },
  async (t) => {
    lobbyManager.resetForTests(freshSnapshotPath());
    const server = await startServerFor(t);
    const cardIds = Array.from({ length: 8 }, (_, i) => `secret-${i}`);
    const { hostSocket, guestSocket, hostId, guestId } = await seatHostAndGuest(server, cardIds, { packCount: 2 });
    const spectatorSocket = await server.connect();

    function record(socket: DraftClientSocket) {
      const log = { myStates: [] as MyState[], deckExports: [] as DeckExport[], lobbyStates: [] as string[] };
      socket.on("draft:myState", (state) => log.myStates.push(state));
      socket.on("draft:complete", (deckExport) => log.deckExports.push(deckExport));
      socket.on("lobby:state", (state) => log.lobbyStates.push(JSON.stringify(state)));
      return log;
    }
    const hostLog = record(hostSocket);
    const guestLog = record(guestSocket);
    const spectatorLog = record(spectatorSocket);
    // Each socket's events arrive in order, and the final lobby:state is the
    // last thing every socket is sent, so once it lands nothing else is coming.
    const allComplete = Promise.all(
      [hostSocket, guestSocket, spectatorSocket].map((s) => waitForLobbyStateWhere(s, (v) => v.status === "complete"))
    );

    assert.deepEqual(await hostSocket.emitWithAck("draft:start"), { ok: true });
    while (lobbyManager.getSession()!.status === "drafting") {
      for (const [socket, playerId] of [[hostSocket, hostId], [guestSocket, guestId]] as const) {
        assert.deepEqual(await socket.emitWithAck("draft:pick", { scryfallId: firstCardInPack(playerId) }), { ok: true });
      }
    }
    await allComplete;

    const finalPools = lobbyManager.getSession()!.pools;
    for (const [log, playerId] of [[hostLog, hostId], [guestLog, guestId]] as const) {
      const finalPool = finalPools[playerId]!;
      assert.equal(finalPool.length, 4);
      for (const state of log.myStates) {
        assert.deepEqual(state.pool, finalPool.slice(0, state.pool.length), "a pool update belonged to someone else");
      }
      // The final round's picks only reach the client through this last update.
      assert.deepEqual(log.myStates.at(-1), { pack: null, pool: finalPool });
      assert.deepEqual(log.deckExports.map((e) => e.playerId), [playerId]);
    }
    assert.deepEqual(spectatorLog.myStates, []);
    assert.deepEqual(spectatorLog.deckExports, []);
    for (const wire of [...hostLog.lobbyStates, ...guestLog.lobbyStates, ...spectatorLog.lobbyStates]) {
      assert.ok(!wire.includes("secret-"), `lobby:state leaked card contents: ${wire}`);
    }
  }
);

test("only a seated player can pick, and only from the pack they hold", { timeout: 10_000 }, async (t) => {
  lobbyManager.resetForTests(freshSnapshotPath());
  const server = await startServerFor(t);
  const { hostSocket, guestSocket, hostId, guestId } = await seatHostAndGuest(server, ["c1", "c2", "c3", "c4"]);
  assert.deepEqual(await hostSocket.emitWithAck("draft:start"), { ok: true });
  const hostCard = firstCardInPack(hostId);

  const spectatorSocket = await server.connect();
  assert.deepEqual(await spectatorSocket.emitWithAck("draft:pick", { scryfallId: hostCard }), {
    ok: false,
    error: "Not joined to this draft",
  });
  assert.deepEqual(await guestSocket.emitWithAck("draft:pick", { scryfallId: hostCard }), {
    ok: false,
    error: `Card ${hostCard} is not in player ${guestId}'s current pack`,
  });

  const session = lobbyManager.getSession()!;
  assert.equal(firstCardInPack(hostId), hostCard, "the host still holds the card");
  assert.deepEqual(session.pools[guestId], []);
  assert.deepEqual(session.waitingOn.slice().sort(), [hostId, guestId].sort());
});

test(
  "a dropped player shows as disconnected until they reconnect, and unknown ids can't reconnect",
  { timeout: 10_000 },
  async (t) => {
    lobbyManager.resetForTests(freshSnapshotPath());
    const server = await startServerFor(t);
    const { hostSocket, guestSocket, guestId } = await seatHostAndGuest(server, ["c1", "c2", "c3", "c4"]);
    const guestConnected = (state: LobbyStateView) => state.players.find((p) => p.id === guestId)?.connected;

    const dropped = waitForLobbyStateWhere(hostSocket, (s) => guestConnected(s) === false);
    guestSocket.close();
    await dropped;
    assert.equal(lobbyManager.getSession()!.players.length, 2, "the seat is kept for them");

    const newGuestSocket = await server.connect();
    assert.deepEqual(await newGuestSocket.emitWithAck("lobby:reconnect", { playerId: "not-a-player" }), {
      ok: false,
      error: "No matching player found for this draft",
    });
    const back = waitForLobbyStateWhere(hostSocket, (s) => guestConnected(s) === true);
    assert.deepEqual(await newGuestSocket.emitWithAck("lobby:reconnect", { playerId: guestId }), { ok: true });
    await back;
  }
);

test("the host can cancel a draft in progress, which sends everyone back to an empty server", { timeout: 10_000 }, async (t) => {
  lobbyManager.resetForTests(freshSnapshotPath());
  const server = await startServerFor(t);
  const { hostSocket, guestSocket, guestId } = await seatHostAndGuest(server, ["c1", "c2", "c3", "c4"]);
  assert.deepEqual(await hostSocket.emitWithAck("draft:start"), { ok: true });
  const guestCard = firstCardInPack(guestId);

  const everyoneEmpty = Promise.all(
    [hostSocket, guestSocket].map((s) => waitForLobbyStateWhere(s, (v) => v.status === "empty"))
  );
  assert.deepEqual(await hostSocket.emitWithAck("draft:cancel"), { ok: true });
  await everyoneEmpty;

  assert.deepEqual(await guestSocket.emitWithAck("draft:pick", { scryfallId: guestCard }), {
    ok: false,
    error: "No lobby has been created yet",
  });
  assert.deepEqual(await guestSocket.emitWithAck("lobby:reconnect", { playerId: guestId }), {
    ok: false,
    error: "No matching player found for this draft",
  });
});

test("after a finished draft, only the host can reset the server", { timeout: 10_000 }, async (t) => {
  lobbyManager.resetForTests(freshSnapshotPath());
  const server = await startServerFor(t);
  const { hostSocket, guestSocket, hostId, guestId } = await seatHostAndGuest(server, ["c1", "c2"], { packSize: 1 });
  assert.deepEqual(await hostSocket.emitWithAck("draft:start"), { ok: true });
  await hostSocket.emitWithAck("draft:pick", { scryfallId: firstCardInPack(hostId) });
  await guestSocket.emitWithAck("draft:pick", { scryfallId: firstCardInPack(guestId) });
  assert.equal(lobbyManager.getSession()!.status, "complete");

  assert.deepEqual(await hostSocket.emitWithAck("draft:cancel"), { ok: false, error: "No draft in progress to cancel" });
  assert.deepEqual(await guestSocket.emitWithAck("lobby:reset"), { ok: false, error: "Only the host can reset the draft" });
  assert.equal(lobbyManager.getSession()!.status, "complete");

  const guestSeesEmpty = waitForLobbyStateWhere(guestSocket, (s) => s.status === "empty");
  assert.deepEqual(await hostSocket.emitWithAck("lobby:reset"), { ok: true });
  await guestSeesEmpty;
  assert.equal(lobbyManager.getSession(), undefined);
});

test(
  "reconnecting after the draft finished brings back the full pool, last pick included, and the player's own deck",
  { timeout: 10_000 },
  async (t) => {
    lobbyManager.resetForTests(freshSnapshotPath());
    const server = await startServerFor(t);
    const { hostSocket, guestSocket, hostId, guestId } = await seatHostAndGuest(server, ["c1", "c2", "c3", "c4"], {
      packCount: 2,
      packSize: 1,
    });
    assert.deepEqual(await hostSocket.emitWithAck("draft:start"), { ok: true });
    // Each player's draft:complete follows the final pick's ack; wait for them so they aren't mistaken for
    // what the reconnect sends.
    const completed = Promise.all([waitForDeckExport(hostSocket), waitForDeckExport(guestSocket)]);
    for (let round = 0; round < 2; round++) {
      await hostSocket.emitWithAck("draft:pick", { scryfallId: firstCardInPack(hostId) });
      await guestSocket.emitWithAck("draft:pick", { scryfallId: firstCardInPack(guestId) });
    }
    await completed;
    const session = lobbyManager.getSession()!;
    assert.equal(session.status, "complete");
    const guestPool = session.pools[guestId]!.map((c) => c.scryfallId);
    assert.equal(guestPool.length, 2);

    guestSocket.close();
    const hostReceived: string[] = [];
    hostSocket.on("draft:myState", () => hostReceived.push("draft:myState"));
    hostSocket.on("draft:complete", () => hostReceived.push("draft:complete"));

    const newGuestSocket = await server.connect();
    const myState = waitForMyState(newGuestSocket);
    const deckExport = waitForDeckExport(newGuestSocket);
    assert.deepEqual(await newGuestSocket.emitWithAck("lobby:reconnect", { playerId: guestId }), { ok: true });

    assert.deepEqual(await myState, { pack: null, pool: session.pools[guestId] });
    const deck = await deckExport;
    assert.equal(deck.playerId, guestId);
    assert.deepEqual(deck.cards.map((c) => c.scryfallId).sort(), [...guestPool].sort());
    assert.deepEqual(hostReceived, [], "the host's socket gets nothing of the guest's");
  }
);

test("with a lobby password set, only connections presenting it get in", { timeout: 10_000 }, async (t) => {
  lobbyManager.resetForTests(freshSnapshotPath());
  const server = await startServerFor(t, { lobbyPassword: "hunter2" });

  assert.equal(await connectionRefusal(server.url), "invalid_password");
  assert.equal(await connectionRefusal(server.url, { password: "wrong" }), "invalid_password");

  // Admitted sockets reach the handlers: there's just no lobby to join yet.
  const socket = await server.connect({ password: "hunter2" });
  assert.deepEqual(await socket.emitWithAck("lobby:join", { playerName: "Bob" }), {
    ok: false,
    error: "No lobby has been created yet",
  });
});

test("without a lobby password, connections get in whatever they present", { timeout: 10_000 }, async (t) => {
  lobbyManager.resetForTests(freshSnapshotPath());
  const server = await startServerFor(t);

  const socket = await server.connect({ password: "anything" });
  assert.deepEqual(await socket.emitWithAck("lobby:join", { playerName: "Bob" }), {
    ok: false,
    error: "No lobby has been created yet",
  });
});
