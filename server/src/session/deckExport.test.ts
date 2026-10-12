import assert from "node:assert/strict";
import test from "node:test";
import type { Player } from "@draft-simulator/shared";
import { createDraftSession } from "../draftEngine/draftEngine.js";
import { testCard } from "../draftEngine/testHelpers.js";
import { buildDeckExports } from "./deckExport.js";

test("exports each player's pool with duplicate copies counted, in first-picked order", () => {
  const players: Player[] = [
    { id: "A", name: "Alice", isHost: true, connected: true },
    { id: "B", name: "Bob", isHost: false, connected: true },
  ];
  const session = createDraftSession("draft-export", { cubeId: "x", packCount: 1, packSize: 3, playerCount: 2, alternatingDraft: true }, players);
  session.pools["A"] = [testCard("bolt"), testCard("island"), testCard("bolt")];

  const [alice, bob] = buildDeckExports(session);

  assert.deepEqual(alice, {
    playerId: "A",
    playerName: "Alice",
    plainText: "2 bolt\n1 island",
    cards: [
      { scryfallId: "bolt", name: "bolt", count: 2 },
      { scryfallId: "island", name: "island", count: 1 },
    ],
  });
  assert.deepEqual(bob, { playerId: "B", playerName: "Bob", plainText: "", cards: [] });
});
