import assert from "node:assert/strict";
import test from "node:test";
import { requireLobbyPassword } from "./lobbyPassword.js";

type Middleware = ReturnType<typeof requireLobbyPassword>;

/** What the middleware says to a connection from `address` presenting `password`: undefined when it's let in. */
function attempt(middleware: Middleware, password: unknown, address = "192.168.1.30", headers = {}): string | undefined {
  let refusal: string | undefined = "never answered";
  const socket = { handshake: { address, headers, auth: { password } } } as unknown as Parameters<Middleware>[0];
  middleware(socket, (err) => {
    refusal = err?.message;
  });
  return refusal;
}

test("only the right password gets in, and a wrong one, or none, is invalid_password", () => {
  const middleware = requireLobbyPassword("hunter2");
  assert.equal(attempt(middleware, "hunter2"), undefined);
  assert.equal(attempt(middleware, "hunter"), "invalid_password");
  assert.equal(attempt(middleware, "hunter22"), "invalid_password");
  assert.equal(attempt(middleware, ""), "invalid_password");
  assert.equal(attempt(middleware, undefined), "invalid_password");
  assert.equal(attempt(middleware, ["hunter2"]), "invalid_password");
});

test("after 10 wrong passwords an address is refused for 15 minutes, even with the right one", () => {
  let time = 0;
  const middleware = requireLobbyPassword("hunter2", () => time);
  for (let guess = 0; guess < 10; guess++) assert.equal(attempt(middleware, `guess-${guess}`), "invalid_password");

  assert.equal(attempt(middleware, "hunter2"), "too_many_attempts");
  assert.equal(attempt(middleware, "guess-10"), "too_many_attempts");
  // Other addresses aren't affected.
  assert.equal(attempt(middleware, "hunter2", "192.168.1.31"), undefined);

  time = 15 * 60 * 1000;
  assert.equal(attempt(middleware, "hunter2"), undefined);
});

test("a right password clears the address's wrong ones", () => {
  const middleware = requireLobbyPassword("hunter2");
  for (let guess = 0; guess < 9; guess++) attempt(middleware, `typo-${guess}`);
  assert.equal(attempt(middleware, "hunter2"), undefined);
  for (let guess = 0; guess < 9; guess++) assert.equal(attempt(middleware, `typo-${guess}`), "invalid_password");
  assert.equal(attempt(middleware, "hunter2"), undefined);
});

test("visiting without a password yet isn't a wrong guess: friends behind one router can all open the page", () => {
  const middleware = requireLobbyPassword("hunter2");
  for (let visit = 0; visit < 30; visit++) assert.equal(attempt(middleware, ""), "invalid_password");
  assert.equal(attempt(middleware, "hunter2"), undefined);
});

test("behind a reverse proxy on this computer, each player's guesses count against their own address", () => {
  const middleware = requireLobbyPassword("hunter2");
  const viaProxy = (player: string) => ({ "x-forwarded-for": player });
  for (let guess = 0; guess < 10; guess++) attempt(middleware, `guess-${guess}`, "127.0.0.1", viaProxy("203.0.113.7"));

  assert.equal(attempt(middleware, "hunter2", "127.0.0.1", viaProxy("203.0.113.7")), "too_many_attempts");
  assert.equal(attempt(middleware, "hunter2", "127.0.0.1", viaProxy("198.51.100.1")), undefined);
});

test("without a lobby password, everyone gets in", () => {
  const middleware = requireLobbyPassword(undefined);
  for (let visit = 0; visit < 20; visit++) assert.equal(attempt(middleware, `anything-${visit}`), undefined);
  assert.equal(attempt(requireLobbyPassword(""), "x"), undefined);
});
