import assert from "node:assert/strict";
import test from "node:test";
import { isAllowedPlayerRequest, isViteDevOrigin } from "./requestOrigin.js";

test("the player page's own origin may connect, whatever address players use", () => {
  for (const host of ["192.168.1.20:4000", "draft-pc:4000", "localhost:4000", "[::1]:4000"]) {
    assert.ok(isAllowedPlayerRequest({ host, origin: `http://${host}` }, false), host);
  }
  // Default ports appear in neither header.
  assert.ok(isAllowedPlayerRequest({ host: "draft.example.com", origin: "https://draft.example.com" }, false));
  assert.ok(isAllowedPlayerRequest({ host: "Draft.Example.com", origin: "https://draft.example.com" }, false));
});

test("another website can't connect, from any origin", () => {
  const host = "192.168.1.20:4000";
  for (const origin of [
    "https://evil.example",
    "http://192.168.1.20:4001",
    "http://192.168.1.20",
    "http://192.168.1.21:4000",
    "null",
    "not a url",
  ]) {
    assert.equal(isAllowedPlayerRequest({ host, origin }, false), false, origin);
  }
  assert.equal(isAllowedPlayerRequest({ origin: "http://192.168.1.20:4000" }, false), false, "no Host at all");
});

test("behind a reverse proxy that rewrites Host, X-Forwarded-Host names the page", () => {
  const headers = { host: "127.0.0.1:4000", "x-forwarded-host": "draft.example.com" };
  assert.ok(isAllowedPlayerRequest({ ...headers, origin: "https://draft.example.com" }, false));
  assert.ok(isAllowedPlayerRequest({ ...headers, "x-forwarded-host": "a.example, draft.example.com", origin: "https://draft.example.com" }, false));
  assert.equal(isAllowedPlayerRequest({ ...headers, origin: "https://evil.example" }, false), false);
});

test("requests without an Origin aren't from a web page and get through", () => {
  assert.ok(isAllowedPlayerRequest({ host: "192.168.1.20:4000" }, false));
});

test("Vite's dev server on this computer may connect only when run from source", () => {
  const headers = { host: "localhost:4000", origin: "http://localhost:5173" };
  assert.ok(isAllowedPlayerRequest(headers, true));
  assert.equal(isAllowedPlayerRequest(headers, false), false);

  assert.ok(isViteDevOrigin("http://127.0.0.1:5173"));
  assert.ok(isViteDevOrigin("http://[::1]:5173"));
  assert.equal(isViteDevOrigin("http://evil.example:5173"), false);
  assert.equal(isViteDevOrigin("http://192.168.1.20:5173"), false);
  assert.equal(isViteDevOrigin("http://localhost:5174"), false);
  assert.equal(isAllowedPlayerRequest({ host: "localhost:4000", origin: "http://evil.example:5173" }, true), false);
});
