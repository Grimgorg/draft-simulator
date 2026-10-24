import type { LobbyStateView } from "@draft-simulator/shared";
import { UnresolvedCardsWarning } from "./UnresolvedCardsWarning.js";

interface WaitingRoomProps {
  lobbyState: LobbyStateView;
  myPlayerId: string;
}

export function WaitingRoom({ lobbyState, myPlayerId }: WaitingRoomProps) {
  return (
    <div className="screen">
      <h1>{lobbyState.cubeName}</h1>
      <p className="subtitle">
        {lobbyState.cardCount} cards &middot; {lobbyState.settings?.packCount} packs of{" "}
        {lobbyState.settings?.packSize} &middot; {lobbyState.players.length} / {lobbyState.settings?.playerCount}{" "}
        players
      </p>
      <UnresolvedCardsWarning names={lobbyState.unresolvedCardNames ?? []} />

      <ul className="player-list">
        {lobbyState.players.map((player) => (
          <li key={player.id}>
            <span className={`dot ${player.connected ? "dot-connected" : "dot-disconnected"}`} />
            {player.name}
            {player.id === myPlayerId && <span className="tag">you</span>}
          </li>
        ))}
      </ul>

      <p className="subtitle">Waiting for the host to start the draft...</p>
    </div>
  );
}
