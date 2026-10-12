import { test } from "node:test";
import assert from "node:assert/strict";
import { buildPortInUseMessage, buildStartupBanner } from "./startupBanner.js";

test("the banner shows the local address and the port to forward", () => {
  const banner = buildStartupBanner({ port: 4000, lobbyPassword: "hunter2", envFilePath: "/srv/draft/.env" });

  assert.match(banner, /http:\/\/localhost:4000/);
  assert.match(banner, /forward TCP port 4000 on your router/);
});

test("the banner reflects a custom port everywhere", () => {
  const banner = buildStartupBanner({ port: 5123, lobbyPassword: undefined, envFilePath: "/srv/draft/.env" });

  assert.match(banner, /port 5123/);
  assert.match(banner, /http:\/\/localhost:5123/);
  assert.match(banner, /forward TCP port 5123/);
  assert.doesNotMatch(banner, /4000/);
});

test("the banner shows the lobby password so the host can share it", () => {
  const banner = buildStartupBanner({ port: 4000, lobbyPassword: "hunter2", envFilePath: "/srv/draft/.env" });

  assert.match(banner, /Lobby password: hunter2/);
  assert.doesNotMatch(banner, /anyone who can reach/);
});

test("the banner warns when no lobby password is set", () => {
  for (const lobbyPassword of [undefined, ""]) {
    const banner = buildStartupBanner({ port: 4000, lobbyPassword, envFilePath: "/srv/draft/.env" });

    assert.match(banner, /Lobby password: none \(anyone who can reach this port can join\)/);
  }
});

test("the banner says which .env file to edit", () => {
  const banner = buildStartupBanner({ port: 4000, lobbyPassword: undefined, envFilePath: "C:\\Draft\\.env" });

  assert.match(banner, /edit C:\\Draft\\\.env and restart/);
});

test("a busy port gets an explanation instead of a stack trace", () => {
  const message = buildPortInUseMessage(4000, "/srv/draft/.env");

  assert.match(message, /Port 4000 is already in use/);
  assert.match(message, /\/srv\/draft\/\.env/);
});
