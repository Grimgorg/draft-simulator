import type { Card, Pack } from "@draft-simulator/shared";

export function testCard(id: string): Card {
  return { scryfallId: id, name: id, manaCost: "", cmc: 0, colors: [], typeLine: "", imageUrl: `/images/${id}` };
}

export function testPack(id: string, packNumber: number, cardIds: string[]): Pack {
  return { id, packNumber, cards: cardIds.map(testCard) };
}
