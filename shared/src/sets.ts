/** A set that can be drafted from its boosters instead of from a cube. Its packs follow docs/sets/<code>-*.md. */
export interface DraftableSet {
  /** Scryfall's set code. */
  code: string;
  name: string;
  /** Cards in one of its draft boosters. */
  packSize: number;
}

export const DRAFTABLE_SETS: DraftableSet[] = [{ code: "fra", name: "Reality Fracture", packSize: 14 }];
