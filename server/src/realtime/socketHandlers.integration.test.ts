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
  DraftSummary,
  LobbyStateView,
  Pack,
  ServerToClientEvents,
} from "@draft-simulator/shared";
import { testCard } from "../draftEngine/testHelpers.js";
import * as lobbyManager from "../session/lobbyManager.js";
import { requireLobbyPassword } from "./lobbyPassword.js";
import { closeDraft, registerSocketHandlers, releaseSeatAsHost } from "./socketHandlers.js";

/**
 * End-to-end tests of the real socket wiring. The first three need internet
 * access (they import a real CubeCobra cube) and an already-populated local
 * card cache (`npm run import-cards --workspace server`); every later test
 * builds its lobby from local test cards and runs offline.
 */

type DraftClientSocket = ClientSocket<ServerToClientEvents, ClientToServerEvents>;
type MyState = { pack: Pack | null; pool: Card[] };

const REAL_CUBE = "https://cubecobra.com/cube/overview/practical";

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
 * Resolves with the draft:myState of the round that begins at `pickNumber`.
 * A pick can produce two updates with the same pool size for one player: an
 * instant one the moment their own pick lands (pack mid-round), and the new
 * round's once everyone has picked. The server sends the new round's update
 * before the lobby:state that moves to the next pick, on the same socket, so
 * the last update before that lobby state is the right one. This used to
 * take the last update seen within 100ms instead, and on a slow CI runner
 * the window closed before any update arrived.
 */
