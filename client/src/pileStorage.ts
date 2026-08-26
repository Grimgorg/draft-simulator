// Wrapped in try/catch: localStorage can throw in some private-browsing
// contexts, and that shouldn't take down the app — it just means pile
// arrangement won't survive a refresh for that session.

export interface StoredDraftPile {
  id: number;
  /** Indices into the player's pool, bottom to top. */
  cards: number[];
}

export interface StoredMainPile {
  id: number;
  /** Deck-builder instance ids, bottom to top. */
  cards: string[];
}

export interface StoredDeckState {
  mainPiles: StoredMainPile[];
  cutPile: string[];
  /** Basics are stored by name, not as a full Card, so restore re-resolves
   * them against the live basicLands prop rather than trusting a stale
   * cached shape. */
  addedBasics: { id: string; cardName: string }[];
}

export function buildDraftPilesKey(sessionId: string, playerId: string): string {
  return `draft-simulator:piles:draft:${sessionId}:${playerId}`;
}

export function buildDeckStateKey(sessionId: string, playerId: string): string {
  return `draft-simulator:piles:deck:${sessionId}:${playerId}`;
}

function isStoredDraftPileArray(value: unknown): value is StoredDraftPile[] {
  return (
    Array.isArray(value) &&
    value.every(
      (p) =>
        p && typeof p === "object" && typeof p.id === "number" && Array.isArray(p.cards)
    )
  );
}

function isStoredDeckState(value: unknown): value is StoredDeckState {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return Array.isArray(v.mainPiles) && Array.isArray(v.cutPile) && Array.isArray(v.addedBasics);
}

export function getStoredDraftPiles(key: string): StoredDraftPile[] | null {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    return isStoredDraftPileArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function storeDraftPiles(key: string, piles: StoredDraftPile[]): void {
  try {
    localStorage.setItem(key, JSON.stringify(piles));
  } catch {
    // ignore
  }
}

export function getStoredDeckState(key: string): StoredDeckState | null {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    return isStoredDeckState(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function storeDeckState(key: string, state: StoredDeckState): void {
  try {
    localStorage.setItem(key, JSON.stringify(state));
  } catch {
    // ignore
  }
}
