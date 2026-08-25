import { useState } from "react";
import type { Card, LobbyStateView } from "@draft-simulator/shared";
import { DeckBuilder } from "./DeckBuilder.js";
import { HostSetupScreen } from "./HostSetupScreen.js";

interface ResultsScreenProps {
  lobbyState: LobbyStateView;
  myPlayerId: string;
  myPool: Card[];
  onNewDraftCreated: (playerId: string) => void;
}

export function ResultsScreen({ lobbyState, myPlayerId, myPool, onNewDraftCreated }: ResultsScreenProps) {
  const [showNewDraftForm, setShowNewDraftForm] = useState(false);
  const isHost = lobbyState.hostId === myPlayerId;
  const myPlayerName = lobbyState.players.find((p) => p.id === myPlayerId)?.name ?? "player";

  return (
    <div className="screen results-screen">
      <h1>Draft complete!</h1>

      <DeckBuilder pool={myPool} basicLands={lobbyState.basicLands ?? []} playerName={myPlayerName} />

      <h2>Players</h2>
      <ul className="player-list">
        {lobbyState.players.map((player) => (
          <li key={player.id}>
            {player.name}
            {player.id === myPlayerId && <span className="tag">you</span>}
          </li>
        ))}
      </ul>

      {isHost && (
        <div className="new-draft-section">
          {showNewDraftForm ? (
            <HostSetupScreen onCreated={onNewDraftCreated} />
          ) : (
            <button type="button" onClick={() => setShowNewDraftForm(true)}>
              Start a new draft
            </button>
          )}
        </div>
      )}
    </div>
  );
}
