import assert from "node:assert/strict";
import fs from "node:fs";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import test, { type TestContext } from "node:test";
import express from "express";
import { countCards, findCardsByNames, getBackImageUri, getSourceImageUri } from "../cardData/cardRepository.js";
import {
  resolveCachedImagePath,
  serveCardBackImage,
  serveCardImage,
  setImageDirForTests,
  setImageDownloadLimitForTests,
} from "./imageCache.js";

const realFetch = globalThis.fetch;
const needsCardCache = {
  skip: countCards() === 0 && "needs a populated card cache: npm run import-cards --workspace server",
};

/**
 * Serves the image routes from a fresh, isolated image dir (or `imageDir`, if given) and fakes Scryfall:
 * every request away from the test server is answered by `respond`, and its URL recorded.
 */
async function startImageServer(
  t: TestContext,
  respond: (url: string) => Response = (url) => new Response(`image from ${url}`),
  imageDir = fs.mkdtempSync(path.join(os.tmpdir(), "draft-simulator-images-"))
) {
  setImageDirForTests(imageDir);
  const app = express();
  app.get("/images/:scryfallId", serveCardImage);
  app.get("/images/:scryfallId/back", serveCardBackImage);
  const httpServer = app.listen(0);
  await new Promise((resolve) => httpServer.once("listening", resolve));
  const baseUrl = `http://localhost:${(httpServer.address() as AddressInfo).port}`;
  t.after(() => new Promise((resolve) => httpServer.close(resolve)));

  const scryfallRequests: string[] = [];
  t.mock.method(globalThis, "fetch", async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    if (url.startsWith(baseUrl)) return realFetch(input, init);
    scryfallRequests.push(url);
    return respond(url);
  });

  return {
    imageDir,
    scryfallRequests,
    get: async (imagePath: string) => {
      const res = await fetch(`${baseUrl}${imagePath}`);
      return { status: res.status, type: res.headers.get("content-type"), body: await res.text() };
    },
  };
}

/**
 * Waits for the image dir to hold exactly `fileNames`. The image goes out before its cache write finishes, so a
 * response alone doesn't mean the file is there yet.
 */
