import type { Card } from "./card.js";

/** One distinct card in a decklist and how many copies of it there are. */
export interface DecklistEntry {
  scryfallId: string;
  name: string;
  count: number;
}

/** Groups cards by scryfallId, keeping the order in which each card first appears. */
export function countCardCopies(cards: Card[]): DecklistEntry[] {
  const counts = new Map<string, DecklistEntry>();
  for (const card of cards) {
    const existing = counts.get(card.scryfallId);
    if (existing) {
      existing.count += 1;
    } else {
      counts.set(card.scryfallId, { scryfallId: card.scryfallId, name: card.name, count: 1 });
    }
  }
  return [...counts.values()];
}

/** Renders entries as plain-text "count name" lines, one per entry. */
export function formatDecklistText(entries: DecklistEntry[]): string {
  return entries.map((entry) => `${entry.count} ${entry.name}`).join("\n");
}
