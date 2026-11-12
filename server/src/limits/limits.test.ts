import assert from "node:assert/strict";
import test from "node:test";
import { clientAddress } from "./clientAddress.js";
import { createWindowCounter } from "./windowCounter.js";

test("a window counter counts per key until the window ends, then starts over", () => {
  let time = 0;
  const counter = createWindowCounter(1000, () => time);

  counter.add("a");
  counter.add("a");
  counter.add("b");
  assert.equal(counter.count("a"), 2);
  assert.equal(counter.count("b"), 1);
  assert.equal(counter.count("c"), 0);

  // The window starts at a key's first event, not its latest.
  time = 999;
  counter.add("a");
  assert.equal(counter.count("a"), 3);
  time = 1000;
  assert.equal(counter.count("a"), 0);
  counter.add("a");
  assert.equal(counter.count("a"), 1);

  counter.reset("a");
  assert.equal(counter.count("a"), 0);
});

test("a window counter flooded with keys keeps only the ones still in their window", () => {
  let time = 0;
  const counter = createWindowCounter(1000, () => time);
  for (let i = 0; i < 10_000; i++) counter.add(`old-${i}`);
  time = 500;
  counter.add("recent");
  time = 1200;
  // Adding past the threshold drops the expired keys; the recent one stays.
  counter.add("new");
  assert.equal(counter.count("old-0"), 0);
  assert.equal(counter.count("recent"), 1);
  assert.equal(counter.count("new"), 1);
});

test("a client's address is the connection's, and X-Forwarded-For counts only from this computer", () => {
  assert.equal(clientAddress("192.168.1.30", {}), "192.168.1.30");
  // From elsewhere the header could be anything the client chose.
  assert.equal(clientAddress("203.0.113.7", { "x-forwarded-for": "10.0.0.1" }), "203.0.113.7");
  // From a proxy on this computer: the last entry, which the proxy added.
  assert.equal(clientAddress("127.0.0.1", { "x-forwarded-for": "198.51.100.1, 203.0.113.7" }), "203.0.113.7");
  assert.equal(clientAddress("::1", { "x-forwarded-for": "203.0.113.7" }), "203.0.113.7");
  assert.equal(clientAddress("::ffff:127.0.0.1", { "x-forwarded-for": "203.0.113.7" }), "203.0.113.7");
  // The host playing on this computer, without a proxy.
  assert.equal(clientAddress("127.0.0.1", {}), "127.0.0.1");
  assert.equal(clientAddress("127.0.0.1", { "x-forwarded-for": " , " }), "127.0.0.1");
  assert.equal(clientAddress(undefined, {}), "unknown");
});