async function waitForCachedFiles(imageDir: string, fileNames: string[]): Promise<void> {
  const expected = JSON.stringify([...fileNames].sort());
  for (let attempt = 0; attempt < 100; attempt++) {
    if (JSON.stringify(fs.readdirSync(imageDir).sort()) === expected) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert.deepEqual(fs.readdirSync(imageDir).sort(), [...fileNames].sort());
}

function cachedCardId(name: string): string {
  return findCardsByNames([name]).get(name)!.scryfallId;
}

test("an unknown card is a 404, without asking Scryfall", async (t) => {
  const server = await startImageServer(t);

  assert.equal((await server.get("/images/not-a-card")).status, 404);
  assert.equal((await server.get("/images/not-a-card/back")).status, 404);
  assert.deepEqual(server.scryfallRequests, []);
});

test("an id that climbs out of the image dir is a 404, not a file from elsewhere on disk", async (t) => {
  const parentDir = fs.mkdtempSync(path.join(os.tmpdir(), "draft-simulator-images-parent-"));
  const imageDir = path.join(parentDir, "images");
  fs.mkdirSync(imageDir);
  fs.writeFileSync(path.join(parentDir, "secret.jpg"), "not a card image");
  fs.writeFileSync(path.join(parentDir, "secret_back.jpg"), "not a card image");
  const server = await startImageServer(t, undefined, imageDir);

  for (const imagePath of ["/images/..%2Fsecret", "/images/..%2Fsecret/back", "/images/..%5Csecret"]) {
    const res = await server.get(imagePath);
    assert.equal(res.status, 404, imagePath);
    assert.notEqual(res.body, "not a card image", imagePath);
  }
  assert.deepEqual(server.scryfallRequests, []);
});

test("behind the UUID check, a cache key can only name a file directly inside the image dir", () => {
  const imageDir = fs.mkdtempSync(path.join(os.tmpdir(), "draft-simulator-images-"));
  setImageDirForTests(imageDir);

  assert.equal(resolveCachedImagePath("abc_back"), path.join(imageDir, "abc_back.jpg"));
  for (const cacheKey of ["../secret", "..\\secret", "sub/abc", "sub\\abc", "/etc/passwd", "C:\\secret", ""]) {
    const resolved = resolveCachedImagePath(cacheKey);
    // "sub\\abc" and "C:\\secret" are plain file names on Linux and macOS, where a backslash isn't a separator.
    if (resolved !== undefined) assert.equal(path.dirname(resolved), path.resolve(imageDir), cacheKey);
  }
  assert.equal(resolveCachedImagePath("../secret"), undefined);
  assert.equal(resolveCachedImagePath("sub/abc"), undefined);
  assert.equal(resolveCachedImagePath("/etc/passwd"), undefined);
});

test("an image is downloaded from Scryfall once, then served from the cache", needsCardCache, async (t) => {
  const server = await startImageServer(t);
  const boltId = cachedCardId("Lightning Bolt");
  const sourceUri = getSourceImageUri(boltId)!;

  for (let request = 0; request < 2; request++) {
    const res = await server.get(`/images/${boltId}`);
    assert.equal(res.status, 200);
    assert.equal(res.type, "image/jpeg");
    assert.equal(res.body, `image from ${sourceUri}`);
    await waitForCachedFiles(server.imageDir, [`${boltId}.jpg`]);
  }
  assert.deepEqual(server.scryfallRequests, [sourceUri]);
});

test(
  "a double-faced card's back is its own image, cached apart from the front; a single-faced card has no back",
  needsCardCache,
  async (t) => {
    const server = await startImageServer(t);
    const delverId = cachedCardId("Delver of Secrets");
    const boltId = cachedCardId("Lightning Bolt");

    const front = await server.get(`/images/${delverId}`);
    const back = await server.get(`/images/${delverId}/back`);
    assert.equal(front.body, `image from ${getSourceImageUri(delverId)}`);
    assert.equal(back.body, `image from ${getBackImageUri(delverId)}`);
    assert.notEqual(front.body, back.body);
    await waitForCachedFiles(server.imageDir, [`${delverId}.jpg`, `${delverId}_back.jpg`]);

    assert.equal((await server.get(`/images/${boltId}/back`)).status, 404);
    assert.equal(server.scryfallRequests.length, 2, "the missing back never reaches Scryfall");
  }
);

test("when Scryfall fails, the request is a 502 and nothing is cached, so the next one tries again", needsCardCache, async (t) => {
  let scryfallUp = false;
  const server = await startImageServer(t, (url) =>
    scryfallUp ? new Response(`image from ${url}`) : new Response("", { status: 503 })
  );
  const boltId = cachedCardId("Lightning Bolt");

  assert.equal((await server.get(`/images/${boltId}`)).status, 502);
  assert.deepEqual(fs.readdirSync(server.imageDir), []);

  scryfallUp = true;
  assert.equal((await server.get(`/images/${boltId}`)).status, 200);
  assert.equal(server.scryfallRequests.length, 2);
});

test("when Scryfall can't be reached at all, the request is a 502 instead of a crash", needsCardCache, async (t) => {
  const server = await startImageServer(t, () => {
    throw new TypeError("fetch failed");
  });

  assert.equal((await server.get(`/images/${cachedCardId("Lightning Bolt")}`)).status, 502);
});

test("an address can only make the server download so many new images an hour; cached ones are always served", needsCardCache, async (t) => {
  let time = 0;
  setImageDownloadLimitForTests(2, () => time);
  t.after(() => setImageDownloadLimitForTests());
  const server = await startImageServer(t);
  const [boltId, delverId, counterspellId] = ["Lightning Bolt", "Delver of Secrets", "Counterspell"].map(cachedCardId);

  assert.equal((await server.get(`/images/${boltId}`)).status, 200);
  assert.equal((await server.get(`/images/${delverId}`)).status, 200);
  await waitForCachedFiles(server.imageDir, [`${boltId}.jpg`, `${delverId}.jpg`]);

  const refused = await server.get(`/images/${counterspellId}`);
  assert.equal(refused.status, 429);
  assert.equal(server.scryfallRequests.length, 2, "the refused image never reaches Scryfall");
  assert.equal((await server.get(`/images/${boltId}`)).status, 200, "cached images don't count");
  // Unknown cards are a 404 as before, not a 429.
  assert.equal((await server.get("/images/00000000-0000-0000-0000-000000000000")).status, 404);

  time = 60 * 60 * 1000;
  assert.equal((await server.get(`/images/${counterspellId}`)).status, 200);
});

test("an image that can't be written to the cache is still served", needsCardCache, async (t) => {
  const unwritableDir = path.join(os.tmpdir(), `draft-simulator-missing-${Date.now()}`, "images");
  const server = await startImageServer(t, undefined, unwritableDir);
  const boltId = cachedCardId("Lightning Bolt");

  const res = await server.get(`/images/${boltId}`);
  assert.equal(res.status, 200);
  assert.equal(res.body, `image from ${getSourceImageUri(boltId)}`);
  assert.equal(fs.existsSync(unwritableDir), false);
});
