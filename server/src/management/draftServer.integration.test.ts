import assert from "node:assert/strict";
import { once } from "node:events";
import { createServer, type AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { io as ioClient, type Socket as ClientSocket } from "socket.io-client";
import type { ActionResult, ClientToServerEvents, ServerToClientEvents } from "@draft-simulator/shared";
import { testCard } from "../draftEngine/testHelpers.js";
import * as lobbyManager from "../session/lobbyManager.js";
import {
  buildListenErrorMessage,
  getDraftServerState,
  getPlayerConnectionCount,
  startDraftServer,
  stopDraftServer,
} from "./draftServer.js";

type DraftClientSocket = ClientSocket<ServerToClientEvents, ClientToServerEvents>;

function freshSnapshotPath(): string {
  return path.join(os.tmpdir(), `draft-simulator-itest-${Date.now()}-${Math.random().toString(36).slice(2)}.json`);
}

async function freePort(): Promise<number> {
  const probe = createServer().listen(0, "127.0.0.1");
  await once(probe, "listening");
  const { port } = probe.address() as AddressInfo;
  await new Promise((resolve) => probe.close(resolve));
  return port;
}

/**
 * Resolves once connected, or with the connect error's message (e.g. "invalid_password"). `origin` is sent the way a
 * browser sends the page's address; without it the client is like a script, which sends none.
 */
function connect(port: number, password = "", origin?: string): Promise<{ socket: DraftClientSocket; error?: string }> {
  return new Promise((resolve) => {
    const socket: DraftClientSocket = ioClient(`http://127.0.0.1:${port}`, {
      forceNew: true,
      reconnection: false,
      auth: { password },
      ...(origin === undefined ? {} : { extraHeaders: { origin } }),
    });
    socket.once("connect", () => resolve({ socket }));
    socket.once("connect_error", (err) => resolve({ socket, error: err.message }));
  });
}

async function ensureStopped(): Promise<void> {
  if (getDraftServerState().status === "running") await stopDraftServer();
}

test("a started server answers players, and a stopped one doesn't", async (t) => {
  t.after(ensureStopped);
  lobbyManager.resetForTests(freshSnapshotPath());
  const port = await freePort();

  assert.deepEqual(await startDraftServer({ port, lobbyPassword: "" }), { ok: true });
  assert.deepEqual(getDraftServerState(), { status: "running", running: { port, lobbyPassword: "" } });
  assert.equal((await fetch(`http://127.0.0.1:${port}/health`)).status, 200);

  const { socket } = await connect(port);
  assert.equal(getPlayerConnectionCount(), 1);

  const disconnected = new Promise<void>((resolve) => socket.once("disconnect", () => resolve()));
  assert.deepEqual(await stopDraftServer(), { ok: true });
  await disconnected;
  socket.close();
  assert.equal(getDraftServerState().status, "stopped");
  assert.equal(getPlayerConnectionCount(), 0);
  await assert.rejects(fetch(`http://127.0.0.1:${port}/health`));
});

test("stopping keeps the draft: the player is marked disconnected but keeps their seat", async (t) => {
  t.after(ensureStopped);
  lobbyManager.resetForTests(freshSnapshotPath());
  const { draftId } = lobbyManager.createLobbyFromResolvedCube("Test Cube", [testCard("c1"), testCard("c2")], [], {
    cubeId: "test-cube",
    packCount: 1,
    packSize: 1,
    alternatingDraft: true,
  });
  const host = lobbyManager.addPlayer(draftId, "Alice");
  const port = await freePort();
  await startDraftServer({ port, lobbyPassword: "" });

  const { socket } = await connect(port);
  const rejoined = await new Promise<ActionResult>((resolve) =>
    socket.emit("lobby:reconnect", { draftId, playerId: host.id }, resolve),
  );
  assert.deepEqual(rejoined, { ok: true });

  await stopDraftServer();
  socket.close();

  const session = lobbyManager.getSession(draftId)!;
  assert.equal(session.status, "lobby");
  assert.deepEqual(
    session.players.map((p) => [p.name, p.connected]),
    [["Alice", false]],
  );
});

test("a busy port fails the start with an explanation, and a free one works after", async (t) => {
  t.after(ensureStopped);
  lobbyManager.resetForTests(freshSnapshotPath());
  const blocker = createServer().listen(0, "0.0.0.0");
  await once(blocker, "listening");
  t.after(() => new Promise((resolve) => blocker.close(resolve)));
  const busyPort = (blocker.address() as AddressInfo).port;
  t.mock.method(console, "error", () => {});

  const result = await startDraftServer({ port: busyPort, lobbyPassword: "" });

  assert.equal(result.ok, false);
  assert.match(!result.ok ? result.error : "", new RegExp(`Port ${busyPort} is already in use`));
  assert.equal(getDraftServerState().status, "failed");

  assert.deepEqual(await startDraftServer({ port: await freePort(), lobbyPassword: "" }), { ok: true });
});

test("invalid settings fail the start without opening a port", async (t) => {
  t.after(ensureStopped);
  t.mock.method(console, "error", () => {});

  const result = await startDraftServer({ port: 70000, lobbyPassword: "" });

  assert.equal(result.ok, false);
  assert.deepEqual(getDraftServerState(), { status: "failed", error: !result.ok ? result.error : "" });
});

test("starting twice is refused", async (t) => {
  t.after(ensureStopped);
  const port = await freePort();
  await startDraftServer({ port, lobbyPassword: "" });

  assert.deepEqual(await startDraftServer({ port, lobbyPassword: "" }), {
    ok: false,
    error: "The server is already running.",
  });
});

test("a restart with a new password turns the old one away", async (t) => {
  t.after(ensureStopped);
  lobbyManager.resetForTests(freshSnapshotPath());
  const port = await freePort();

  await startDraftServer({ port, lobbyPassword: "first" });
  const before = await connect(port, "first");
  assert.equal(before.error, undefined);
  before.socket.close();

  await stopDraftServer();
  await startDraftServer({ port, lobbyPassword: "second" });

  const oldPassword = await connect(port, "first");
  oldPassword.socket.close();
  assert.equal(oldPassword.error, "invalid_password");
  const newPassword = await connect(port, "second");
  newPassword.socket.close();
  assert.equal(newPassword.error, undefined);
});

test("players can't open the management page", async (t) => {
  t.after(ensureStopped);
  const port = await freePort();
  await startDraftServer({ port, lobbyPassword: "" });

  assert.equal((await fetch(`http://127.0.0.1:${port}/manage.html`)).status, 404);
});

test("only the player page itself can open a socket: another website's origin is refused", async (t) => {
  t.after(ensureStopped);
  lobbyManager.resetForTests(freshSnapshotPath());
  const port = await freePort();
  await startDraftServer({ port, lobbyPassword: "" });

  const ownPage = await connect(port, "", `http://127.0.0.1:${port}`);
  ownPage.socket.close();
  assert.equal(ownPage.error, undefined);

  for (const origin of ["https://evil.example", `http://127.0.0.1:${port + 1}`]) {
    const foreign = await connect(port, "", origin);
    foreign.socket.close();
    assert.notEqual(foreign.error, undefined, origin);
  }
  // Nothing was let in: only the page's own socket ever counted, and it's gone.
  assert.equal(getPlayerConnectionCount(), 0);
});

test("every response carries the security headers, and no CORS or framework headers", async (t) => {
  t.after(ensureStopped);
  const port = await freePort();
  await startDraftServer({ port, lobbyPassword: "" });

  for (const route of ["/health", "/images/not-a-card", "/manage.html"]) {
    const res = await fetch(`http://127.0.0.1:${port}${route}`, { headers: { origin: "https://evil.example" } });
    assert.match(res.headers.get("content-security-policy") ?? "", /default-src 'self'.*frame-ancestors 'none'/, route);
    assert.equal(res.headers.get("x-frame-options"), "DENY", route);
    assert.equal(res.headers.get("x-content-type-options"), "nosniff", route);
    assert.equal(res.headers.get("referrer-policy"), "no-referrer", route);
    assert.equal(res.headers.get("access-control-allow-origin"), null, route);
    assert.equal(res.headers.get("x-powered-by"), null, route);
  }
});

test("a port that's taken or not allowed gets a message saying what to do", () => {
  assert.match(
    buildListenErrorMessage(4000, Object.assign(new Error("listen EADDRINUSE"), { code: "EADDRINUSE" })),
    /Port 4000 is already in use\. Is another copy of Draft Simulator running\?/,
  );
  assert.match(
    buildListenErrorMessage(80, Object.assign(new Error("listen EACCES"), { code: "EACCES" })),
    /isn't allowed to use port 80\. Choose a port above 1023/,
  );
});
