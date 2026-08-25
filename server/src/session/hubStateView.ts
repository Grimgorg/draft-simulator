import type { HubStateView } from "@draft-simulator/shared";
import * as lobbyManager from "./lobbyManager.js";

export function buildHubStateView(): HubStateView {
  const session = lobbyManager.getSession();
  if (!session || session.status !== "complete") {
    return { players: [] };
  }

  const readyPlayers = lobbyManager.getReadyPlayers();
  return {
    players: session.players.map((player) => ({
      id: player.id,
      name: player.name,
      status: lobbyManager.getActiveMatch(player.id)
        ? "in-match"
        : readyPlayers[player.id]
          ? "idle"
          : "not-ready",
    })),
  };
}
