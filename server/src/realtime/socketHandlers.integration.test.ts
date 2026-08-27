import assert from "node:assert/strict";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { Server } from "socket.io";
import { io as ioClient, type Socket as ClientSocket } from "socket.io-client";
import type {
  Card,
  ClientToServerEvents,
  DeckExport,
  LobbyStateView,
  Pack,
  ServerToClientEvents,
} from "@draft-simulator/shared";
import * as lobbyManager from "../session/lobbyManager.js";
import { registerSocketHandlers } from "./socketHandlers.js";

/**
 * End-to-end smoke test of the real socket wiring — the only test in this
 * project that needs internet access (it imports a real CubeCobra cube) and
 * an already-populated local card cache (`npm run import-cards --workspace
 * server`). Everything else is covered by network-free unit tests.
 */

type DraftClientSocket = ClientSocket<ServerToClientEvents, ClientToServerEvents>;
type MyState = { pack: Pack | null; pool: Card[] };

function freshSnapshotPath(): string {
  return path.join(os.tmpdir(), `draft-simulator-itest-${Date.now()}-${Math.random().toString(36).slice(2)}.json`);
}

async function startTestServer(): Promise<{ url: string; close: () => Promise<void> }> {
  const httpServer = createServer();
  const io = new Server<ClientToServerEvents, ServerToClientEvents>(httpServer);
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

function connect(url: string): Promise<DraftClientSocket> {
  return new Promise((resolve, reject) => {
    const socket: DraftClientSocket = ioClient(url, { forceNew: true });
    socket.once("connect", () => resolve(socket));
    socket.once("connect_error", reject);
  });
}

function waitForEvent<T>(socket: DraftClientSocket, event: "draft:myState" | "draft:complete"): Promise<T> {
  return new Promise((resolve) => {
    socket.once(event, (payload: T) => resolve(payload));
  });
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

      const hostStatePromise = waitForEvent<MyState>(hostSocket, "draft:myState");
      const guestStatePromise = waitForEvent<MyState>(guestSocket, "draft:myState");

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

      const hostExportPromise = waitForEvent<DeckExport>(hostSocket, "draft:complete");
      const guestExportPromise = waitForEvent<DeckExport>(guestSocket, "draft:complete");

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

      const hostStatePromise = waitForEvent<MyState>(hostSocket, "draft:myState");
      const guestStatePromise = waitForEvent<MyState>(guestSocket, "draft:myState");
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
      const reconnectStatePromise = waitForEvent<MyState>(guestSocket, "draft:myState");
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

      const hostStatePromise = waitForEvent<MyState>(hostSocket, "draft:myState");
      const guestStatePromise = waitForEvent<MyState>(guestSocket, "draft:myState");
      const startResult = await new Promise<any>((resolve) => hostSocket.emit("draft:start", resolve));
      assert.equal(startResult.ok, true, JSON.stringify(startResult));
      await hostStatePromise;
      const guestStateBeforeRejoin = await guestStatePromise;

      // A second tab/browser picks "Bob" from the rejoin list while the
      // original guest socket is still very much connected.
      const evictionPromise = waitForEviction(guestSocket);
      const staleDisconnectPromise = waitForDisconnect(guestSocket);

      secondGuestSocket = await connect(server.url);
      const rejoinStatePromise = waitForEvent<MyState>(secondGuestSocket, "draft:myState");
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
