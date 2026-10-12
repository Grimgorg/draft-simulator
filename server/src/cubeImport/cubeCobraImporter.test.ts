import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { countCards } from "../cardData/cardRepository.js";
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

function cubeJson(name: string, cardNames: (string | undefined)[]): Response {
  const mainboard = cardNames.map((cardName) => (cardName === undefined ? {} : { details: { name: cardName } }));
  return Response.json({ name, cards: { mainboard } });
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
