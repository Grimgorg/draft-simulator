import { REALITY_FRACTURE_PRINTING_SETS } from "./realityFracture.js";

/**
 * Every set whose printings the card import keeps, for all draftable sets together. Kept out of setBoosters.ts,
 * which needs shared's built output at runtime: `import-cards` runs before shared is built, in CI and on a fresh
 * clone, and failed to load when it imported this from there. Add a new set's printing sets here too.
 */
export const SET_PRINTING_CODES: readonly string[] = [...new Set([...REALITY_FRACTURE_PRINTING_SETS])];
