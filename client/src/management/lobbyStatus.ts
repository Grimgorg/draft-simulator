import type { DraftSummary } from "@draft-simulator/shared";

/** True while stopping the server would interrupt players: a lobby is open or a draft is under way. */
export function isAnyDraftActive(drafts: DraftSummary[]): boolean {
  return drafts.some((draft) => draft.status === "lobby" || draft.status === "drafting");
}
