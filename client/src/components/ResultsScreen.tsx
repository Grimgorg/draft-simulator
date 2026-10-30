import type { Card, LobbyStateView } from "@draft-simulator/shared";
import { CloseDraftButton, LeaveDraftButton } from "./DraftControls.js";
import { DeckBuilder } from "./DeckBuilder.js";

interface ResultsScreenProps {
  lobbyState: LobbyStateView;
  myPlayerId: string;
  myPool: Card[];
  /** Called once this browser's seat is gone: back to the draft list, or as the creator closed the draft. */
  onLeft: () => void;
}

export function ResultsScreen({ lobbyState, myPlayerId, myPool, onLeft }: ResultsScreenProps) {
  const myPlayerName = lobbyState.players.find((p) => p.id === myPlayerId)?.name ?? "player";

  return (
    <div className="screen results-screen">
      <div className="results-header">
        <h1>Draft complete!</h1>
        <div className="lobby-actions">
          {/* The seat stays in the draft: the deck can be picked up again from the list. */}
          <LeaveDraftButton label="All drafts" onLeft={onLeft} />
          {lobbyState.creatorPlayerId === myPlayerId && (
            <CloseDraftButton status={lobbyState.status} onClosed={onLeft} />
          )}
        </div>
      </div>

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
