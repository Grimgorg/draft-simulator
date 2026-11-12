/**
 * The seat this browser took: which draft, as which player, and the seat's token, without which the server won't
 * give the seat back. Before a server held several drafts this was the player id alone, under
 * "draft-simulator:player-id"; that key is ignored now, so players who were seated then pick their name once from
 * the draft's rejoin list.
 */
const STORAGE_KEY = "draft-simulator:seat";

export interface StoredSeat {
  draftId: string;
  playerId: string;
  /** Missing in seats stored before seats had tokens: the server gives one when such a seat is claimed. */
  seatToken?: string;
}

// Wrapped in try/catch: localStorage can throw in some private-browsing
// contexts, and that shouldn't take down the app — it just means no
// reconnect-on-refresh for that session.

export function getStoredSeat(): StoredSeat | null {
  try {
    const seat = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null") as Partial<StoredSeat> | null;
    if (typeof seat?.draftId !== "string" || typeof seat.playerId !== "string") return null;
    return {
      draftId: seat.draftId,
      playerId: seat.playerId,
      ...(typeof seat.seatToken === "string" ? { seatToken: seat.seatToken } : {}),
    };
  } catch {
    return null;
  }
}

export function storeSeat(seat: StoredSeat): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(seat));
  } catch {
    // ignore
  }
}

export function clearStoredSeat(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore
  }
}
