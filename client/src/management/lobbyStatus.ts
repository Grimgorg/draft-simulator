import type { LobbyStateView } from "@draft-simulator/shared";

/** True while stopping the server would interrupt players: a lobby is open or a draft is under way. */
export function isDraftActive(lobby: LobbyStateView): boolean {
  return lobby.status === "lobby" || lobby.status === "drafting";
}
