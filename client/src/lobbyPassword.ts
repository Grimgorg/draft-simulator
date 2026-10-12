const STORAGE_KEY = "draft-simulator:lobby-password";

// Wrapped in try/catch: localStorage can throw in some private-browsing
// contexts, and that shouldn't take down the app — it just means having to
// re-enter the password every visit for that session.

export function getStoredPassword(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

export function storePassword(password: string): void {
  try {
    localStorage.setItem(STORAGE_KEY, password);
  } catch {
    // ignore
  }
}
