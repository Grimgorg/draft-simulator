import assert from "node:assert/strict";
import test from "node:test";
import { selectFirstPrintings, type ScryfallCard } from "./importBulkData.js";

function printing(id: string, overrides: Partial<ScryfallCard> = {}): ScryfallCard {
  return {
    id,
    oracle_id: "oracle-bolt",
    name: "Lightning Bolt",
    layout: "normal",
    lang: "en",
    released_at: "2000-01-01",
    image_uris: { normal: `https://img/${id}.jpg` },
    ...overrides,
  };
}

function selectedIds(cards: ScryfallCard[]): string[] {
  return selectFirstPrintings(cards).map((c) => c.id);
}

test("drops tokens and art cards that share a real card's name, keeping the card itself", () => {
  const cards = [
    // An eternalize token, an Art Series card and a front card all predate (or
    // sort ahead of) the real printing, so they'd win a name lookup if kept.
    printing("witness-token", { oracle_id: "o-token", name: "Timeless Witness", layout: "token", released_at: "2017-01-01" }),
    printing("witness", { oracle_id: "o-witness", name: "Timeless Witness", released_at: "2018-01-01" }),
    printing("pathway-art", { oracle_id: "o-art", name: "Clearwater Pathway // Clearwater Pathway", layout: "art_series" }),
    printing("pathway", { oracle_id: "o-pathway", name: "Clearwater Pathway // Murkwater Pathway", layout: "modal_dfc" }),
    printing("inferno-front", { oracle_id: "o-front", name: "Inferno", layout: "front_card" }),
    printing("zombie-dfc-token", { oracle_id: "o-dfct", name: "Zombie // Zombie", layout: "double_faced_token" }),
    printing("emblem", { oracle_id: "o-emblem", name: "Emblem", layout: "emblem" }),
  ];

  assert.deepEqual(selectedIds(cards).sort(), ["pathway", "witness"]);
});

test("picks the earliest normal paper printing over earlier digital, promo or special-art ones", () => {
  const cards = [
    printing("digital", { released_at: "1990-01-01", digital: true }),
    printing("promo", { released_at: "1991-01-01", promo: true }),
    printing("borderless", { released_at: "1992-01-01", border_color: "borderless" }),
    printing("full-art", { released_at: "1992-06-01", full_art: true }),
    printing("showcase", { released_at: "1993-01-01", frame_effects: ["showcase"] }),
    printing("later-normal", { released_at: "2010-01-01" }),
    printing("first-normal", { released_at: "1995-01-01" }),
  ];

  assert.deepEqual(selectedIds(cards), ["first-normal"]);
});

test("falls back to a promo or special-art printing rather than dropping a card that has nothing better", () => {
  assert.deepEqual(selectedIds([printing("promo", { promo: true, released_at: "2001-01-01" })]), ["promo"]);
  assert.deepEqual(
    selectedIds([
      printing("borderless-late", { border_color: "borderless", released_at: "2022-01-01" }),
      printing("borderless-early", { border_color: "borderless", released_at: "2021-01-01" }),
    ]),
    ["borderless-early"]
  );
});

test("prefers any printing with an image over an earlier imageless one, matching on face images too", () => {
  const cards = [
    printing("no-image", { released_at: "1993-01-01", image_uris: undefined }),
    printing("face-image", {
      released_at: "1999-01-01",
      image_uris: undefined,
      card_faces: [{ image_uris: { normal: "https://img/front.jpg" } }, { image_uris: { normal: "https://img/back.jpg" } }],
    }),
  ];

  assert.deepEqual(selectedIds(cards), ["face-image"]);
});

test("keeps one printing per distinct card", () => {
  const cards = [
    printing("bolt-a", { released_at: "1993-01-01" }),
    printing("bolt-b", { released_at: "2010-01-01" }),
    printing("counterspell", { oracle_id: "oracle-counterspell", name: "Counterspell" }),
  ];

  assert.deepEqual(selectedIds(cards).sort(), ["bolt-a", "counterspell"]);
});