function waitForRoundState(socket: DraftClientSocket, pickNumber: number): Promise<MyState> {
  return new Promise((resolve, reject) => {
    let latest: MyState | undefined;
    function onMyState(payload: MyState) {
      latest = payload;
    }
    function onLobbyState(state: LobbyStateView) {
      if (state.currentPickNumber !== pickNumber) return;
      socket.off("draft:myState", onMyState);
      socket.off("lobby:state", onLobbyState);
      if (latest) resolve(latest);
      else reject(new Error(`pick ${pickNumber} began without a draft:myState`));
    }
    socket.on("draft:myState", onMyState);
    socket.on("lobby:state", onLobbyState);
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

function waitForDraftListWhere(
  socket: DraftClientSocket,
  predicate: (drafts: DraftSummary[]) => boolean
): Promise<DraftSummary[]> {
  return new Promise((resolve) => {
    function onList(drafts: DraftSummary[]) {
      if (!predicate(drafts)) return;
      socket.off("drafts:list", onList);
      resolve(drafts);
    }
    socket.on("drafts:list", onList);
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

type TestServer = Awaited<ReturnType<typeof startServerFor>>;

/** A lobby built from local test cards, without the network. Returns its id. */
function createTestLobby(cardIds: string[], settings: Partial<DraftSettings> = {}, cubeName = "Test Cube"): string {
  return lobbyManager.createLobbyFromResolvedCube(cubeName, cardIds.map(testCard), [], {
    cubeId: "test",
    packCount: 1,
    packSize: 2,
    alternatingDraft: true,
    ...settings,
  }).draftId;
}

/**
 * Network-free setup: a lobby built from local test cards, which the host and a guest join over real sockets. The
 * host joins first, so they're its creator.
 */
async function seatHostAndGuest(server: TestServer, cardIds: string[], settings: Partial<DraftSettings> = {}) {
  const draftId = createTestLobby(cardIds, settings);
  const hostSocket = await server.connect();
  const guestSocket = await server.connect();
  const hostJoin = await hostSocket.emitWithAck("lobby:join", { draftId, playerName: "Alice" });
  assert.ok(hostJoin.ok, JSON.stringify(hostJoin));
  const guestJoin = await guestSocket.emitWithAck("lobby:join", { draftId, playerName: "Bob" });
  assert.ok(guestJoin.ok, JSON.stringify(guestJoin));
  return {
    draftId,
    hostSocket,
    guestSocket,
    hostId: hostJoin.playerId,
    guestId: guestJoin.playerId,
    hostToken: hostJoin.seatToken,
    guestToken: guestJoin.seatToken,
  };
}

/** The first card in a player's current pack, read from the server's own state. */
function firstCardInPack(draftId: string, playerId: string): string {
  return lobbyManager.getSession(draftId)!.currentPacks[playerId]!.cards[0]!.scryfallId;
}

/** A real cube's draft, created over the socket by `creator`, and a guest seated in it. */
async function createRealCubeDraft(creator: DraftClientSocket, guest: DraftClientSocket, packSize: number) {
  const created = await creator.emitWithAck("draft:create", {
    playerName: "Alice",
    cubeIdOrUrl: REAL_CUBE,
    packCount: 1,
    packSize,
    alternatingDraft: true,
  });
  assert.ok(created.ok, JSON.stringify(created));
  assert.ok(lobbyManager.getCubeMeta(created.draftId)!.cardCount > 0);
  const joined = await guest.emitWithAck("lobby:join", { draftId: created.draftId, playerName: "Bob" });
  assert.ok(joined.ok, JSON.stringify(joined));
  return { draftId: created.draftId, hostId: created.playerId, guestId: joined.playerId, guestToken: joined.seatToken };
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
      const guestSeesDraft = waitForDraftListWhere(guestSocket, (drafts) => drafts.length === 1);
      const { hostId, guestId } = await createRealCubeDraft(hostSocket, guestSocket, 3);
      assert.equal((await guestSeesDraft)[0]!.status, "lobby");

      const hostStatePromise = waitForMyState(hostSocket);
      const guestStatePromise = waitForMyState(guestSocket);

      assert.deepEqual(await hostSocket.emitWithAck("draft:start"), { ok: true });

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
        const nextHostState = isLastRound ? undefined : waitForRoundState(hostSocket, round + 2);
        const nextGuestState = isLastRound ? undefined : waitForRoundState(guestSocket, round + 2);

        const hostPick: string = hostState.pack!.cards[0]!.scryfallId;
        const guestPick: string = guestState.pack!.cards[0]!.scryfallId;

        const [hostPickResult, guestPickResult] = await Promise.all([
          hostSocket.emitWithAck("draft:pick", { scryfallId: hostPick }),
          guestSocket.emitWithAck("draft:pick", { scryfallId: guestPick }),
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
      const { draftId, guestId, guestToken } = await createRealCubeDraft(hostSocket, guestSocket, 2);

      const hostStatePromise = waitForMyState(hostSocket);
      const guestStatePromise = waitForMyState(guestSocket);
      assert.deepEqual(await hostSocket.emitWithAck("draft:start"), { ok: true });
      const hostStateBeforeDrop = await hostStatePromise;
      const guestStateBeforeDrop = await guestStatePromise;
      assert.equal(guestStateBeforeDrop.pack?.cards.length, 2);
      assert.equal(guestStateBeforeDrop.pool.length, 0);

      // Host picks from their own pack; guest hasn't picked yet, so the round
      // hasn't advanced — guest's pack/pool should still be exactly what they
      // started with.
      const hostPickResult = await hostSocket.emitWithAck("draft:pick", {
        scryfallId: hostStateBeforeDrop.pack!.cards[0]!.scryfallId,
      });
      assert.equal(hostPickResult.ok, true, JSON.stringify(hostPickResult));

      // Simulate the guest's browser dropping and reconnecting: close the old
      // socket, open a fresh one, and re-attach via lobby:reconnect.
      guestSocket.close();
      await new Promise((resolve) => setTimeout(resolve, 100));

      guestSocket = await connect(server.url);
      const reconnectStatePromise = waitForMyState(guestSocket);
      const reconnectResult = await guestSocket.emitWithAck("lobby:reconnect", { draftId, playerId: guestId, seatToken: guestToken });
      assert.equal(reconnectResult.ok, true, JSON.stringify(reconnectResult));

      const resumedState = await reconnectStatePromise;
      assert.equal(resumedState.pool.length, 0, "guest hadn't picked yet, so pool should still be empty");
      assert.deepEqual(
        resumedState.pack?.cards.map((c) => c.scryfallId).sort(),
        guestStateBeforeDrop.pack!.cards.map((c) => c.scryfallId).sort(),
        "reconnect should resume the exact same pack the guest had before dropping"
      );

      // And the reconnected socket should be fully functional, not just read-only.
      const guestPickResult = await guestSocket.emitWithAck("draft:pick", {
        scryfallId: resumedState.pack!.cards[0]!.scryfallId,
      });
      assert.equal(guestPickResult.ok, true, JSON.stringify(guestPickResult));
    } finally {
      hostSocket.close();
      guestSocket.close();
      await server.close();
    }
  }
);

test(
  "rejoin mid-draft: the same seat taken from another tab, with its token, evicts the old session",
  { timeout: 30_000 },
  async () => {
    lobbyManager.resetForTests(freshSnapshotPath());

    const server = await startTestServer();
    const hostSocket = await connect(server.url);
    const guestSocket = await connect(server.url);
    let secondGuestSocket: DraftClientSocket | undefined;

    try {
      const { draftId, guestId, guestToken } = await createRealCubeDraft(hostSocket, guestSocket, 2);

      const hostStatePromise = waitForMyState(hostSocket);
      const guestStatePromise = waitForMyState(guestSocket);
      assert.deepEqual(await hostSocket.emitWithAck("draft:start"), { ok: true });
      await hostStatePromise;
      const guestStateBeforeRejoin = await guestStatePromise;

      // A second tab/browser picks "Bob" from the rejoin list while the
      // original guest socket is still very much connected.
      const evictionPromise = waitForEviction(guestSocket);
      const staleDisconnectPromise = waitForDisconnect(guestSocket);

      secondGuestSocket = await connect(server.url);
      const rejoinStatePromise = waitForMyState(secondGuestSocket);
      const rejoinResult = await secondGuestSocket.emitWithAck("lobby:reconnect", {
        draftId,
        playerId: guestId,
        seatToken: guestToken,
      });
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
      const secondPickResult = await secondGuestSocket.emitWithAck("draft:pick", {
        scryfallId: rejoinState.pack!.cards[0]!.scryfallId,
      });
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

test("draft:create refuses a blank name or bad settings, and opens no draft", { timeout: 10_000 }, async (t) => {
  lobbyManager.resetForTests(freshSnapshotPath());
  const fetchMock = t.mock.method(globalThis, "fetch", async () => {
    throw new Error("unexpected network call");
  });
  const server = await startServerFor(t);
  const socket = await server.connect();
  const cube = { cubeIdOrUrl: "some-cube", packCount: 3, packSize: 15, alternatingDraft: true };

  assert.deepEqual(await socket.emitWithAck("draft:create", { ...cube, playerName: "   " }), {
    ok: false,
    error: "Player name is required",
  });
  assert.deepEqual(await socket.emitWithAck("draft:create", { ...cube, playerName: "x".repeat(41) }), {
    ok: false,
    error: "Player names can be at most 40 characters",
  });
  assert.deepEqual(await socket.emitWithAck("draft:create", { ...cube, playerName: "Alice", packCount: 1e9 }), {
    ok: false,
    error: "A draft can have at most 10 packs per player",
  });
  assert.deepEqual(await socket.emitWithAck("draft:create", { ...cube, playerName: "Alice", cubeIdOrUrl: " " }), {
    ok: false,
    error: "Cube URL or ID is required",
  });
  assert.deepEqual(await socket.emitWithAck("draft:create", { ...cube, playerName: "Alice", packCount: 0 }), {
    ok: false,
    error: "Need at least 1 pack",
  });
  assert.deepEqual(
    await socket.emitWithAck("draft:create", { ...cube, playerName: "Alice", format: "chaos" as never }),
    { ok: false, error: 'Unknown draft format "chaos"' }
  );
  assert.deepEqual(await socket.emitWithAck("draft:create", { ...cube, playerName: "Alice", setCode: "fra" }), {
    ok: false,
    error: "Choose a cube or a set, not both",
  });
  assert.equal(fetchMock.mock.callCount(), 0);
  assert.deepEqual(lobbyManager.listDrafts(), []);
});

test(
  "round advance: each player's new pack arrives before the lobby state that makes it their turn",
  { timeout: 30_000 },
  async () => {
    // Network-free: the lobby is built from local test cards, then both
    // players attach over real sockets.
    lobbyManager.resetForTests(freshSnapshotPath());
    const draftId = createTestLobby(["c1", "c2", "c3", "c4"]);
    const host = lobbyManager.addPlayer(draftId, "Alice");

    const server = await startTestServer();
    const hostSocket = await connect(server.url);
    const guestSocket = await connect(server.url);

    try {
      const rejoin = await hostSocket.emitWithAck("lobby:reconnect", { draftId, playerId: host.id });
      assert.equal(rejoin.ok, true, JSON.stringify(rejoin));
      const join = await guestSocket.emitWithAck("lobby:join", { draftId, playerName: "Bob" });
      assert.ok(join.ok, JSON.stringify(join));

      const hostStart = waitForMyState(hostSocket);
      const guestStart = waitForMyState(guestSocket);
      assert.deepEqual(await hostSocket.emitWithAck("draft:start"), { ok: true });
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

      await hostSocket.emitWithAck("draft:pick", { scryfallId: hostPack.cards[0]!.scryfallId });
      await guestSocket.emitWithAck("draft:pick", { scryfallId: guestPack.cards[0]!.scryfallId });
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
  "starting the draft sends each player their pack before the lobby state that says drafting",
  { timeout: 10_000 },
  async (t) => {
    lobbyManager.resetForTests(freshSnapshotPath());
    const server = await startServerFor(t);
    const { hostSocket, guestSocket } = await seatHostAndGuest(server, ["c1", "c2", "c3", "c4"]);

    function record(socket: DraftClientSocket): string[] {
      const events: string[] = [];
      socket.on("draft:myState", () => events.push("draft:myState"));
      // The join broadcasts can still be arriving; only the start's lobby state counts.
      socket.on("lobby:state", (state) => {
        if (state.status === "drafting") events.push("lobby:state drafting");
      });
      return events;
    }
    const logs = [record(hostSocket), record(guestSocket)];
    const bothDrafting = Promise.all(
      [hostSocket, guestSocket].map((s) => waitForLobbyStateWhere(s, (v) => v.status === "drafting"))
    );

    assert.deepEqual(await hostSocket.emitWithAck("draft:start"), { ok: true });
    await bothDrafting;
    for (const events of logs) assert.deepEqual(events, ["draft:myState", "lobby:state drafting"]);
  }
);

test(
  "only the draft's creator can start it, once two players are seated, or close it",
  { timeout: 10_000 },
  async (t) => {
    lobbyManager.resetForTests(freshSnapshotPath());
    const server = await startServerFor(t);
    const draftId = createTestLobby(["c1", "c2"], { packSize: 1 });
    const hostSocket = await server.connect();
    const spectatorSocket = await server.connect();
    assert.deepEqual(await spectatorSocket.emitWithAck("draft:start"), { ok: false, error: "Not joined to this draft" });
    assert.deepEqual(await spectatorSocket.emitWithAck("draft:close"), { ok: false, error: "Not joined to this draft" });

    const hostJoin = await hostSocket.emitWithAck("lobby:join", { draftId, playerName: "Alice" });
    assert.ok(hostJoin.ok, JSON.stringify(hostJoin));
    assert.deepEqual(await hostSocket.emitWithAck("draft:start"), {
      ok: false,
      error: "Need at least 2 players to start",
    });
    assert.equal(lobbyManager.getSession(draftId)!.status, "lobby");

    const guestSocket = await server.connect();
    const guestJoin = await guestSocket.emitWithAck("lobby:join", { draftId, playerName: "Bob" });
    assert.ok(guestJoin.ok, JSON.stringify(guestJoin));
    const notCreator = { ok: false, error: "Only the player who created this draft can do that" };
    assert.deepEqual(await guestSocket.emitWithAck("draft:start"), notCreator);
    assert.deepEqual(await guestSocket.emitWithAck("draft:close"), notCreator);
    assert.equal(lobbyManager.getSession(draftId)!.status, "lobby");

    assert.deepEqual(await hostSocket.emitWithAck("draft:start"), { ok: true });
    await hostSocket.emitWithAck("draft:pick", { scryfallId: firstCardInPack(draftId, hostJoin.playerId) });
    await guestSocket.emitWithAck("draft:pick", { scryfallId: firstCardInPack(draftId, guestJoin.playerId) });
    assert.equal(lobbyManager.getSession(draftId)!.status, "complete");

    // A finished draft stays for deck building until its creator closes it.
    assert.deepEqual(await guestSocket.emitWithAck("draft:close"), notCreator);
    assert.deepEqual(await hostSocket.emitWithAck("draft:close"), { ok: true });
    assert.equal(lobbyManager.getSession(draftId), undefined);
  }
);

test(
  "two drafts at once: each one's lobby state, packs and picks reach only its own players",
  { timeout: 10_000 },
  async (t) => {
    lobbyManager.resetForTests(freshSnapshotPath());
    const server = await startServerFor(t);
    const first = await seatHostAndGuest(server, ["a1", "a2", "a3", "a4"].map((id) => `secret-first-${id}`));
    const second = await seatHostAndGuest(server, ["b1", "b2", "b3", "b4"].map((id) => `secret-second-${id}`));
    const onlookerSocket = await server.connect();

    function record(socket: DraftClientSocket) {
      const log = { wires: [] as string[], lobbyStates: [] as LobbyStateView[] };
      for (const event of ["lobby:state", "draft:myState", "draft:complete"] as const) {
        socket.on(event, (payload: unknown) => {
          log.wires.push(JSON.stringify(payload));
          if (event === "lobby:state") log.lobbyStates.push(payload as LobbyStateView);
        });
      }
      return log;
    }
    const firstLogs = [record(first.hostSocket), record(first.guestSocket)];
    const secondLogs = [record(second.hostSocket), record(second.guestSocket)];
    const onlookerLog = record(onlookerSocket);

    const firstComplete = Promise.all(
      [first.hostSocket, first.guestSocket].map((s) => waitForLobbyStateWhere(s, (v) => v.status === "complete"))
    );
    const secondDrafting = Promise.all(
      [second.hostSocket, second.guestSocket].map((s) => waitForLobbyStateWhere(s, (v) => v.status === "drafting"))
    );
    assert.deepEqual(await first.hostSocket.emitWithAck("draft:start"), { ok: true });
    assert.deepEqual(await second.hostSocket.emitWithAck("draft:start"), { ok: true });
    await secondDrafting;
    for (let round = 0; round < 2; round++) {
      for (const [socket, playerId] of [[first.hostSocket, first.hostId], [first.guestSocket, first.guestId]] as const) {
        const scryfallId = firstCardInPack(first.draftId, playerId);
        assert.deepEqual(await socket.emitWithAck("draft:pick", { scryfallId }), { ok: true });
      }
    }
    await firstComplete;

    assert.equal(lobbyManager.getSession(second.draftId)!.status, "drafting", "the other draft is still going");
    assert.deepEqual(lobbyManager.getSession(second.draftId)!.picks, []);
    for (const log of firstLogs) {
      assert.ok(log.lobbyStates.every((s) => s.sessionId === first.draftId));
      assert.ok(log.wires.every((wire) => !wire.includes("secret-second")), "the first draft saw the second's cards");
    }
    for (const log of secondLogs) {
      assert.ok(log.lobbyStates.every((s) => s.sessionId === second.draftId));
      assert.ok(log.wires.every((wire) => !wire.includes("secret-first")), "the second draft saw the first's cards");
    }
    assert.deepEqual(onlookerLog.wires, [], "a browser that isn't seated gets no draft's state");
  }
);

test("the draft list reaches every browser, seated or not, and follows each draft's status", { timeout: 10_000 }, async (t) => {
  lobbyManager.resetForTests(freshSnapshotPath());
  const server = await startServerFor(t);
  const older = createTestLobby(["c1", "c2", "c3", "c4"], { packSize: 1 }, "Older Cube");
  createTestLobby(["d1", "d2"], {}, "Newer Cube");

  // The list is sent the moment the socket connects, so the listener goes on before it does.
  const onlookerSocket: DraftClientSocket = ioClient(server.url, { forceNew: true, autoConnect: false });
  t.after(() => onlookerSocket.close());
  const firstList = new Promise<DraftSummary[]>((resolve) => onlookerSocket.once("drafts:list", resolve));
  onlookerSocket.connect();
  const onConnect = await firstList;
  assert.deepEqual(onConnect.map((d) => [d.cubeName, d.status, d.players.length]), [
    ["Newer Cube", "lobby", 0],
    ["Older Cube", "lobby", 0],
  ]);

  const hostSocket = await server.connect();
  const guestSocket = await server.connect();
  const seated = waitForDraftListWhere(onlookerSocket, (drafts) => drafts[1]!.players.length === 2);
  const hostJoin = await hostSocket.emitWithAck("lobby:join", { draftId: older, playerName: "Alice" });
  const guestJoin = await guestSocket.emitWithAck("lobby:join", { draftId: older, playerName: "Bob" });
  assert.ok(hostJoin.ok && guestJoin.ok);
  const afterJoins = await seated;
  assert.deepEqual(afterJoins[1]!.players.map((p) => p.name), ["Alice", "Bob"]);
  assert.equal(afterJoins[1]!.creatorPlayerId, hostJoin.playerId);

  const drafting = waitForDraftListWhere(onlookerSocket, (drafts) => drafts[1]!.status === "drafting");
  assert.deepEqual(await hostSocket.emitWithAck("draft:start"), { ok: true });
  await drafting;
  const complete = waitForDraftListWhere(onlookerSocket, (drafts) => drafts[1]!.status === "complete");
  await hostSocket.emitWithAck("draft:pick", { scryfallId: firstCardInPack(older, hostJoin.playerId) });
  await guestSocket.emitWithAck("draft:pick", { scryfallId: firstCardInPack(older, guestJoin.playerId) });
  await complete;

  const dropped = waitForDraftListWhere(onlookerSocket, (drafts) => drafts[1]!.players[1]!.connected === false);
  guestSocket.close();
  await dropped;
});

test("privacy over a whole draft: each player only receives their own pool and deck, and a spectator neither", { timeout: 10_000 }, async (t) => {
  lobbyManager.resetForTests(freshSnapshotPath());
  const server = await startServerFor(t);
  const cardIds = Array.from({ length: 8 }, (_, i) => `secret-${i}`);
  const { draftId, hostSocket, guestSocket, hostId, guestId } = await seatHostAndGuest(server, cardIds, {
    packCount: 2,
  });
  const spectatorSocket = await server.connect();

  function record(socket: DraftClientSocket) {
    const log = { myStates: [] as MyState[], deckExports: [] as DeckExport[], wires: [] as string[] };
    socket.on("draft:myState", (state) => log.myStates.push(state));
    socket.on("draft:complete", (deckExport) => log.deckExports.push(deckExport));
    socket.on("lobby:state", (state) => log.wires.push(JSON.stringify(state)));
    socket.on("drafts:list", (drafts) => log.wires.push(JSON.stringify(drafts)));
    return log;
  }
  const hostLog = record(hostSocket);
  const guestLog = record(guestSocket);
  const spectatorLog = record(spectatorSocket);
  // Each socket's events arrive in order, and the final draft list is the last
  // thing every socket is sent, so once it lands nothing else is coming.
  const allComplete = Promise.all(
    [hostSocket, guestSocket, spectatorSocket].map((s) =>
      waitForDraftListWhere(s, (drafts) => drafts[0]?.status === "complete")
    )
  );

  assert.deepEqual(await hostSocket.emitWithAck("draft:start"), { ok: true });
  while (lobbyManager.getSession(draftId)!.status === "drafting") {
    for (const [socket, playerId] of [[hostSocket, hostId], [guestSocket, guestId]] as const) {
      assert.deepEqual(
        await socket.emitWithAck("draft:pick", { scryfallId: firstCardInPack(draftId, playerId) }),
        { ok: true }
      );
    }
  }
  await allComplete;

  const finalPools = lobbyManager.getSession(draftId)!.pools;
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
  for (const wire of [...hostLog.wires, ...guestLog.wires, ...spectatorLog.wires]) {
    assert.ok(!wire.includes("secret-"), `a public event leaked card contents: ${wire}`);
  }
});

test("only a seated player can pick, and only from the pack they hold", { timeout: 10_000 }, async (t) => {
  lobbyManager.resetForTests(freshSnapshotPath());
  const server = await startServerFor(t);
  const { draftId, hostSocket, guestSocket, hostId, guestId } = await seatHostAndGuest(server, ["c1", "c2", "c3", "c4"]);
  assert.deepEqual(await hostSocket.emitWithAck("draft:start"), { ok: true });
  const hostCard = firstCardInPack(draftId, hostId);

  const spectatorSocket = await server.connect();
  assert.deepEqual(await spectatorSocket.emitWithAck("draft:pick", { scryfallId: hostCard }), {
    ok: false,
    error: "Not joined to this draft",
  });
  assert.deepEqual(await guestSocket.emitWithAck("draft:pick", { scryfallId: hostCard }), {
    ok: false,
    error: `Card ${hostCard} is not in player ${guestId}'s current pack`,
  });

  const session = lobbyManager.getSession(draftId)!;
  assert.equal(firstCardInPack(draftId, hostId), hostCard, "the host still holds the card");
  assert.deepEqual(session.pools[guestId], []);
  assert.deepEqual(session.waitingOn.slice().sort(), [hostId, guestId].sort());
});

test(
  "a dropped player shows as disconnected until they reconnect, and unknown ids can't reconnect",
  { timeout: 10_000 },
  async (t) => {
    lobbyManager.resetForTests(freshSnapshotPath());
    const server = await startServerFor(t);
    const { draftId, hostSocket, guestSocket, guestId, guestToken } = await seatHostAndGuest(server, ["c1", "c2", "c3", "c4"]);
    const guestConnected = (state: LobbyStateView) => state.players.find((p) => p.id === guestId)?.connected;

    const dropped = waitForLobbyStateWhere(hostSocket, (s) => guestConnected(s) === false);
    guestSocket.close();
    await dropped;
    assert.equal(lobbyManager.getSession(draftId)!.players.length, 2, "the seat is kept for them");

    const newGuestSocket = await server.connect();
    const noMatch = { ok: false, error: "No matching player found for this draft" };
    assert.deepEqual(await newGuestSocket.emitWithAck("lobby:reconnect", { draftId, playerId: "not-a-player" }), noMatch);
    const otherDraft = createTestLobby(["d1", "d2"]);
    assert.deepEqual(
      await newGuestSocket.emitWithAck("lobby:reconnect", { draftId: otherDraft, playerId: guestId }),
      noMatch,
      "a player can only reconnect to their own draft"
    );
    const back = waitForLobbyStateWhere(hostSocket, (s) => guestConnected(s) === true);
    assert.deepEqual(
      await newGuestSocket.emitWithAck("lobby:reconnect", { draftId, playerId: guestId, seatToken: guestToken }),
      { ok: true, seatToken: guestToken }
    );
    await back;
  }
);

test(
  "leaving: a guest can leave before the start or once it's over, never during it; the creator can't",
  { timeout: 10_000 },
  async (t) => {
    lobbyManager.resetForTests(freshSnapshotPath());
    const server = await startServerFor(t);
    const { draftId, hostSocket, guestSocket, hostId } = await seatHostAndGuest(server, ["c1", "c2", "c3", "c4"], {
      packSize: 1,
    });

    assert.deepEqual(await hostSocket.emitWithAck("lobby:leave"), {
      ok: false,
      error: "You created this draft: close it instead",
    });
    const guestGone = waitForLobbyStateWhere(hostSocket, (s) => s.players.length === 1);
    assert.deepEqual(await guestSocket.emitWithAck("lobby:leave"), { ok: true });
    await guestGone;
    assert.deepEqual(await guestSocket.emitWithAck("lobby:cubeCards").then((r) => r.ok), false, "the seat is freed");

    const rejoin = await guestSocket.emitWithAck("lobby:join", { draftId, playerName: "Bob" });
    assert.ok(rejoin.ok, JSON.stringify(rejoin));
    assert.deepEqual(await hostSocket.emitWithAck("draft:start"), { ok: true });
    assert.deepEqual(await guestSocket.emitWithAck("lobby:leave"), {
      ok: false,
      error: "You can't leave a draft that's under way",
    });

    await hostSocket.emitWithAck("draft:pick", { scryfallId: firstCardInPack(draftId, hostId) });
    await guestSocket.emitWithAck("draft:pick", { scryfallId: firstCardInPack(draftId, rejoin.playerId) });
    assert.deepEqual(await guestSocket.emitWithAck("lobby:leave"), { ok: true });
    const session = lobbyManager.getSession(draftId)!;
    assert.deepEqual(session.players.map((p) => [p.name, p.connected]), [["Alice", true], ["Bob", false]]);
    assert.equal(session.pools[rejoin.playerId]!.length, 1, "a finished draft keeps their pool");
  }
);

test("anyone waiting can look through the cube, but a cube draft opens no sample pack", { timeout: 10_000 }, async (t) => {
  lobbyManager.resetForTests(freshSnapshotPath());
  const server = await startServerFor(t);
  const { guestSocket } = await seatHostAndGuest(server, ["c1", "c2", "c3", "c4"]);

  assert.deepEqual(await guestSocket.emitWithAck("lobby:cubeCards"), {
    ok: true,
    cubeName: "Test Cube",
    cards: ["c1", "c2", "c3", "c4"].map(testCard),
    unresolvedNames: [],
  });
  assert.deepEqual(await guestSocket.emitWithAck("lobby:samplePack"), {
    ok: false,
    error: "This draft deals from a cube, not a set draft's boosters",
  });
});

test(
  "closing a draft in progress tells its players and frees their seats; the host can close one too",
  { timeout: 10_000 },
  async (t) => {
    lobbyManager.resetForTests(freshSnapshotPath());
    const server = await startServerFor(t);
    const { draftId, hostSocket, guestSocket, guestId } = await seatHostAndGuest(server, ["c1", "c2", "c3", "c4"]);
    const other = await seatHostAndGuest(server, ["d1", "d2", "d3", "d4"]);
    assert.deepEqual(await hostSocket.emitWithAck("draft:start"), { ok: true });
    const guestCard = firstCardInPack(draftId, guestId);

    const closedFor = (socket: DraftClientSocket) =>
      new Promise<string>((resolve) => socket.once("draft:closed", resolve));
    const everyoneTold = Promise.all([hostSocket, guestSocket].map(closedFor));
    let otherTold = false;
    other.hostSocket.on("draft:closed", () => (otherTold = true));
    assert.deepEqual(await hostSocket.emitWithAck("draft:close"), { ok: true });
    assert.deepEqual(await everyoneTold, [draftId, draftId]);

    assert.deepEqual(await guestSocket.emitWithAck("draft:pick", { scryfallId: guestCard }), {
      ok: false,
      error: "Not joined to this draft",
    });
    assert.deepEqual(await guestSocket.emitWithAck("lobby:reconnect", { draftId, playerId: guestId }), {
      ok: false,
      error: "No matching player found for this draft",
    });

    const otherClosed = Promise.all([other.hostSocket, other.guestSocket].map(closedFor));
    assert.deepEqual(closeDraft(other.draftId), { ok: true });
    assert.deepEqual(await otherClosed, [other.draftId, other.draftId]);
    assert.equal(otherTold, true);
    assert.deepEqual(closeDraft(other.draftId), { ok: false, error: "This draft doesn't exist anymore" });
    assert.deepEqual(lobbyManager.listDrafts(), []);
  }
);

test(
  "reconnecting after the draft finished brings back the full pool, last pick included, and the player's own deck",
  { timeout: 10_000 },
  async (t) => {
    lobbyManager.resetForTests(freshSnapshotPath());
    const server = await startServerFor(t);
    const { draftId, hostSocket, guestSocket, hostId, guestId, guestToken } = await seatHostAndGuest(
      server,
      ["c1", "c2", "c3", "c4"],
      { packCount: 2, packSize: 1 }
    );
    assert.deepEqual(await hostSocket.emitWithAck("draft:start"), { ok: true });
    // Each player's draft:complete follows the final pick's ack; wait for them so they aren't mistaken for
    // what the reconnect sends.
    const completed = Promise.all([waitForDeckExport(hostSocket), waitForDeckExport(guestSocket)]);
    for (let round = 0; round < 2; round++) {
      await hostSocket.emitWithAck("draft:pick", { scryfallId: firstCardInPack(draftId, hostId) });
      await guestSocket.emitWithAck("draft:pick", { scryfallId: firstCardInPack(draftId, guestId) });
    }
    await completed;
    const session = lobbyManager.getSession(draftId)!;
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
    assert.deepEqual(
      await newGuestSocket.emitWithAck("lobby:reconnect", { draftId, playerId: guestId, seatToken: guestToken }),
      { ok: true, seatToken: guestToken }
    );

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

  // Admitted sockets reach the handlers: there's just no draft to join yet.
  const socket = await server.connect({ password: "hunter2" });
  assert.deepEqual(await socket.emitWithAck("lobby:join", { draftId: "none", playerName: "Bob" }), {
    ok: false,
    error: "This draft doesn't exist anymore",
  });
});

test("without a lobby password, connections get in whatever they present", { timeout: 10_000 }, async (t) => {
  lobbyManager.resetForTests(freshSnapshotPath());
  const server = await startServerFor(t);

  const socket = await server.connect({ password: "anything" });
  assert.deepEqual(await socket.emitWithAck("lobby:join", { draftId: "none", playerName: "Bob" }), {
    ok: false,
    error: "This draft doesn't exist anymore",
  });
});

test(
  "Winston draft: players take turns, only the active player sees a pile, and the draft ends with every card dealt",
  { timeout: 10_000 },
  async (t) => {
    lobbyManager.resetForTests(freshSnapshotPath());
    const server = await startServerFor(t);
    const cardIds = Array.from({ length: 8 }, (_, i) => `secret-${i + 1}`);
    const players = await seatHostAndGuest(server, cardIds, { format: "winston", packCount: 2, alternatingDraft: false });
    const { draftId } = players;
    const sockets = { [players.hostId]: players.hostSocket, [players.guestId]: players.guestSocket };
    const lobbyWires: string[] = [];
    const piles: Record<string, (Card[] | null | undefined)[]> = { [players.hostId]: [], [players.guestId]: [] };
    const deckExports: Record<string, DeckExport[]> = { [players.hostId]: [], [players.guestId]: [] };
    for (const [playerId, socket] of Object.entries(sockets)) {
      socket.on("lobby:state", (state) => lobbyWires.push(JSON.stringify(state)));
      socket.on("draft:myState", (state: MyState & { pile?: Card[] | null }) => piles[playerId]!.push(state.pile));
      socket.on("draft:complete", (deckExport) => deckExports[playerId]!.push(deckExport));
    }

    /** Sends a Winston action and waits until both players have the state it led to. */
    async function act(playerId: string, event: "winston:take" | "winston:pass", pileIndex: number) {
      const updated = Object.values(sockets).map((socket) => waitForLobbyState(socket));
      assert.deepEqual(await sockets[playerId]!.emitWithAck(event, { pileIndex }), { ok: true });
      await Promise.all(updated);
    }

    const started = Object.values(sockets).map((socket) => waitForLobbyState(socket));
    assert.deepEqual(await players.hostSocket.emitWithAck("draft:start"), { ok: true });
    await Promise.all(started);

    assert.deepEqual(await players.guestSocket.emitWithAck("winston:take", { pileIndex: 0 }), {
      ok: false,
      error: "It's not your turn",
    });
    assert.deepEqual(await players.hostSocket.emitWithAck("winston:take", { pileIndex: 1 }), {
      ok: false,
      error: "You're looking at pile 1, not pile 2",
    });

    for (let action = 0; lobbyManager.getSession(draftId)!.status === "drafting"; action++) {
      const session = lobbyManager.getSession(draftId)!;
      const table = session.winston!;
      const active = session.players[table.activeSeat]!.id;
      const inactive = active === players.hostId ? players.guestId : players.hostId;
      assert.deepEqual(piles[active]!.at(-1), table.piles[table.pileIndex], "the active player sees their pile");
      assert.equal(piles[inactive]!.at(-1), null, "the other player sees no pile");

      const canPass = table.stack.length > 0 || table.piles.slice(table.pileIndex + 1).some((p) => p.length > 0);
      await act(active, canPass && action % 2 === 0 ? "winston:pass" : "winston:take", table.pileIndex);
      assert.ok(action < 50, "the draft must end");
    }

    const pools = lobbyManager.getSession(draftId)!.pools;
    assert.deepEqual(
      [...pools[players.hostId]!, ...pools[players.guestId]!].map((c) => c.scryfallId).sort(),
      [...cardIds].sort()
    );
    assert.deepEqual(deckExports[players.hostId]!.map((e) => e.playerId), [players.hostId]);
    assert.deepEqual(deckExports[players.guestId]!.map((e) => e.playerId), [players.guestId]);
    for (const wire of lobbyWires) {
      assert.ok(!wire.includes("secret-"), `lobby:state leaked card contents: ${wire}`);
    }
  }
);

test("an event without an acknowledgement callback is dropped instead of crashing the server", { timeout: 10_000 }, async (t) => {
  lobbyManager.resetForTests(freshSnapshotPath());
  const server = await startServerFor(t);
  const socket = await server.connect();
  // Untyped, so it can send what the real client never would.
  const raw = socket as unknown as ClientSocket;

  raw.emit("lobby:leave");
  raw.emit("draft:pick", { scryfallId: "x" });
  raw.emit("lobby:cubeCards", { notA: "callback" });
  raw.emit("draft:create", { playerName: "Mallory", cubeIdOrUrl: " ", packCount: 3, packSize: 15 });
  raw.emit("winston:take", { pileIndex: 0 });

  // Still up, and still answering events that do carry a callback.
  assert.deepEqual(await socket.emitWithAck("lobby:leave"), { ok: false, error: "Not joined to this draft" });
});

test(
  "another browser can't take a seat by its public id, nor sign its player out, until the creator or the host releases it",
  { timeout: 10_000 },
  async (t) => {
    lobbyManager.resetForTests(freshSnapshotPath());
    const server = await startServerFor(t);
    const { draftId, hostSocket, guestSocket, hostId, guestId, guestToken } = await seatHostAndGuest(server, [
      "c1",
      "c2",
      "c3",
      "c4",
    ]);
    assert.deepEqual(await hostSocket.emitWithAck("draft:start"), { ok: true });
    let guestEvicted = false;
    guestSocket.on("identity:evicted", () => (guestEvicted = true));

    const intruder = await server.connect();
    const held = { ok: false, error: "This seat is held by another browser. Ask the draft's creator or the host to release it." };
    assert.deepEqual(await intruder.emitWithAck("lobby:reconnect", { draftId, playerId: guestId }), held);
    assert.deepEqual(await intruder.emitWithAck("lobby:reconnect", { draftId, playerId: guestId, seatToken: "guess" }), held);
    assert.deepEqual(await intruder.emitWithAck("draft:pick", { scryfallId: firstCardInPack(draftId, guestId) }), {
      ok: false,
      error: "Not joined to this draft",
    });
    assert.equal(guestEvicted, false, "a refused claim doesn't touch the player holding the seat");
    assert.equal(lobbyManager.getSession(draftId)!.players.find((p) => p.id === guestId)!.connected, true);

    // Only the creator releases seats, and not their own.
    assert.deepEqual(await guestSocket.emitWithAck("lobby:releaseSeat", { playerId: hostId }), {
      ok: false,
      error: "Only the player who created this draft can do that",
    });
    assert.deepEqual(await hostSocket.emitWithAck("lobby:releaseSeat", { playerId: hostId }), {
      ok: false,
      error: "You can't release your own seat",
    });
    assert.deepEqual(await intruder.emitWithAck("lobby:releaseSeat", { playerId: guestId }), {
      ok: false,
      error: "Not joined to this draft",
    });

    const released = waitForLobbyStateWhere(hostSocket, (s) => s.players.find((p) => p.id === guestId)?.claimable === true);
    assert.deepEqual(await hostSocket.emitWithAck("lobby:releaseSeat", { playerId: guestId }), { ok: true });
    await released;

    // Whoever claims it now gets it, with a new token; the old browser is signed out and its token is void.
    const evicted = waitForEviction(guestSocket);
    const claimed = await intruder.emitWithAck("lobby:reconnect", { draftId, playerId: guestId });
    assert.ok(claimed.ok, JSON.stringify(claimed));
    assert.notEqual(claimed.seatToken, guestToken);
    await evicted;
    const oldBrowser = await server.connect();
    assert.deepEqual(
      await oldBrowser.emitWithAck("lobby:reconnect", { draftId, playerId: guestId, seatToken: guestToken }),
      held
    );

    // The host can release any seat from the management UI, the creator's included.
    assert.deepEqual(releaseSeatAsHost(draftId, hostId), { ok: true });
    assert.equal(lobbyManager.isSeatClaimable(draftId, hostId), true);
    assert.deepEqual(releaseSeatAsHost(draftId, "nobody"), { ok: false, error: "No matching player found for this draft" });
    assert.deepEqual(releaseSeatAsHost("no-draft", hostId), { ok: false, error: "This draft doesn't exist anymore" });
  }
);
