const STORAGE_KEY = "draft-simulator:player-id";

// Wrapped in try/catch: localStorage can throw in some private-browsing
// contexts, and that shouldn't take down the app — it just means no
// reconnect-on-refresh for that session.

export function getStoredPlayerId(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

export function storePlayerId(playerId: string): void {
  try {
    localStorage.setItem(STORAGE_KEY, playerId);
  } catch {
    // ignore
  }
}

export function clearStoredPlayerId(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore
  }
}
