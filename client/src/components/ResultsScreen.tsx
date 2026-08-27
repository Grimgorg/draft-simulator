import type { Card, LobbyStateView } from "@draft-simulator/shared";
import { DeckBuilder } from "./DeckBuilder.js";
import { ResetDraftButton } from "./ResetDraftButton.js";

interface ResultsScreenProps {
  lobbyState: LobbyStateView;
  myPlayerId: string;
  myPool: Card[];
}

export function ResultsScreen({ lobbyState, myPlayerId, myPool }: ResultsScreenProps) {
  const isHost = lobbyState.hostId === myPlayerId;
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

      <h2>Players</h2>
      <ul className="player-list">
        {lobbyState.players.map((player) => (
          <li key={player.id}>
            {player.name}
            {player.id === myPlayerId && <span className="tag">you</span>}
          </li>
        ))}
      </ul>

      {isHost && <ResetDraftButton />}
    </div>
  );
}
