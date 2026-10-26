import type { DraftStatus } from "@draft-simulator/shared";

/**
 * Whether the draft server starts as soon as the process does. In the desktop app the host starts it from the
 * management UI, except when the saved draft is open or under way: then players are waiting to reconnect, after an
 * update or a restart, and shouldn't wait for the host to notice. Run from source, it always starts.
 */
export function shouldStartDraftServerAtLaunch(managed: boolean, draftStatus: DraftStatus | undefined): boolean {
  return !managed || draftStatus === "lobby" || draftStatus === "drafting";
}
