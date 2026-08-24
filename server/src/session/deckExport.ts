import type { DeckExport } from "@draft-simulator/shared";
import type { DraftSession } from "../draftEngine/draftEngine.js";

export function buildDeckExports(session: DraftSession): DeckExport[] {
  return session.players.map((player) => {
    const pool = session.pools[player.id] ?? [];
    const counts = new Map<string, { name: string; count: number }>();
    for (const card of pool) {
      const existing = counts.get(card.scryfallId);
      if (existing) {
        existing.count += 1;
      } else {
        counts.set(card.scryfallId, { name: card.name, count: 1 });
      }
    }

    const cards = [...counts.entries()].map(([scryfallId, { name, count }]) => ({ scryfallId, name, count }));
    const plainText = cards.map((c) => `${c.count} ${c.name}`).join("\n");

    return { playerId: player.id, playerName: player.name, plainText, cards };
  });
}
