import type { Card, LobbyStateView } from "@draft-simulator/shared";
import { DeckBuilder } from "./DeckBuilder.js";

interface ResultsScreenProps {
  lobbyState: LobbyStateView;
  myPlayerId: string;
  myPool: Card[];
}

export function ResultsScreen({ lobbyState, myPlayerId, myPool }: ResultsScreenProps) {
  const myPlayerName = lobbyState.players.find((p) => p.id === myPlayerId)?.name ?? "player";

  return (
    <div className="screen results-screen">
      <h1>Draft complete!</h1>

      <DeckBuilder
        pool={myPool}
        basicLands={lobbyState.basicLands ?? []}
        playerName={myPlayerName}
        sessionId={lobbyState.sessionId}
        myPlayerId={myPlayerId}
      />
    </div>
  );
}
