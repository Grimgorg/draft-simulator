import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { countCards } from "../cardData/cardRepository.js";
import { getDb } from "../db/database.js";
import { importCubeFromCubeCobra } from "./cubeCobraImporter.js";

/** Replaces fetch for this test with one answering every request with `respond()`, recording the URLs asked for. */
function mockFetch(t: TestContext, respond: () => Response): string[] {
  const urls: string[] = [];
  t.mock.method(globalThis, "fetch", async (input: string | URL | Request) => {
    urls.push(String(input));
    return respond();
  });
  return urls;
}

type CubeCard = string | { name: string; oracleId: string } | undefined;

function cubeJson(name: string, cards: CubeCard[]): Response {
  const mainboard = cards.map((card) => {
    if (card === undefined) return {};
    if (typeof card === "string") return { details: { name: card } };
    return { details: { name: card.name, oracle_id: card.oracleId } };
  });
  return Response.json({ name, cards: { mainboard } });
}

/** False for an empty cache, and for one imported before oracle ids were stored (until its next refresh). */
function cacheHasOracleIds(): boolean {
  return getDb().prepare("SELECT 1 FROM cards WHERE oracle_id IS NOT NULL LIMIT 1").get() !== undefined;
}

test("accepts a bare cube id or a link to any page of the cube", async (t) => {
  const urls = mockFetch(t, () => new Response("", { status: 404, statusText: "Not Found" }));
  const inputs = [
    "practical",
    "  practical  ",
    "https://cubecobra.com/cube/overview/practical",
    "https://cubecobra.com/cube/list/practical?view=spoiler",
    "cubecobra.com/cube/playtest/practical#samplepack",
    "HTTPS://CubeCobra.com/cube/overview/practical/",
  ];

  for (const input of inputs) {
    await assert.rejects(importCubeFromCubeCobra(input), /Could not fetch cube "practical" from CubeCobra: 404 Not Found/);
  }
  assert.deepEqual(new Set(urls), new Set(["https://cubecobra.com/cube/api/cubeJSON/practical"]));
  assert.equal(urls.length, inputs.length);
});

test("fetches from CUBECOBRA_BASE_URL instead of cubecobra.com when it is set", async (t) => {
  process.env.CUBECOBRA_BASE_URL = "http://127.0.0.1:9999";
  t.after(() => delete process.env.CUBECOBRA_BASE_URL);
  const urls = mockFetch(t, () => new Response("", { status: 404, statusText: "Not Found" }));

  await assert.rejects(importCubeFromCubeCobra("https://cubecobra.com/cube/overview/practical"), /404/);
  assert.deepEqual(urls, ["http://127.0.0.1:9999/cube/api/cubeJSON/practical"]);
});

test("rejects a blank cube id without contacting CubeCobra", async (t) => {
  const urls = mockFetch(t, () => cubeJson("Unused", []));

  await assert.rejects(importCubeFromCubeCobra("   "), /No cube id or URL provided/);
  assert.deepEqual(urls, []);
});

test("rejects a cube none of whose cards are in the local card cache", async (t) => {
  mockFetch(t, () => cubeJson("Fake Cube", ["Not A Real Card Name", "Another Invented Card"]));

  await assert.rejects(importCubeFromCubeCobra("fake"), /None of this cube's cards could be resolved/);
});

test(
  "keeps every copy of a duplicated card, resolves double-faced cards by front face, and reports unknown names once",
  { skip: countCards() === 0 && "needs a populated card cache: npm run import-cards --workspace server" },
  async (t) => {
    mockFetch(t, () =>
      cubeJson("Mixed Cube", [
        "Lightning Bolt",
        "lightning bolt",
        "Delver of Secrets",
        "Not A Real Card Name",
        "Not A Real Card Name",
        undefined,
      ])
    );

    const result = await importCubeFromCubeCobra("mixed");

    assert.equal(result.cubeName, "Mixed Cube");
    assert.deepEqual(
      result.cards.map((c) => c.name),
      ["Lightning Bolt", "Lightning Bolt", "Delver of Secrets // Insectile Aberration"]
    );
    assert.deepEqual(result.unresolvedNames, ["Not A Real Card Name"]);
    const [bolt, , delver] = result.cards;
    assert.equal(bolt!.imageUrl, `/images/${bolt!.scryfallId}`);
    assert.equal(bolt!.backImageUrl, undefined);
    assert.equal(delver!.backImageUrl, `/images/${delver!.scryfallId}/back`);
  }
);

test(
  "resolves a card by oracle id when CubeCobra names it by a printing-specific name",
  { skip: !cacheHasOracleIds() && "needs a card cache with oracle ids: npm run import-cards --workspace server" },
  async (t) => {
    // CubeCobra names Through the Omenpaths printings by their printed name, which Scryfall
    // keeps only on that printing; the card itself is "Spider-Woman, Stunning Savior".
    mockFetch(t, () =>
      cubeJson("Omenpaths Cube", [
        { name: "Makdee and Itla, Skysnarers", oracleId: "be2b9c6d-4ecb-49ec-b276-4aa93c5dfc00" },
        { name: "Makdee and Itla, Skysnarers", oracleId: "be2b9c6d-4ecb-49ec-b276-4aa93c5dfc00" },
        { name: "Not A Real Card Name", oracleId: "00000000-0000-0000-0000-000000000000" },
        "Lightning Bolt",
      ])
    );

    const result = await importCubeFromCubeCobra("omenpaths");

    assert.deepEqual(
      result.cards.map((c) => c.name),
      ["Spider-Woman, Stunning Savior", "Spider-Woman, Stunning Savior", "Lightning Bolt"]
    );
    assert.deepEqual(result.unresolvedNames, ["Not A Real Card Name"]);
  }
);
