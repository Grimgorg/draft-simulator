import type { Card } from "@draft-simulator/shared";
import { getStoredDeckState, getStoredDraftPiles } from "./pileStorage.js";

// The deck builder's pile model, and how it is restored when the deck
// builder mounts. Kept out of the DeckBuilder component so the component
// only deals with user interaction.

export interface Instance {
  id: string;
  card: Card;
}

export interface Pile {
  id: number;
  /** Instance ids, bottom to top. */
  cards: string[];
}

export interface DeckState {
  mainPiles: Pile[];
  /** A single stack, no sub-piles — everything not going in the deck. */
  cutPile: string[];
}

export interface ResolvedInitialDeckState {
  deck: DeckState;
  addedBasics: Instance[];
  nextPileId: number;
  nextBasicId: number;
  seenIds: Set<string>;
}

const EMPTY_RESOLVED_STATE: ResolvedInitialDeckState = {
  deck: { mainPiles: [], cutPile: [] },
  addedBasics: [],
  nextPileId: 0,
  nextBasicId: 0,
  seenIds: new Set(),
};

/**
 * Figures out what to seed the deck builder with, in priority order:
 * this player's own saved deck-builder state for this session (a refresh
 * while deck building), else the draft board's saved pile arrangement for
 * the same session (first arrival here right after the draft finished),
 * else nothing — DeckBuilder's effect for newly seen cards then builds the
 * default one-pile-per-card layout from `pool`.
 */
export function resolveInitialDeckState(
  deckKey: string | null,
  draftKey: string | null,
  basicLands: Card[]
): ResolvedInitialDeckState {
  const own = deckKey ? getStoredDeckState(deckKey) : null;
  if (own) {
    const addedBasics: Instance[] = [];
    for (const stored of own.addedBasics) {
      const card = basicLands.find((land) => land.name === stored.cardName);
      if (card) addedBasics.push({ id: stored.id, card });
    }
    // A basic whose land no longer resolves (shouldn't normally happen)
    // is dropped from wherever it sits too, keeping restored state clean
    // (render also defends against an unresolved id via resolveInstances).
    const resolvableBasicIds = new Set(addedBasics.map((b) => b.id));
    const isResolvable = (id: string) => !id.startsWith("basic:") || resolvableBasicIds.has(id);

    const mainPiles = own.mainPiles
      .map((pile) => ({ ...pile, cards: pile.cards.filter(isResolvable) }))
      .filter((pile) => pile.cards.length > 0);
    const cutPile = own.cutPile.filter(isResolvable);

    return {
      deck: { mainPiles, cutPile },
      addedBasics,
      nextPileId: mainPiles.reduce((max, p) => Math.max(max, p.id + 1), 0),
      nextBasicId: addedBasics.reduce((max, b) => {
        const match = /:(\d+)$/.exec(b.id);
        return match ? Math.max(max, Number(match[1]) + 1) : max;
      }, 0),
      seenIds: new Set([...mainPiles.flatMap((p) => p.cards), ...cutPile]),
    };
  }

  const fromDraft = draftKey ? getStoredDraftPiles(draftKey) : null;
  if (fromDraft && fromDraft.length > 0) {
    const mainPiles: Pile[] = fromDraft.map((pile) => ({
      id: pile.id,
      cards: pile.cards.map((poolIndex) => `pool:${poolIndex}`),
    }));
    return {
      deck: { mainPiles, cutPile: [] },
      addedBasics: [],
      nextPileId: mainPiles.reduce((max, p) => Math.max(max, p.id + 1), 0),
      nextBasicId: 0,
      seenIds: new Set(mainPiles.flatMap((p) => p.cards)),
    };
  }

  return EMPTY_RESOLVED_STATE;
}
