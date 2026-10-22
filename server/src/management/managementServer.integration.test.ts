import assert from "node:assert/strict";
import { once } from "node:events";
import fs from "node:fs";
import { get, type OutgoingHttpHeaders } from "node:http";
import { createServer, type AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import test, { type TestContext } from "node:test";
import { parseEnv } from "node:util";
import { io as ioClient, type Socket as ClientSocket } from "socket.io-client";
import type {
  ActionResult,
  LogEntry,
  ManagementClientToServerEvents,
  ManagementServerToClientEvents,
  ManagementStateView,
} from "@draft-simulator/shared";
import { testCard } from "../draftEngine/testHelpers.js";
import * as lobbyManager from "../session/lobbyManager.js";
import { getDraftServerState, stopDraftServer } from "./draftServer.js";
import { recordLog } from "./logBuffer.js";
import { isAllowedManagementRequest, startManagementServer, type ManagementServer } from "./managementServer.js";

type ManagementClientSocket = ClientSocket<ManagementServerToClientEvents, ManagementClientToServerEvents>;

function freshSnapshotPath(): string {
  return path.join(os.tmpdir(), `draft-simulator-itest-${Date.now()}-${Math.random().toString(36).slice(2)}.json`);
}

function tmpEnvPath(): string {
  return path.join(fs.mkdtempSync(path.join(os.tmpdir(), "draft-simulator-settings-")), ".env");
}

async function freePort(): Promise<number> {
  const probe = createServer().listen(0, "127.0.0.1");
  await once(probe, "listening");
  const { port } = probe.address() as AddressInfo;
  await new Promise((resolve) => probe.close(resolve));
  return port;
}

interface Setup {
  management: ManagementServer;
  envFilePath: string;
  playerPort: number;
}

async function setUp(t: TestContext): Promise<Setup> {
  lobbyManager.resetForTests(freshSnapshotPath());
  const envFilePath = tmpEnvPath();
  const playerPort = await freePort();
  const management = await startManagementServer({
    port: 0,
    envFilePath,
    savedSettings: { port: playerPort, lobbyPassword: "" },
    isCardDatabaseRefreshing: () => false,
  });
  t.after(async () => {
    if (getDraftServerState().status === "running") await stopDraftServer();
    await management.close();
  });
  return { management, envFilePath, playerPort };
}

/** Connects and resolves with the socket and the first state it was sent. */
function connect(url: string): Promise<{ socket: ManagementClientSocket; state: ManagementStateView }> {
  return new Promise((resolve, reject) => {
    const socket: ManagementClientSocket = ioClient(url, { forceNew: true, reconnection: false });
    socket.once("manage:state", (state) => resolve({ socket, state }));
    socket.once("connect_error", reject);
  });
}

function waitForStateWhere(
  socket: ManagementClientSocket,
  predicate: (state: ManagementStateView) => boolean,
): Promise<ManagementStateView> {
  return new Promise((resolve) => {
    function onState(state: ManagementStateView) {
      if (!predicate(state)) return;
      socket.off("manage:state", onState);
      resolve(state);
    }
    socket.on("manage:state", onState);
  });
}

function emitAction(
  socket: ManagementClientSocket,
  event: "manage:startServer" | "manage:stopServer" | "manage:restartServer",
): Promise<ActionResult> {
  return new Promise((resolve) => socket.emit(event, resolve));
}

/** A raw GET, since fetch won't send a Host header of our choosing. */
function getStatus(url: string, headers: OutgoingHttpHeaders): Promise<number> {
  return new Promise((resolve, reject) => {
    get(url, { headers }, (res) => {
      res.resume();
      resolve(res.statusCode!);
    }).on("error", reject);
  });
}

test("only requests addressed to this computer from its own pages are let through", () => {
  assert.equal(isAllowedManagementRequest({ host: "127.0.0.1:4001" }), true);
  assert.equal(isAllowedManagementRequest({ host: "localhost:4001", origin: "http://localhost:5173" }), true);
  assert.equal(isAllowedManagementRequest({ host: "[::1]:4001", origin: "http://[::1]:4001" }), true);

  assert.equal(isAllowedManagementRequest({}), false);
  assert.equal(isAllowedManagementRequest({ host: "attacker.example:4001" }), false);
  assert.equal(isAllowedManagementRequest({ host: "127.0.0.1:4001", origin: "http://attacker.example" }), false);
  assert.equal(isAllowedManagementRequest({ host: "127.0.0.1:4001", origin: "null" }), false);
});

test("a web page from elsewhere, or a rebound host name, is turned away", async (t) => {
  const { management } = await setUp(t);
  const pollingUrl = new URL("socket.io/?EIO=4&transport=polling", management.url).href;

  assert.equal(await getStatus(pollingUrl, { origin: "http://attacker.example" }), 403);
  assert.equal(await getStatus(pollingUrl, { host: "attacker.example" }), 403);
  assert.equal(await getStatus(new URL("manage.html", management.url).href, { host: "attacker.example" }), 403);
  assert.equal(await getStatus(pollingUrl, { origin: "http://localhost:5173" }), 200);
});

test("the management UI gets the logs so far, then each new line", async (t) => {
  const { management } = await setUp(t);
  recordLog("info", "logged before connecting");

  const socket: ManagementClientSocket = ioClient(management.url, { forceNew: true, reconnection: false });
  t.after(() => socket.close());
  const history = await new Promise<LogEntry[]>((resolve) => socket.once("manage:logHistory", resolve));
  assert.equal(history.at(-1)?.message, "logged before connecting");

  const next = new Promise<LogEntry>((resolve) => socket.once("manage:log", resolve));
  recordLog("warn", "logged after connecting");
  const entry = await next;
  assert.deepEqual([entry.level, entry.message], ["warn", "logged after connecting"]);
});

test("the server can be started and stopped from the management UI", async (t) => {
  const { management, playerPort } = await setUp(t);
  const { socket, state } = await connect(management.url);
  t.after(() => socket.close());
  assert.equal(state.server.status, "stopped");

  const running = waitForStateWhere(socket, (s) => s.server.status === "running");
  assert.deepEqual(await emitAction(socket, "manage:startServer"), { ok: true });
  assert.deepEqual((await running).server.running, { port: playerPort, lobbyPassword: "" });
  assert.equal((await fetch(`http://127.0.0.1:${playerPort}/health`)).status, 200);

  const stopped = waitForStateWhere(socket, (s) => s.server.status === "stopped");
  assert.deepEqual(await emitAction(socket, "manage:stopServer"), { ok: true });
  await stopped;
  assert.deepEqual(await emitAction(socket, "manage:stopServer"), { ok: false, error: "The server isn't running." });
});

test("lobby changes reach the management UI, without anyone's packs", async (t) => {
  const { management } = await setUp(t);
  const { socket } = await connect(management.url);
  t.after(() => socket.close());

  const created = waitForStateWhere(socket, (s) => s.lobby.status === "lobby");
  lobbyManager.createLobbyFromResolvedCube("Alice", "Test Cube", [testCard("c1"), testCard("c2")], [], {
    cubeId: "test-cube",
    packCount: 1,
    packSize: 1,
    playerCount: 2,
    alternatingDraft: true,
  });
  assert.equal((await created).lobby.cubeName, "Test Cube");

  const drafting = waitForStateWhere(socket, (s) => s.lobby.status === "drafting");
  lobbyManager.addPlayer("Bob");
  lobbyManager.beginDraft();
  const state = await drafting;
  assert.deepEqual(
    state.lobby.players.map((p) => p.name),
    ["Alice", "Bob"],
  );
  assert.doesNotMatch(JSON.stringify(state), /"c1"|"c2"/);
});

test("saved settings go to the .env file, and a restart applies them", async (t) => {
  const { management, envFilePath } = await setUp(t);
  const { socket } = await connect(management.url);
  t.after(() => socket.close());
  await emitAction(socket, "manage:startServer");
  const newPort = await freePort();

  const saved = waitForStateWhere(socket, (s) => s.settings.port === newPort);
  const result = await new Promise<ActionResult>((resolve) =>
    socket.emit("manage:saveSettings", { port: newPort, lobbyPassword: "  hunter2 " }, resolve),
  );
  assert.deepEqual(result, { ok: true });
  const afterSave = await saved;
  assert.equal(afterSave.restartRequired, true);
  assert.deepEqual(afterSave.settings, { port: newPort, lobbyPassword: "hunter2" });
  assert.deepEqual(parseEnv(fs.readFileSync(envFilePath, "utf8")), {
    PORT: String(newPort),
    LOBBY_PASSWORD: "hunter2",
  });

  const restarted = waitForStateWhere(socket, (s) => s.server.status === "running" && !s.restartRequired);
  assert.deepEqual(await emitAction(socket, "manage:restartServer"), { ok: true });
  assert.deepEqual((await restarted).server.running, { port: newPort, lobbyPassword: "hunter2" });
  assert.equal((await fetch(`http://127.0.0.1:${newPort}/health`)).status, 200);
});

test("invalid settings are refused and nothing is saved", async (t) => {
  const { management, envFilePath } = await setUp(t);
  const { socket } = await connect(management.url);
  t.after(() => socket.close());

  const result = await new Promise<ActionResult>((resolve) =>
    socket.emit("manage:saveSettings", { port: 0, lobbyPassword: "" }, resolve),
  );

  assert.deepEqual(result, { ok: false, error: "The port must be a whole number from 1 to 65535." });
  assert.equal(fs.existsSync(envFilePath), false);
});

test("the management port can't be saved or started as the players' port", async (t) => {
  const { management } = await setUp(t);
  const { socket } = await connect(management.url);
  t.after(() => socket.close());
  const managementPort = Number(new URL(management.url).port);

  const result = await new Promise<ActionResult>((resolve) =>
    socket.emit("manage:saveSettings", { port: managementPort, lobbyPassword: "" }, resolve),
  );

  assert.equal(result.ok, false);
  assert.match(!result.ok ? result.error : "", /management UI's own port/);
});

test("a busy management port says what to do", async (t) => {
  const { management } = await setUp(t);
  const port = Number(new URL(management.url).port);

  await assert.rejects(
    startManagementServer({
      port,
      envFilePath: tmpEnvPath(),
      savedSettings: { port: 4000, lobbyPassword: "" },
      isCardDatabaseRefreshing: () => false,
    }),
    new RegExp(`Port ${port} for the management UI is already in use`),
  );
});
