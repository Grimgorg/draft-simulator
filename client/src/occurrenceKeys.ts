import type { Card } from "@draft-simulator/shared";

/**
 * Pairs each card with a React key that's unique even when a pack holds two
 * copies of the same card (e.g. a cube running two of each fetchland), which
 * share a scryfallId. Keying by scryfallId alone gave React duplicate keys,
 * and when the pack changed it lost track of one copy and left its DOM node
 * on screen for the rest of the draft: a "ghost" card that couldn't be
 * picked. The occurrence index keeps each key stable across renders.
 */
export function withOccurrenceKeys(cards: Card[]): { key: string; card: Card }[] {
  const seen = new Map<string, number>();
  return cards.map((card) => {
    const occurrence = seen.get(card.scryfallId) ?? 0;
    seen.set(card.scryfallId, occurrence + 1);
    return { key: `${card.scryfallId}#${occurrence}`, card };
  });
}
