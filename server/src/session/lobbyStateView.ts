import type { LobbyStateView } from "@draft-simulator/shared";
import * as lobbyManager from "./lobbyManager.js";

export function buildLobbyStateView(): LobbyStateView {
  const session = lobbyManager.getSession();
  if (!session) {
    return { status: "empty", players: [] };
  }

  const cubeMeta = lobbyManager.getCubeMeta();
  const isDrafting = session.status === "drafting";

  return {
    status: session.status,
    hostId: session.players.find((p) => p.isHost)?.id,
    settings: session.settings,
    cubeName: cubeMeta?.cubeName,
    cardCount: cubeMeta?.cardCount,
    unresolvedCardNames: cubeMeta?.unresolvedCardNames,
    players: session.players,
    currentPackNumber: isDrafting ? session.currentPackNumber : undefined,
    currentPickNumber: isDrafting ? session.currentPickNumber : undefined,
    waitingOn: isDrafting ? session.waitingOn : undefined,
  };
}
