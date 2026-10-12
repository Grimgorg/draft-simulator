import type { DeckExport } from "@draft-simulator/shared";
import { countCardCopies, formatDecklistText } from "@draft-simulator/shared";
import type { DraftSession } from "../draftEngine/draftEngine.js";

export function buildDeckExports(session: DraftSession): DeckExport[] {
  return session.players.map((player) => {
    const cards = countCardCopies(session.pools[player.id] ?? []);
    const plainText = formatDecklistText(cards);
    return { playerId: player.id, playerName: player.name, plainText, cards };
  });
}
